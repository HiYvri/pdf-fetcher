import { itemRef, type ItemRef } from "../utils/item";
import { autoFetchPref, tokenPref } from "../utils/preferences";
import { PdfFetcher } from "./PdfFetcher";

const SESSION_TTL = 10 * 60 * 1000;

type Methods = Record<string, unknown>;
type SaveSession = {
  id: string;
  _action: string;
  getItemByConnectorKey(key: string | number): Zotero.Item | undefined;
};
type ConnectorInternals = {
  SessionManager?: { get(id: string): SaveSession | undefined };
  SaveSession?: { prototype: Methods };
};
type TrackedSession = {
  items: Map<number, ItemRef>;
  timer: ReturnType<typeof setTimeout>;
};

export class AutoFetch {
  private static started = false;
  private static cycle?: object;
  private static prefObservers: symbol[] = [];
  private static connectorCleanup: (() => void)[] = [];
  private static windows = new Map<Window, () => void>();
  private static sessions = new Map<SaveSession, TrackedSession>();
  private static queue = new Map<number, ItemRef>();
  private static draining = false;
  private static authBlocked = false;
  private static tokenRevision = 0;

  static start() {
    if (this.started || !/^10(?:\.|$)/.test(Zotero.version)) {
      if (!this.started) {
        Zotero.debug("pdf-fetcher: auto fetch unavailable on this Zotero version");
      }
      return;
    }
    if (typeof Zotero.Prefs.registerObserver !== "function"
      || typeof Zotero.Prefs.unregisterObserver !== "function") {
      Zotero.debug("pdf-fetcher: preference observer unavailable");
      return;
    }

    this.started = true;
    this.prefObservers.push(Zotero.Prefs.registerObserver(autoFetchPref, () => this.updateCycle(), true));
    this.prefObservers.push(Zotero.Prefs.registerObserver(tokenPref, () => {
      this.tokenRevision++;
      this.authBlocked = false;
    }));
    this.updateCycle();
    this.registerConnector();
  }

  static registerWindow(win: Window) {
    if (!this.started || this.windows.has(win)) {
      return;
    }
    const lookup = (win as Window & { Zotero_Lookup?: Methods }).Zotero_Lookup;
    if (!lookup || typeof lookup.addItemsFromIdentifier !== "function"
      || typeof Zotero.Utilities.extractIdentifiers !== "function") {
      Zotero.debug("pdf-fetcher: identifier lookup hook unavailable");
      return;
    }
    let mounted = true;
    const restore = observe(lookup, "addItemsFromIdentifier", (_owner, [textBox, childItem]) => {
      const cycle = this.cycle;
      if (!this.isActive(cycle) || !mounted || childItem) {
        return;
      }
      const ids = Zotero.Utilities.extractIdentifiers((textBox as { value: string }).value);
      if (!ids.length || !ids.every((id) => "DOI" in id || "PMID" in id)) {
        Zotero.debug("pdf-fetcher: skipped lookup with non-DOI/PMID or mixed identifier input");
        return;
      }
      return (items) => {
        if (mounted && this.isActive(cycle) && Array.isArray(items)) {
          this.enqueue(items.map(itemRef));
        }
      };
    });
    this.windows.set(win, () => {
      mounted = false;
      restore();
    });
  }

  static unregisterWindow(win: Window) {
    this.windows.get(win)?.();
    this.windows.delete(win);
  }

  static stop() {
    this.started = false;
    this.updateCycle();
    for (const observer of this.prefObservers.splice(0)) {
      Zotero.Prefs.unregisterObserver(observer);
    }
    for (const restore of this.connectorCleanup.splice(0)) {
      restore();
    }
    for (const win of this.windows.keys()) {
      this.unregisterWindow(win);
    }
    this.authBlocked = false;
  }

  private static updateCycle() {
    this.cycle = this.started && Zotero.Prefs.get(autoFetchPref, true) === true ? {} : undefined;
    this.queue.clear();
    for (const session of this.sessions.keys()) {
      this.forgetSession(session);
    }
  }

  private static isActive(cycle: object | undefined) {
    return addon.data.alive && !!cycle && cycle === this.cycle;
  }

