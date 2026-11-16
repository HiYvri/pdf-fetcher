import { JlylClient, JlylLoginRequiredError } from "./JlylClient";
import { PdfImporter } from "./PdfImporter";
import { extractItemMetadata, hasPDF, itemRef, writableItem, type ItemRef } from "../utils/item";

const FETCHING_TAG = "fetching PDF";
const INITIAL_CHECK_DELAY = 7000;

export class PdfFetcher {
  private static processing = new Set<number>();
  private static unmarkedSubmissions = new Set<number>();
  private static uncertainSubmissions = new Set<number>();

  static async submitSelectedItems(items: Zotero.Item[]) {
    const regularItems = items.filter((item) => item.isRegularItem());
    if (!regularItems.length) {
      this.showProgressLine("未选择有效文献条目", "fail");
      return;
    }
    for (const item of regularItems) {
      await this.fetchItem(itemRef(item));
    }
  }

  static canAutoFetch(ref: ItemRef) {
    const item = writableItem(ref);
    if (!item || this.processing.has(ref.id) || this.isPending(item)
      || this.uncertainSubmissions.has(ref.id) || !extractItemMetadata(item).queryText) {
      return false;
    }
    if (hasPDF(item)) {
      Zotero.debug("pdf-fetcher: skipped item with a PDF attachment record");
      return false;
    }
    return true;
  }

  // An automatic task supplies a guard for its original enable cycle.
  static async fetchItem(ref: ItemRef, autoActive?: () => boolean) {
    const active = () => addon.data.alive && (!autoActive || autoActive());
    if (!active() || this.processing.has(ref.id)) {
      return;
    }

    this.processing.add(ref.id);
    let phase = "读取条目";
    let clearPending = false;
    const withoutPDF = () => {
      const item = active() ? writableItem(ref) : undefined;
      if (item && hasPDF(item)) {
        clearPending = true;
        return;
      }
      return item;
    };
    try {
      let item = withoutPDF();
      if (!item) {
        return;
      }

      const metadata = extractItemMetadata(item);
      if (!metadata.queryText) {
        if (!autoActive) {
          this.showProgressLine("缺少可提交的 DOI、PMID、标题或 URL", "fail");
        }
        return;
      }

      const pending = this.isPending(item);
      if (autoActive && (pending || this.uncertainSubmissions.has(ref.id))) {
        return;
      }
      if (!pending) {
        phase = "提交";
        try {
          await JlylClient.submit(metadata);
        }
        catch (error) {
          if (!(error instanceof JlylLoginRequiredError)) {
            // A lost response may still mean the server accepted the request.
            this.uncertainSubmissions.add(ref.id);
          }
          throw error;
        }
        this.uncertainSubmissions.delete(ref.id);
        this.unmarkedSubmissions.add(ref.id);
        const submittedItem = addon.data.alive ? writableItem(ref) : undefined;
        if (submittedItem) {
          phase = "保存待查标签";
          await this.addFetchingTag(submittedItem);
        }
        if (!submittedItem || !active()) {
          return;
        }
        this.showProgressLine("已提交到聚联医疗，7 秒后查询结果", "default");
        await new Promise<void>((resolve) => setTimeout(resolve, INITIAL_CHECK_DELAY));
      }

      item = withoutPDF();
      if (!item) {
        return;
      }
      phase = "查询";
      const record = JlylClient.findMatchingRecord(await JlylClient.listTasks(), metadata);
      item = withoutPDF();
      if (!item) {
        return;
      }

      if (String(record?.taskStatus) !== "2" || !record) {
        const status = String(record?.taskStatus);
        const message = status === "3" || status === "6"
          ? "聚联医疗报告任务失败或异常，请到网站查看"
          : record
            ? "任务尚未完成，请稍后右键检查"
            : "最近任务中未找到记录，请到聚联医疗网站查看或稍后右键检查";
        this.showProgressLine(message, status === "3" || status === "6" ? "fail" : "default");
        return;
      }

      phase = "下载";
      const pdfURL = await JlylClient.getDownloadURL(record);
      item = withoutPDF();
      if (!item) {
        return;
      }
      phase = "导入";
      if (!await PdfImporter.importFromURL(item, metadata, pdfURL)) {
        throw new Error("Attachment was not saved");
      }
      clearPending = true;
      if (active()) {
        this.showProgressLine("PDF 已导入 Zotero 附件", "success");
      }
    }
    catch (error) {
      if (active()) {
        if (error instanceof JlylLoginRequiredError) {
          this.showProgressLine(`${error.message}\n请在 Zotero 设置页的 pdf-fetcher 中填写或更新 token。`, "fail");
          return "auth";
        }
        // HTTP and import errors can include signed URLs, so only report the stage.
        Zotero.debug(`pdf-fetcher: ${phase} failed`);
        this.showProgressLine(`${phase}失败，请检查聚联医疗网站或稍后重试。`, "fail");
      }
    }
    finally {
      try {
        const item = clearPending && addon.data.alive ? writableItem(ref) : undefined;
        if (item) {
          await this.removeFetchingTag(item);
        }
      }
      catch {
        Zotero.debug("pdf-fetcher: could not clear pending tag");
      }
      finally {
        this.processing.delete(ref.id);
      }
    }
  }

  private static isPending(item: Zotero.Item) {
    return this.unmarkedSubmissions.has(item.id) || item.hasTag(FETCHING_TAG);
  }

  private static async addFetchingTag(item: Zotero.Item) {
    // Connector updates replace manual tags but preserve automatic tags.
    item.addTag(FETCHING_TAG, 1);
    await item.saveTx();
    this.unmarkedSubmissions.delete(item.id);
  }

  private static async removeFetchingTag(item: Zotero.Item) {
    if (item.hasTag(FETCHING_TAG)) {
      item.removeTag(FETCHING_TAG);
      await item.saveTx();
    }
    this.unmarkedSubmissions.delete(item.id);
  }

  private static showProgressLine(text: string, type: "default" | "success" | "fail") {
    new ztoolkit.ProgressWindow("pdf-fetcher", {
      closeOnClick: true,
      closeTime: 8000
    })
      .createLine({ text, type, progress: 100 })
      .show();
  }
}
