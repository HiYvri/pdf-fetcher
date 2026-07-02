import { JlylClient, JlylLoginRequiredError } from "./JlylClient";
import { PdfImporter } from "./PdfImporter";
import { extractItemMetadata, type ItemMetadata } from "../utils/item";

const FETCHING_TAG = "fetching PDF";
const TASK_SUCCESS_STATUS = "2";
const INITIAL_CHECK_DELAY = 7000;

export class PdfFetcher {
  static async submitSelectedItems(items: Zotero.Item[]) {
    const regularItems = items.filter((item) => item.isRegularItem());

    if (!regularItems.length) {
      this.showProgressLine("未选择有效文献条目", "fail");
      return;
    }

    for (const item of regularItems) {
      const metadata = extractItemMetadata(item);
      if (!metadata.queryText) {
        this.showProgressLine(
          [
            `Title: ${metadata.title || "未找到"}`,
            `DOI: ${metadata.doi || "未找到"}`,
            `PMID: ${metadata.pmid || "未找到"}`,
            `URL: ${metadata.url || "未找到"}`,
            "提交失败：缺少可提交的 DOI、PMID、标题或 URL"
          ].join("\n"),
          "fail"
        );
        continue;
      }

      this.showProgressLine(
        "已获取文献信息",
        "default"
      );

      try {
        if (this.hasFetchingTag(item)) {
          await this.checkTaskAndImport(item, metadata, false);
          continue;
        }

        await JlylClient.submit(metadata);
        this.showProgressLine("已提交到聚联医疗，7 秒后查询结果", "default");
        await this.delay(INITIAL_CHECK_DELAY);
        await this.checkTaskAndImport(item, metadata, true);
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const hint = error instanceof JlylLoginRequiredError
          ? "\n请在 Zotero 设置页的 pdf-fetcher 中填写或更新 token。"
          : "";
        this.showProgressLine(`提交失败：${message}${hint}`, "fail");
      }
    }
  }

  private static async checkTaskAndImport(item: Zotero.Item, metadata: ItemMetadata, markPending: boolean) {
    const records = await JlylClient.listTasks();
    const record = JlylClient.findMatchingRecord(records, metadata);

    if (record && String(record.taskStatus) === TASK_SUCCESS_STATUS) {
      const pdfURL = await JlylClient.getDownloadURL(record);
      await PdfImporter.importFromURL(item, metadata, pdfURL);
      await this.removeFetchingTag(item);
      this.showProgressLine("PDF 已导入 Zotero 附件", "success");
      return;
    }

    if (markPending) {
      await this.addFetchingTag(item);
    }
    this.showProgressLine("人工查找中，请稍后再试", "default");
  }

  private static hasFetchingTag(item: Zotero.Item) {
    return item.getTags().some((tag) => tag.tag === FETCHING_TAG);
  }

  private static async addFetchingTag(item: Zotero.Item) {
    if (this.hasFetchingTag(item)) {
      return;
    }
    item.addTag(FETCHING_TAG);
    await item.saveTx();
  }

  private static async removeFetchingTag(item: Zotero.Item) {
    if (!this.hasFetchingTag(item)) {
      return;
    }
    item.removeTag(FETCHING_TAG);
    await item.saveTx();
  }

  private static delay(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
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
