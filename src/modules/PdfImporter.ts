import type { ItemMetadata } from "../utils/item";

export class PdfImporter {
  static async importFromURL(item: Zotero.Item, metadata: ItemMetadata, url: string) {
    const fileBaseName = this.createFileBaseName(metadata);

    return Zotero.Attachments.importFromURL({
      libraryID: item.libraryID,
      url,
      parentItemID: item.id,
      title: metadata.title || item.getDisplayTitle() || "PDF",
      fileBaseName,
      contentType: "application/pdf",
      referrer: "",
      cookieSandbox: null
    });
  }

  private static createFileBaseName(metadata: ItemMetadata): string {
    const basis = metadata.title || metadata.doi || metadata.pmid || metadata.itemID;
    return String(basis)
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "pdf-fetcher";
  }
}
