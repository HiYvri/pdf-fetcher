import { AutoFetch } from "./modules/AutoFetch";
import { Common } from "./modules/Common";
import { Preferences } from "./modules/Preferences";
import { createZToolkit } from "./utils/ztoolkit";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise
  ]);

  if (!addon.data.alive) {
    return;
  }
  AutoFetch.start();
  await Promise.all(Zotero.getMainWindows().map((win) => onMainWindowLoad(win)));

  addon.data.initialized = true;
  ztoolkit.log("pdf-fetcher initialized");
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();
  Common.registerRightClickMenuItem(win);
  AutoFetch.registerWindow(win);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  AutoFetch.unregisterWindow(win);
  Common.unregisterWindow(win);
  ztoolkit.unregisterAll();
}

async function onShutdown(): Promise<void> {
  addon.data.alive = false;
  AutoFetch.stop();
  Common.unregisterAll();
  ztoolkit.unregisterAll();
  delete (Zotero as typeof Zotero & Record<string, unknown>)[addon.data.config.addonInstance];
}

function onPrefsLoad(event: Event): void {
  const target = event.target as Element & { ownerGlobal?: Window };
  const win = target.ownerGlobal || window;
  Preferences.registerPrefsScripts(win);
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsLoad
};
