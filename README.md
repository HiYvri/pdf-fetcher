# pdf-fetcher

`pdf-fetcher` is a Zotero 9 plugin MVP for fetching article full text through JLYL/JLSS services.

## Current Scope

The current version implements the first service-facing step:

- Loads as a Zotero 9 bootstrapped plugin.
- Registers an item context menu entry: `通过聚联医疗获取原文`.
- Adds a `pdf-fetcher` Zotero settings pane for the JLYL/JLSS token.
- Submits the selected item's query text to `POST /search/trans`.
- Queries `POST /task/myHelpList` once after submission.
- Imports a successful task's signed PDF URL as a Zotero child attachment.

Long-running background polling is not implemented yet. If the remote task is still processing, click the context menu again later.

## Verified Service Notes

The currently known JLYL/JLSS endpoint mapping and live validation notes are preserved in [docs/network-analysis.md](docs/network-analysis.md). Do not implement those endpoints in the plugin UI flow until the MVP menu and metadata display are accepted.

## Build

```bash
npm install
npm run build
```

The scaffold build writes the packaged addon under `.scaffold/build`.

## Install In Zotero 9

1. Open Zotero.
2. Go to `Tools -> Plugins`.
3. Install the generated `.xpi` from the scaffold build output.
4. Restart Zotero if prompted.

## MVP Acceptance

- The plugin manager shows `pdf-fetcher`.
- The plugin is enabled without incompatible, unsigned, or corrupt errors.
- Selecting a regular Zotero item and right-clicking shows `通过聚联医疗获取原文`.
- The Zotero settings page shows `pdf-fetcher` with token instructions and helper buttons.
- Clicking the menu entry submits `DOI > PMID > title > URL` to JLYL/JLSS and shows the result.
