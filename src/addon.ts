import type { ZoteroToolkit } from "zotero-plugin-toolkit";
import { config } from "../package.json";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized: boolean;
    ztoolkit: ZoteroToolkit;
  };

  public hooks: typeof hooks;
  public api: Record<string, never>;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      ztoolkit: createZToolkit()
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
