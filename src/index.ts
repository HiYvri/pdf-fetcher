import { BasicTool } from "zotero-plugin-toolkit";
import Addon from "./addon";
import { config } from "../package.json";

const basicTool = new BasicTool();
const zotero = basicTool.getGlobal("Zotero") as typeof Zotero & Record<string, unknown>;

if (!zotero[config.addonInstance]) {
  _globalThis.addon = new Addon();

  defineGlobal("ztoolkit", () => {
    return _globalThis.addon.data.ztoolkit;
  });

  zotero[config.addonInstance] = addon;
}

function defineGlobal(name: string, getter?: () => unknown) {
  Object.defineProperty(_globalThis, name, {
    configurable: true,
    get() {
      return getter ? getter() : basicTool.getGlobal(name);
    }
  });
}
