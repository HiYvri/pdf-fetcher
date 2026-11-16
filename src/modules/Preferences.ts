import { homepage } from "../../package.json";
import { autoFetchPref, tokenPref } from "../utils/preferences";

export class Preferences {
  private static lastActionAt = 0;

  static registerPrefsScripts(win: Window) {
    const doc = win.document;
    const tokenInput = doc.getElementById("pdf-fetcher-token") as HTMLInputElement | null;
    if (!tokenInput) {
      return;
    }

    tokenInput.value = String(Zotero.Prefs.get(tokenPref) || "");

    const autoFetch = doc.getElementById("pdf-fetcher-auto-fetch") as HTMLInputElement | null;
    if (autoFetch) {
      autoFetch.checked = Zotero.Prefs.get(autoFetchPref, true) === true;
      if (!autoFetch.hasAttribute("data-pdf-fetcher-bound")) {
        autoFetch.setAttribute("data-pdf-fetcher-bound", "true");
        autoFetch.addEventListener("change", () => {
          Zotero.Prefs.set(autoFetchPref, autoFetch.checked, true);
        });
      }
    }

    const projectLink = doc.getElementById("pdf-fetcher-project");
    if (projectLink && !projectLink.hasAttribute("data-pdf-fetcher-bound")) {
      projectLink.setAttribute("data-pdf-fetcher-bound", "true");
      projectLink.addEventListener("click", (event) => {
        event.preventDefault();
        Zotero.launchURL(homepage);
      });
    }

    this.bind(doc, "pdf-fetcher-open-site", () => {
      Zotero.launchURL("https://jlyl.jlss.vip");
    });

    this.bind(doc, "pdf-fetcher-save", () => {
      this.saveToken(tokenInput.value);
      Services.prompt.alert(win as unknown as mozIDOMWindowProxy, "pdf-fetcher", "设置已保存。");
    });

    this.bind(doc, "pdf-fetcher-clear-token", () => {
      tokenInput.value = "";
      this.saveToken("");
      Services.prompt.alert(win as unknown as mozIDOMWindowProxy, "pdf-fetcher", "Token 已清除。");
    });
  }

  private static bind(doc: Document, id: string, listener: EventListener) {
    const button = doc.getElementById(id);
    if (!button || button.hasAttribute("data-pdf-fetcher-bound")) {
      return;
    }
    button.setAttribute("data-pdf-fetcher-bound", "true");
    button.addEventListener("command", (event) => {
      const now = Date.now();
      if (now - this.lastActionAt < 500) {
        return;
      }
      this.lastActionAt = now;
      listener(event);
    });
  }

  private static saveToken(value: string) {
    Zotero.Prefs.set(tokenPref, String(value || "").trim());
  }
}
