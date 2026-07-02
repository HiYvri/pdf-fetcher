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
