import { config } from "../../package.json";
import { PdfFetcher } from "./PdfFetcher";

type MenuRegistration = {
  menuitem: Element;
  separator: Element;
  popup: Element;
  popupShowingHandler: EventListener;
  toolsMenuitem?: Element;
};

export class Common {
  private static registrations = new WeakMap<Window, MenuRegistration>();
  private static windows = new Set<Window>();

  static registerRightClickMenuItem(win: Window) {
    if (this.registrations.has(win)) {
      return;
    }

    const doc = win.document;
    const popup = doc.getElementById("zotero-itemmenu");
    const toolsMenuitem = this.registerToolsMenuItem(win);
    if (!popup) {
      ztoolkit.log("pdf-fetcher: zotero-itemmenu not found");
      return;
    }

    const menuIcon = `chrome://${config.addonRef}/content/icons/icon.svg`;
    const separator = doc.createXULElement("menuseparator");
    separator.id = "zotero-itemmenu-pdf-fetcher-separator";

    const menuitem = doc.createXULElement("menuitem");
    menuitem.id = "zotero-itemmenu-pdf-fetcher";
    menuitem.setAttribute("label", "通过聚联医疗获取原文");
    menuitem.setAttribute("image", menuIcon);
    menuitem.setAttribute("class", "menuitem-iconic");
    menuitem.addEventListener("command", () => {
      const items = this.getSelectedItems(win);
      PdfFetcher.submitSelectedItems(items).catch((error) => {
        ztoolkit.log("pdf-fetcher submit failed", error);
      });
    });

    const popupShowingHandler = () => this.updateMenuState(win);
    popup.addEventListener("popupshowing", popupShowingHandler);
    popup.append(separator);
    popup.append(menuitem);

    this.registrations.set(win, {
      menuitem,
      separator,
      popup,
      popupShowingHandler,
      toolsMenuitem
    });
    this.windows.add(win);
    this.updateMenuState(win);
  }

  static unregisterWindow(win: Window) {
    const registration = this.registrations.get(win);
    if (!registration) {
      return;
    }

    registration.popup.removeEventListener("popupshowing", registration.popupShowingHandler);
    registration.menuitem.remove();
    registration.separator.remove();
    registration.toolsMenuitem?.remove();
    this.registrations.delete(win);
    this.windows.delete(win);
  }

  static unregisterAll() {
    for (const win of this.windows) {
      this.unregisterWindow(win);
    }
  }

  private static updateMenuState(win: Window) {
    const registration = this.registrations.get(win);
    if (!registration) {
      return;
    }

    const hasRegularItem = this.getSelectedItems(win).some((item) => item.isRegularItem());
    registration.menuitem.toggleAttribute("hidden", !hasRegularItem);
    registration.separator.toggleAttribute("hidden", !hasRegularItem);
  }

  private static getSelectedItems(win: Window): Zotero.Item[] {
    const zoteroPane = (win as _ZoteroTypes.MainWindow).ZoteroPane;
    return zoteroPane?.getSelectedItems?.() || [];
  }

  private static registerToolsMenuItem(win: Window): Element | undefined {
    const doc = win.document;
    const existing = doc.getElementById("pdf-fetcher-tools-settings");
    if (existing) {
      return existing;
    }

    const toolsPopup = doc.getElementById("menu_ToolsPopup");
    if (!toolsPopup) {
      return undefined;
    }

    const menuitem = doc.createXULElement("menuitem");
    menuitem.id = "pdf-fetcher-tools-settings";
    menuitem.setAttribute("label", "pdf-fetcher 设置");
    menuitem.addEventListener("command", () => this.openSettingsPrompt(win));
    toolsPopup.append(menuitem);
    return menuitem;
  }

  private static openSettingsPrompt(win: Window) {
    const tokenPref = "extensions.zotero.pdfFetcher.token";
    const currentToken = String(Zotero.Prefs.get(tokenPref) || "");
    const value = { value: currentToken };
    const ok = Services.prompt.prompt(
      win as unknown as mozIDOMWindowProxy,
      "pdf-fetcher 设置",
      "输入聚联医疗 token：",
      value,
      "",
      { value: false }
    );
    if (!ok) {
      return;
    }

    Zotero.Prefs.set(tokenPref, value.value.trim());
    Services.prompt.alert(win as unknown as mozIDOMWindowProxy, "pdf-fetcher", "Token 已保存。");
  }
}
