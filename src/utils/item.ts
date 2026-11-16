export type ItemRef = Pick<Zotero.Item, "id" | "libraryID" | "key">;

export function itemRef({ id, libraryID, key }: Zotero.Item): ItemRef {
  return { id, libraryID, key };
}

export function writableItem(ref: ItemRef) {
  if (!Zotero.Items.exists(ref.id)) {
    return;
  }
  const item = Zotero.Items.get(ref.id);
  if (!item || item.libraryID !== ref.libraryID || item.key !== ref.key
    || item.deleted || !item.isRegularItem() || !item.isTopLevelItem()) {
    return;
  }
  const library = Zotero.Libraries.get(item.libraryID);
  if (library && library.editable && library.filesEditable) {
    return item;
  }
}

export function hasPDF(item: Zotero.Item) {
  // The attachment record is enough, even if its file hasn't synced yet.
  return Zotero.Items.get(item.getAttachments()).some((attachment) => attachment.isPDFAttachment());
}

export type ItemMetadata = {
  itemID: number;
  libraryID: number;
  doi: string;
  pmid: string;
  title: string;
  url: string;
  queryText: string;
  queryType: "doi" | "pmid" | "title" | "url" | null;
};

export function extractItemMetadata(item: Zotero.Item): ItemMetadata {
  const extra = getField(item, "extra");

  const doi = getField(item, "DOI");
  const pmid = extractPMID(extra);
  const title = getField(item, "title");
  const url = getField(item, "url");
  const queryText = doi || pmid || title || url;

  return {
    itemID: item.id,
    libraryID: item.libraryID,
    doi,
    pmid,
    title,
    url,
    queryText,
    queryType: doi ? "doi" : pmid ? "pmid" : title ? "title" : url ? "url" : null
  };
}

function getField(item: Zotero.Item, field: string): string {
  return String(item.getField(field) || "").trim();
}

function extractPMID(extra: string): string {
  const match = extra.match(/(?:^|\n)\s*PMID\s*:\s*(\d+)/i);
  return match?.[1] || "";
}
