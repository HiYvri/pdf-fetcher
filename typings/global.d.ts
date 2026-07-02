import Addon from "../src/addon";
import type { ZoteroToolkit } from "zotero-plugin-toolkit";

declare global {
  const __env__: "development" | "production";
  const addon: Addon;
  const ztoolkit: ZoteroToolkit;

  var _globalThis: typeof globalThis & {
    addon: Addon;
  };
}

export {};
