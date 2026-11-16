import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { runInNewContext, runInThisContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

// Load just the modules exercised by the mocks, without starting Zotero.
const modules = new Map();
function loadSource(url) {
  if (!url.pathname.endsWith(".json")) url = new URL(url.href + ".ts");
  if (modules.has(url.href)) return modules.get(url.href);
  const source = readFileSync(url, "utf8");
  if (url.pathname.endsWith(".json")) return JSON.parse(source);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  });
  const exports = {};
  modules.set(url.href, exports);
  runInThisContext(`(function (exports, require) { ${outputText}\n })`, { filename: url.href })(
    exports, (specifier) => loadSource(new URL(specifier, url))
  );
  return exports;
}
const { AutoFetch } = loadSource(new URL("../src/modules/AutoFetch", import.meta.url));
const { PdfFetcher } = loadSource(new URL("../src/modules/PdfFetcher", import.meta.url));
const { Preferences } = loadSource(new URL("../src/modules/Preferences", import.meta.url));

const pref = "extensions.zotero.pdfFetcher.autoFetchEnabled";
const token = "extensions.zotero.pdfFetcher.token";
const tag = "fetching PDF";
const yes = [200, "application/json", "true"];
const no = [200, "application/json", "false"];
const miss = [500, "text/plain", "Failed to save an attachment"];
const saved = [201, "text/plain", "PDF"];
const response = (data = {}, code = 200) => ({
  status: 200,
  responseText: JSON.stringify({ code, data })
});
const match = (item, status = 2) => ({
  taskTitle: item.doi,
  taskStatus: status,
  uuid: "mock-task",
  resourceUuid: "mock-resource"
});