  private static registerConnector() {
    const server = (Zotero as unknown as {
      Server?: { Connector?: ConnectorInternals; Endpoints?: Record<string, { prototype: Methods }> };
    }).Server;
    const manager = server?.Connector?.SessionManager;
    const saveSession = server?.Connector?.SaveSession?.prototype;
    const hasResolvers = server?.Endpoints?.["/connector/hasAttachmentResolvers"]?.prototype;
    const saveFromResolver = server?.Endpoints?.["/connector/saveAttachmentFromResolver"]?.prototype;
    if (typeof manager?.get !== "function" || typeof saveSession?.saveItems !== "function"
      || typeof saveSession.getItemByConnectorKey !== "function"
      || typeof hasResolvers?.init !== "function" || hasResolvers.init.length !== 1
      || typeof saveFromResolver?.init !== "function" || saveFromResolver.init.length !== 1) {
      Zotero.debug("pdf-fetcher: Connector hooks unavailable");
      return;
    }

    this.connectorCleanup.push(observe(saveSession, "saveItems", (owner) => {
      const session = owner as unknown as SaveSession;
      const cycle = this.cycle;
      if (!this.isActive(cycle) || session._action !== "saveItems") {
        return;
      }
      return (result) => {
        if (!this.isActive(cycle) || manager.get(session.id) !== session || !Array.isArray(result)) {
          return;
        }
        const items = new Map<number, ItemRef>();
        for (const item of result as Zotero.Item[]) {
          if (item.isRegularItem() && item.isTopLevelItem()) {
            items.set(item.id, itemRef(item));
          }
        }
        if (items.size) {
          this.forgetSession(session);
          this.sessions.set(session, {
            items,
            timer: setTimeout(() => this.forgetSession(session), SESSION_TTL)
          });
        }
      };
    }));

    for (const endpoint of [hasResolvers, saveFromResolver]) {
      const isResolverCheck = endpoint === hasResolvers;
      this.connectorCleanup.push(observe(endpoint, "init", (_owner, [request]) => {
        const cycle = this.cycle;
        if (!this.isActive(cycle)) {
          return;
        }
        const data = (request as { data?: { sessionID?: unknown; itemID?: unknown } })?.data;
        if (typeof data?.sessionID !== "string"
          || (typeof data.itemID !== "string" && typeof data.itemID !== "number")) {
          return;
        }
        const sessionID = data.sessionID;
        const connectorKey = data.itemID;
        const session = manager.get(sessionID);
        if (!session) {
          Zotero.debug("pdf-fetcher: Connector save session not found");
          return;
        }
        const tracked = this.sessions.get(session);
        const item = tracked && session.getItemByConnectorKey(connectorKey);
        const ref = item && tracked?.items.get(item.id);
        if (!ref || !tracked) {
          return;
        }
        return (result) => {
          if (!this.isActive(cycle) || manager.get(sessionID) !== session
            || this.sessions.get(session) !== tracked || !tracked.items.has(ref.id)) {
            return;
          }
          const [status, contentType, body] = Array.isArray(result) ? result : [];
          if (isResolverCheck && status === 200 && contentType === "application/json" && body === "true") {
            return;
          }

          tracked.items.delete(ref.id);
          if (!tracked.items.size) {
            this.forgetSession(session);
          }
          const missedPDF = isResolverCheck
            ? status === 200 && contentType === "application/json" && body === "false"
            : status === 500 && contentType === "text/plain" && body === "Failed to save an attachment";
          if (missedPDF && session.getItemByConnectorKey(connectorKey)?.id === ref.id) {
            this.enqueue([ref]);
          }
          else if (isResolverCheck || status !== 201) {
            Zotero.debug("pdf-fetcher: skipped unrecognized Connector resolver result");
          }
        };
      }));
    }
  }

  private static forgetSession(session: SaveSession) {
    const tracked = this.sessions.get(session);
    if (tracked) {
      clearTimeout(tracked.timer);
      this.sessions.delete(session);
    }
  }

  private static enqueue(refs: ItemRef[]) {
    if (this.authBlocked) {
      return;
    }
    for (const ref of refs) {
      if (!this.queue.has(ref.id) && PdfFetcher.canAutoFetch(ref)) {
        this.queue.set(ref.id, ref);
      }
    }
    void this.drain().catch(() => Zotero.debug("pdf-fetcher: automatic queue failed"));
  }

  private static async drain() {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      for (const [id, ref] of this.queue) {
        this.queue.delete(id);
        const cycle = this.cycle;
        const revision = this.tokenRevision;
        if (await PdfFetcher.fetchItem(ref, () => this.isActive(cycle)) === "auth"
          && this.isActive(cycle) && revision === this.tokenRevision) {
          this.authBlocked = true;
          this.queue.clear();
          break;
        }
      }
    }
    finally {
      this.draining = false;
    }
  }
}

// Observe the original promise without replacing it or changing rejection
// semantics. The Connector server dispatches by init.length (must stay 1).
function observe(
  owner: Methods,
  key: string,
  before: (receiver: Methods, args: unknown[]) => ((result: unknown) => void) | undefined
) {
  const original = owner[key] as (this: Methods, ...args: unknown[]) => unknown;
  let observing = true;
  const wrapped = function (this: Methods, first: unknown, ...rest: unknown[]) {
    const args = arguments.length ? [first, ...rest] : [];
    let after: ReturnType<typeof before>;
    try {
      if (observing) {
        after = before(this, args);
      }
    }
    catch {
      Zotero.debug(`pdf-fetcher: could not observe ${key}`);
    }
    const result = original.apply(this, args);
    if (after) {
      void Promise.resolve(result).then(after).catch(() => Zotero.debug(`pdf-fetcher: ${key} did not complete`));
    }
    return result;
  };
  owner[key] = wrapped;
  return () => {
    observing = false;
    if (owner[key] === wrapped) {
      owner[key] = original;
    }
  };
}
