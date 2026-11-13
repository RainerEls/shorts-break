const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

// Timers and Date.now driven by hand, so tests step through seconds instantly.
function fakeClock(start = 1_000_000) {
  let now = start;
  let nextId = 1;
  const timers = new Map();

  function add(fn, ms, repeat) {
    const id = nextId++;
    timers.set(id, { fn, at: now + Math.max(0, ms), every: repeat ? Math.max(1, ms) : 0 });
    return id;
  }

  async function advance(ms) {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, t] = due;
      now = t.at;
      if (t.every) t.at += t.every;
      else timers.delete(id);
      await t.fn();
      await flush();
    }
    now = end;
    await flush();
  }

  return {
    now: () => now,
    advance,
    pending: () => timers.size,
    setTimeout: (fn, ms) => add(fn, ms, false),
    setInterval: (fn, ms) => add(fn, ms, true),
    clearTimeout: (id) => timers.delete(id),
    clearInterval: (id) => timers.delete(id),
  };
}

// Lets queued promise callbacks run.
async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}

// The slice of the WebExtension API the add-on uses, recording what it is asked to do.
function fakeBrowser({ storage = {}, tabs = [], onSend } = {}) {
  const calls = { updated: [], created: [], badge: [], badgeColor: [], optionsOpened: 0, sent: [] };
  const listeners = { message: [], tabUpdated: [] };
  const data = structuredClone(storage);

  const browser = {
    runtime: {
      getURL: (p) => `moz-extension://test-uuid/${p}`,
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
      sendMessage: async (msg) => {
        calls.sent.push(msg);
        if (onSend) return onSend(msg);
        throw new Error("no receiver");
      },
      openOptionsPage: () => calls.optionsOpened++,
    },
    storage: {
      local: {
        get: async (keys) => {
          const list = keys == null ? Object.keys(data) : [].concat(keys);
          const out = {};
          for (const k of list) if (k in data) out[k] = structuredClone(data[k]);
          return out;
        },
        set: async (obj) => Object.assign(data, structuredClone(obj)),
        remove: async (keys) => [].concat(keys).forEach((k) => delete data[k]),
      },
    },
    browserAction: {
      setBadgeText: ({ text }) => calls.badge.push(text),
      setBadgeBackgroundColor: ({ color }) => calls.badgeColor.push(color),
    },
    tabs: {
      query: async ({ url }) => {
        const re = new RegExp(`^${url.replace(/[.?+^$|()[\]{}\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
        return tabs.filter((t) => re.test(t.url));
      },
      update: async (id, { url }) => {
        calls.updated.push({ id, url });
        const tab = tabs.find((t) => t.id === id);
        if (tab) tab.url = url;
      },
      create: async ({ url }) => calls.created.push(url),
      onUpdated: { addListener: (fn) => listeners.tabUpdated.push(fn) },
    },
  };

  return { browser, calls, listeners, data, tabs };
}

// background.js in its own context, as Firefox runs it: common.js first, then the script.
async function loadBackground(opts = {}) {
  const clock = fakeClock();
  const fake = fakeBrowser(opts);
  const ctx = vm.createContext({
    browser: fake.browser,
    console,
    structuredClone,
    Date: { now: clock.now },
    setTimeout: clock.setTimeout,
  });
  vm.runInContext(read("lib/common.js"), ctx, { filename: "lib/common.js" });
  vm.runInContext(read("background.js"), ctx, { filename: "background.js" });
  await vm.runInContext("ready", ctx);

  const send = async (msg, tab) => {
    const sender = tab ? { tab } : {};
    const result = fake.listeners.message[0](msg, sender);
    return result === false ? false : await result;
  };
  const tabUpdated = async (tabId, changeInfo) => {
    fake.listeners.tabUpdated.forEach((fn) => fn(tabId, changeInfo));
    await vm.runInContext("queue", ctx);
    await flush();
  };
  const evaluate = (code) => vm.runInContext(code, ctx);

  return { ...fake, ctx, clock, send, tabUpdated, evaluate };
}

// A page from the add-on (or a YouTube page) in jsdom, with the given scripts run in it.
function loadPage({ html = "<!doctype html><html><head></head><body></body></html>", url, scripts, browser, random }) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const clock = fakeClock();
  Object.assign(window, {
    browser,
    setTimeout: clock.setTimeout,
    setInterval: clock.setInterval,
    clearTimeout: clock.clearTimeout,
    clearInterval: clock.clearInterval,
  });
  if (random) window.Math.random = random;
  const ctx = dom.getInternalVMContext();
  const run = (file) => vm.runInContext(read(file), ctx, { filename: file });
  scripts.forEach(run);
  const evaluate = (code) => vm.runInContext(code, ctx);
  return { dom, window, document: window.document, clock, evaluate };
}

function htmlOf(file) {
  // The pages load their scripts at the bottom; the tests run them instead.
  return read(file).replace(/<script\b[^>]*><\/script>/g, "");
}

// Deterministic Math.random replacement (mulberry32).
function seededRandom(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadCommon() {
  const ctx = vm.createContext({});
  vm.runInContext(read("lib/common.js"), ctx);
  return vm.runInContext("({ SETTINGS_DEFAULTS, SUDOKU_CLUES, GAMES, formatTime })", ctx);
}

module.exports = {
  ROOT,
  read,
  flush,
  fakeClock,
  fakeBrowser,
  loadBackground,
  loadPage,
  loadCommon,
  htmlOf,
  seededRandom,
};