let nextID = 0;
function setup(t, { enabled = true, version = "10.0.7" } = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const items = new Map();
  const library = { editable: true, filesEditable: true };
  const sessions = new Map();
  const values = new Map();
  const observers = new Map();
  const calls = { submit: [], list: [], url: [], imports: [], messages: [], logs: [], links: [] };
  const on = {};
  const normalized = (name, full) => full ? name : `extensions.zotero.${name}`;
  const prefs = {
    get: (name, full) => values.get(normalized(name, full)),
    set(name, value, full) {
      const key = normalized(name, full);
      if (values.get(key) === value) return;
      values.set(key, value);
      for (const { observed, listener } of observers.values()) {
        if (observed === key) listener(value);
      }
    },
    registerObserver(name, listener, full) {
      const id = Symbol();
      observers.set(id, { observed: normalized(name, full), listener });
      return id;
    },
    unregisterObserver: (id) => observers.delete(id)
  };
  runInNewContext(readFileSync(new URL("../addon/prefs.js", import.meta.url), "utf8"), {
    pref: (name, value) => prefs.set(name, value, true)
  });
  if (enabled) prefs.set(pref, true, true);
  prefs.set(token, "mock-token");

  class SaveSession {
    constructor(entries, action, id) {
      this.entries = entries;
      this._action = action;
      this.id = id;
      this.items = new Map();
    }
    async saveItems(target) {
      assert.equal(target, "L1");
      await this.waitForSave;
      this.items = new Map(this.entries);
      return [...this.items.values()];
    }
    getItemByConnectorKey(key) {
      return this.items.get(key);
    }
    async updateTags(tags) {
      for (const item of this.items.values()) {
        item.tags = new Map([...item.tags].filter(([, type]) => type === 1));
        for (const text of tags) item.addTag(text, 0);
        await item.saveTx();
      }
    }
  }
  function Check() {}
  function Download() {}
  Check.prototype.init = async function (request) {
    assert.ok(this instanceof Check);
    return request.result;
  };
  Download.prototype.init = async function (request) {
    assert.ok(this instanceof Download);
    return request.result;
  };
  const endpoints = {
    "/connector/hasAttachmentResolvers": Check,
    "/connector/saveAttachmentFromResolver": Download
  };

  globalThis.addon = { data: { alive: true } };
  globalThis.ztoolkit = {
    ProgressWindow: class {
      createLine(line) { calls.messages.push(line); return this; }
      show() {}
    }
  };
  globalThis.Zotero = {
    version,
    Prefs: prefs,
    Items: {
      exists: (id) => items.has(id),
      get: (id) => Array.isArray(id) ? id.map((i) => items.get(i)).filter(Boolean) : items.get(id)
    },
    Libraries: { get: () => library },
    Utilities: {
      extractIdentifiers: (text) => text.split(" ").filter(Boolean).map((id) => (
        id.startsWith("10.") ? { DOI: id } : id.startsWith("pmid:") ? { PMID: id.slice(5) } : { ISBN: id }
      ))
    },
    Server: { Connector: { SaveSession, SessionManager: sessions }, Endpoints: endpoints },
    debug: (line) => calls.logs.push(line),
    launchURL: (url) => calls.links.push(url),
    HTTP: {
      request(_method, url, options) {
        assert.match(url, /^https:\/\/api\.jlss\.vip\//);
        const kind = {
          "/search/trans": "submit", "/task/myHelpList": "list", "/task/clickDownload": "url"
        }[new URL(url).pathname];
        const body = JSON.parse(options.body);
        calls[kind].push(body);
        return on[kind]?.(body) ?? {
          submit: response(), list: response({ dataList: [] }),
          url: response({ code: 0, data: "https://example.invalid/signed.pdf" })
        }[kind];
      }
    },
    Attachments: {
      async importFromURL(options) {
        calls.imports.push(options);
        await on.import?.(options);
        return attach(items.get(options.parentItemID), "pdf");
      }
    }
  };
  const drawWindow = () => {
    const lookup = {
      addItemsFromIdentifier(...args) {
        assert.equal(this, lookup);
        assert.equal(typeof args[2], "function");
        return lookup.result;
      }
    };
    return { Zotero_Lookup: lookup };
  };
  const win = drawWindow();
  const originals = [SaveSession.prototype.saveItems, Check.prototype.init, Download.prototype.init,
    win.Zotero_Lookup.addItemsFromIdentifier];
  AutoFetch.start();
  AutoFetch.registerWindow(win);
  t.after(async () => {
    addon.data.alive = false;
    AutoFetch.stop();
    await setImmediate();
  });

  function article(doi = "10.5555/mock", extra = "") {
    const id = ++nextID;
    const item = {
      id, key: `ITEM${id}`, libraryID: 1, doi, deleted: false, tags: new Map(), attachments: [],
      isRegularItem: () => true,
      isTopLevelItem: () => true,
      getField: (field) => ({ DOI: doi, extra, title: "Synthetic article" })[field],
      hasTag: (text) => item.tags.has(text),
      addTag: (text, type) => item.tags.set(text, type),
      removeTag: (text) => item.tags.delete(text),
      saveTx: async () => {},
      getAttachments: () => item.attachments
    };
    items.set(id, item);
    return item;
  }
  function attach(item, type) {
    const attachment = { id: ++nextID, isPDFAttachment: () => type === "pdf" || type === "linkedPDF" };
    items.set(attachment.id, attachment);
    item.attachments.push(attachment.id);
    return attachment;
  }
  function lookup(value, pending, { target = win, child = false } = {}) {
    const entry = target.Zotero_Lookup;
    entry.result = Promise.resolve(pending);
    const result = entry.addItemsFromIdentifier({ value }, child, () => {});
    assert.equal(result, entry.result);
    return result;
  }
  function connector(entries, action = "saveItems") {
    const session = new SaveSession(entries, action, `SESSION${++nextID}`);
    sessions.set(session.id, session);
    return session;
  }
  function resolve(session, itemID, result, Endpoint = Check) {
    const endpoint = new Endpoint();
    const data = { sessionID: session.id, itemID };
    const args = endpoint.init.length === 1 ? [{ data, result }] : [data, () => {}];
    return endpoint.init(...args);
  }
  return { calls, on, win, originals, SaveSession, Check, Download, lookup, connector, resolve,
    attach, article, sessions, items, library, prefs, observers, drawWindow,
    toggle: (enabled) => prefs.set(pref, enabled, true),
    tick: async (ms = 7000) => { t.mock.timers.tick(ms); await setImmediate(); }
  };
}

test("T01 default off for both sources; manual works", async (t) => {
  const e = setup(t, { enabled: false });
  const item = e.article();
  await e.lookup(item.doi, [item]);
  const session = e.connector([["a", item]]);
  await session.saveItems("L1");
  assert.equal(await e.resolve(session, "a", no), no);
  assert.equal(e.calls.submit.length, 0);
  const manual = PdfFetcher.submitSelectedItems([item]);
  assert.equal(e.calls.submit.length, 1);
  await setImmediate();
  await e.tick();
  await manual;
  assert.equal(e.calls.list.length, 1);
});

test("T02 lookup waits for native completion", async (t) => {
  const e = setup(t);
  const pending = Promise.withResolvers();
  const original = e.lookup("10.5555/mock", pending.promise);
  await e.tick(70000);
  assert.equal(e.calls.submit.length, 0);
  pending.resolve([]);
  assert.deepEqual(await original, []);
});

test("T03 completed lookup with PDF does not submit", async (t) => {
  const e = setup(t);
  const item = e.article();
  e.attach(item, "pdf");
  await e.lookup(item.doi, [item]);
  assert.equal(e.calls.submit.length, 0);
});

test("T04 DOI and PMID: immediate pending state, one check at seven seconds, correct import", async (t) => {
  const e = setup(t, { version: "10.0.8" });
  const a = e.article();
  const b = e.article("", "PMID: 123456");
  e.on.list = () => response({ dataList: [match(a), { ...match(b), taskTitle: "123456" }] });
  await e.lookup(a.doi, [a]);
  await e.lookup("pmid:123456", [b]);
  await setImmediate();
  assert.deepEqual(e.calls.submit, [{ content: a.doi }]);
  assert.equal(a.tags.get(tag), 1);
  await e.tick(6999);
  assert.equal(e.calls.list.length, 0);
  await e.tick(1);
  assert.deepEqual(e.calls.submit, [{ content: a.doi }, { content: "123456" }]);
  assert.equal(e.calls.list.length, 1);
  assert.equal(e.calls.imports[0].parentItemID, a.id);
  assert.equal(a.hasTag(tag), false);
  await e.tick();
  await e.tick(60000);
  assert.equal(e.calls.list.length, 2);
  assert.deepEqual(e.calls.imports.map((options) => options.parentItemID), [a.id, b.id]);
});

test("T05/T06 Connector save and available resolver do not submit", async (t) => {
  const e = setup(t);
  const item = e.article();
  const session = e.connector([["a", item]]);
  await session.saveItems("L1");
  assert.equal(e.calls.submit.length, 0);
  assert.equal(await e.resolve(session, "a", yes), yes);
  const pending = Promise.withResolvers();
  const original = e.resolve(session, "a", pending.promise, e.Download);
  await e.tick(70000);
  assert.equal(e.calls.submit.length, 0);
  pending.resolve(saved);
  assert.equal(await original, saved);
});

test("T07/T08/T09 Connector distinguishes native outcomes and maps batch items", async (t) => {
  const e = setup(t, { version: "10.1.0" });
  const a = e.article("10.5555/a");
  const b = e.article("10.5555/b");
  const c = e.article("10.5555/c");
  const session = e.connector([["a", a], ["b", b], ["c", c]]);
  await session.saveItems("L1");
  assert.equal(await e.resolve(session, "b", yes), yes);
  assert.equal(await e.resolve(session, "b", saved, e.Download), saved);
  assert.equal(await e.resolve(session, "a", no), no);
  assert.equal(await e.resolve(session, "c", yes), yes);
  assert.equal(await e.resolve(session, "c", miss, e.Download), miss);
  assert.deepEqual(e.calls.submit, [{ content: a.doi }]);
  await setImmediate();
  await e.tick();
  assert.deepEqual(e.calls.submit, [{ content: a.doi }, { content: c.doi }]);
  await e.tick();
});

test("T10 missing/untracked sessions, unknown result and rejection preserve native semantics", async (t) => {
  const e = setup(t);
  const item = e.article();
  const session = e.connector([["a", item]]);
  await session.saveItems("L1");
  const error = new Error("native resolver error");
  await assert.rejects(e.resolve(session, "a", Promise.reject(error), e.Download), (err) => err === error);
  const unknown = [500, "text/plain", "Different failure"];
  assert.equal(await e.resolve(session, "a", unknown, e.Download), unknown);
  e.sessions.delete(session.id);
  const lost = [400, "application/json", '{"error":"SESSION_NOT_FOUND"}'];
  assert.equal(await e.resolve(session, "a", lost), lost);
  const snapshot = e.connector([["a", item]], "saveSnapshot");
  await snapshot.saveItems("L1");
  assert.equal(await e.resolve(snapshot, "a", no), no);
  assert.equal(e.calls.submit.length, 0);
  assert.ok(e.calls.logs.length);
});

test("T11/T12 manual and auto share a lock; only manual checks pending entries", async (t) => {
  const e = setup(t);
  const item = e.article();
  const session = e.connector([["a", item]]);
  await session.saveItems("L1");
  const pending = Promise.withResolvers();
  e.on.submit = () => pending.promise;
  const manual = PdfFetcher.submitSelectedItems([item]);
  await e.resolve(session, "a", no);
  await e.resolve(session, "a", no);
  await PdfFetcher.submitSelectedItems([item]);
  assert.equal(e.calls.submit.length, 1);
  pending.resolve(response());
  await setImmediate();
  await e.tick();
  await manual;
  assert.equal(item.hasTag(tag), true);
  await e.lookup(item.doi, [item]);
  assert.equal(e.calls.list.length, 1);
  e.on.list = () => response({ dataList: [match(item)] });
  await PdfFetcher.submitSelectedItems([item]);
  await e.tick(70000);
  assert.equal(e.calls.submit.length, 1);
  assert.equal(e.calls.list.length, 2);
  assert.equal(e.calls.imports.length, 1);
  assert.equal(item.hasTag(tag), false);
});

test("T13 query and download failures keep confirmed submissions pending", async (t) => {
  const e = setup(t);
  const item = e.article();
  e.on.list = () => { throw new Error("synthetic query failure"); };
  await e.lookup(item.doi, [item]);
  await setImmediate();
  await e.tick();
  assert.equal(item.hasTag(tag), true);
  e.on.list = () => response({ dataList: [match(item)] });
  e.on.import = () => { throw new Error("https://example.invalid/?signature=secret"); };
  await PdfFetcher.submitSelectedItems([item]);
  assert.equal(item.hasTag(tag), true);
  assert.equal(e.calls.submit.length, 1);
  assert.doesNotMatch(JSON.stringify([e.calls.logs, e.calls.messages]), /signature|secret/);
});

test("T14 rechecks immediately before import when the user adds a PDF", async (t) => {
  const e = setup(t);
  const item = e.article();
  const url = Promise.withResolvers();
  e.on.list = () => response({ dataList: [match(item)] });
  e.on.url = () => url.promise;
  await e.lookup(item.doi, [item]);
  await setImmediate();
  await e.tick();
  assert.equal(e.calls.url.length, 1);
  e.attach(item, "pdf");
  url.resolve(response({ code: 0, data: "https://example.invalid/signed.pdf" }));
  await setImmediate();
  assert.equal(e.calls.imports.length, 0);
  assert.equal(item.hasTag(tag), false);
});

test("T15 only PDF file records block fetch, even if the file is unavailable", async (t) => {
  const e = setup(t);
  const a = e.article("10.5555/link");
  e.attach(a, "pdfURL");
  e.attach(a, "htmlSnapshot");
  const b = e.article("10.5555/local");
  e.attach(b, "linkedPDF");
  const c = e.article("10.5555/not-synced");
  e.attach(c, "pdf").fileExists = () => false;
  await e.lookup(a.doi + " " + b.doi + " " + c.doi, [a, b, c]);
  assert.deepEqual(e.calls.submit, [{ content: a.doi }]);
  await setImmediate();
  await e.tick();
  assert.equal(e.calls.submit.length, 1);
});

test("T16 other additions, child lookup and mixed input do not submit", async (t) => {
  const e = setup(t);
  const synced = e.article();
  const imported = e.article();
  const manuallyAdded = e.article();
  manuallyAdded.doi = "10.5555/edited";
  await e.lookup("9781234567890", [synced]);
  await e.lookup("10.5555/example 9781234567890", [imported]);
  await e.lookup("10.5555/example", [manuallyAdded], { child: true });
  assert.equal(e.calls.submit.length, 0);
});

test("T17 switch off during submit and seven-second wait, leaves manual available", async (t) => {
  const e = setup(t);
  const a = e.article("10.5555/a");
  const b = e.article("10.5555/b");
  const pending = Promise.withResolvers();
  e.on.submit = () => pending.promise;
  await e.lookup(a.doi + " " + b.doi, [a, b]);
  e.toggle(false);
  pending.resolve(response());
  await setImmediate();
  assert.equal(a.hasTag(tag), true);
  await e.tick();
  assert.equal(e.calls.submit.length, 1);
  assert.equal(e.calls.list.length, 0);
  await PdfFetcher.submitSelectedItems([a]);
  assert.equal(e.calls.submit.length, 1);
  assert.equal(e.calls.list.length, 1);

  e.toggle(true);
  const c = e.article("10.5555/c");
  await e.lookup(c.doi, [c]);
  await setImmediate();
  assert.equal(c.hasTag(tag), true);
  e.toggle(false);
  await e.tick();
  assert.equal(e.calls.list.length, 1);
});

test("T18 switching back on cannot revive lookup or Connector callbacks", async (t) => {
  const e = setup(t);
  const a = e.article("10.5555/a");
  const lookup = Promise.withResolvers();
  const connector = Promise.withResolvers();
  const session = e.connector([["a", a]]);
  await session.saveItems("L1");
  const one = e.lookup(a.doi, lookup.promise);
  const two = e.resolve(session, "a", connector.promise, e.Download);
  e.toggle(false);
  const whileOff = e.article("10.5555/while-off");
  await e.lookup(whileOff.doi, [whileOff]);
  e.toggle(true);
  lookup.resolve([a]);
  connector.resolve(miss);
  await Promise.all([one, two]);
  assert.equal(e.calls.submit.length, 0);
  const b = e.article("10.5555/b");
  await e.lookup(b.doi, [b]);
  assert.deepEqual(e.calls.submit, [{ content: b.doi }]);
  await setImmediate();
  await e.tick();
});

test("T19 multiwindow hooks restore safely; shutdown/reload cannot revive in-flight callbacks", async (t) => {
  const e = setup(t);
  const lookup = e.win.Zotero_Lookup.addItemsFromIdentifier;
  const connector = e.Check.prototype.init;
  AutoFetch.start();
  AutoFetch.registerWindow(e.win);
  assert.equal(e.Check.prototype.init, connector);
  assert.equal(e.Check.prototype.init.length, 1);
  assert.equal(e.win.Zotero_Lookup.addItemsFromIdentifier, lookup);
  const other = e.drawWindow();
  const otherOriginal = other.Zotero_Lookup.addItemsFromIdentifier;
  AutoFetch.registerWindow(other);
  AutoFetch.unregisterWindow(other);
  assert.equal(other.Zotero_Lookup.addItemsFromIdentifier, otherOriginal);

  const pending = Promise.withResolvers();
  const item = e.article();
  const original = e.lookup(item.doi, pending.promise);
  const wrapperFromAnotherPlugin = function (request) {
    return connector.call(this, request);
  };
  e.Check.prototype.init = wrapperFromAnotherPlugin;
  addon.data.alive = false;
  AutoFetch.stop();
  assert.equal(e.observers.size, 0);
  assert.equal(e.Check.prototype.init, wrapperFromAnotherPlugin);
  assert.equal(e.SaveSession.prototype.saveItems, e.originals[0]);
  assert.equal(e.Download.prototype.init, e.originals[2]);
  assert.equal(e.win.Zotero_Lookup.addItemsFromIdentifier, e.originals[3]);
  addon.data.alive = true;
  AutoFetch.start();
  AutoFetch.registerWindow(e.win);
  pending.resolve([item]);
  assert.deepEqual(await original, [item]);
  assert.equal(e.calls.submit.length, 0);
});

test("T20 missing or rejected token stops the batch; new token allows new items", async (t) => {
  const e = setup(t);
  e.prefs.set(token, "");
  const a = e.article("10.5555/a");
  const b = e.article("10.5555/b");
  await e.lookup(a.doi + " " + b.doi, [a, b]);
  await setImmediate();
  await e.lookup(b.doi, [b]);
  assert.equal(e.calls.submit.length, 0);
  assert.equal(e.calls.messages.length, 1);

  e.prefs.set(token, "stale");
  e.on.submit = () => response({}, 501);
  await e.lookup(a.doi + " " + b.doi, [a, b]);
  await setImmediate();
  assert.equal(e.calls.submit.length, 1);
  assert.equal(e.calls.messages.length, 2);
  e.prefs.set(token, "new-token");
  delete e.on.submit;
  const c = e.article("10.5555/c");
  await e.lookup(c.doi, [c]);
  assert.deepEqual(e.calls.submit.map((body) => body.content), [a.doi, c.doi]);
  await setImmediate();
  await e.tick();
  assert.equal(e.calls.list.length, 1);
});

test("T21 read-only, deleted, and moved items cannot receive a PDF", async (t) => {
  const e = setup(t);
  const a = e.article("10.5555/a");
  e.library.filesEditable = false;
  await e.lookup(a.doi, [a]);
  assert.equal(e.calls.submit.length, 0);

  e.library.filesEditable = true;
  const b = e.article("10.5555/b");
  const c = e.article("10.5555/c");
  await e.lookup(a.doi + " " + b.doi + " " + c.doi, [a, b, c]);
  e.items.delete(a.id);
  b.deleted = true;
  c.libraryID = 2;
  await setImmediate();
  await e.tick();
  assert.equal(e.calls.submit.length, 1);
  assert.equal(e.calls.list.length, 0);
  assert.equal(e.calls.imports.length, 0);
});

test("T22 Connector tag and collection update preserves pending tag", async (t) => {
  const e = setup(t);
  const item = e.article();
  const session = e.connector([["a", item]]);
  await session.saveItems("L1");
  await e.resolve(session, "a", no);
  await setImmediate();
  await session.updateTags(["review"]);
  assert.equal(item.tags.get(tag), 1);
  assert.equal(item.tags.get("review"), 0);
  await e.tick();
  await e.resolve(session, "a", no);
  assert.equal(e.calls.submit.length, 1);
});

test("T23 settings open link and persist switch instantly", async (t) => {
  const e = setup(t, { enabled: false });
  function prefsWindow() {
    const fields = new Map(["token", "auto-fetch", "project"].map((id) => {
      const el = new EventTarget();
      const attributes = new Map();
      el.hasAttribute = (name) => attributes.has(name);
      el.setAttribute = (name, value) => attributes.set(name, value);
      return [`pdf-fetcher-${id}`, el];
    }));
    return { document: { getElementById: (id) => fields.get(id) }, fields };
  }
  const first = prefsWindow();
  Preferences.registerPrefsScripts(first);
  const checkbox = first.fields.get("pdf-fetcher-auto-fetch");
  assert.equal(checkbox.checked, false);
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));
  assert.equal(e.prefs.get(pref, true), true);
  const second = prefsWindow();
  Preferences.registerPrefsScripts(second);
  assert.equal(second.fields.get("pdf-fetcher-auto-fetch").checked, true);
  second.fields.get("pdf-fetcher-project").dispatchEvent(new Event("click"));
  assert.deepEqual(e.calls.links, ["https://github.com/HiYvri/pdf-fetcher"]);
});

test("unsupported app version and missing Connector API leave native methods alone", async (t) => {
  const e = setup(t, { version: "11.0.0" });
  assert.equal(e.Check.prototype.init, e.originals[1]);
  assert.equal(e.win.Zotero_Lookup.addItemsFromIdentifier, e.originals[3]);
  AutoFetch.stop();
  Zotero.version = "10.1.0";
  delete Zotero.Server.Endpoints["/connector/saveAttachmentFromResolver"];
  AutoFetch.start();
  assert.equal(e.Check.prototype.init, e.originals[1]);
  assert.equal(e.SaveSession.prototype.saveItems, e.originals[0]);
  assert.ok(e.calls.logs.some((line) => line.includes("hooks unavailable")));
});

test("expired Connector tracking is forgotten without assuming a miss", async (t) => {
  const e = setup(t);
  const item = e.article();
  const session = e.connector([["a", item]]);
  await session.saveItems("L1");
  await e.tick(11 * 60 * 1000);
  await e.resolve(session, "a", no);
  assert.equal(e.calls.submit.length, 0);
});
