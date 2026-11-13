const SHORTS_PATTERN = /^https?:\/\/([a-z0-9-]+\.)*youtube\.com\/shorts(\/|$|\?)/i;
const GAMES_URL = browser.runtime.getURL("games.html");
// Longest a Short can run; the Short playing at 0:00 never gets longer than this to finish.
const FINISH_LIMIT_MS = 3 * 60 * 1000;

let settings = { ...SETTINGS_DEFAULTS };
let state = null;
let lastTickAt = 0;

const ready = (async () => {
  const stored = await browser.storage.local.get(["settings", "state"]);
  settings = { ...SETTINGS_DEFAULTS, ...stored.settings };
  state = stored.state || freshState();
  updateBadge();
})();

function freshState() {
  return {
    remaining: settings.limitMinutes * 60,
    locked: false,
    finishing: null,
    solved: {},
  };
}

function save() {
  updateBadge();
  return browser.storage.local.set({ state });
}

function updateBadge() {
  const text = state.locked ? "🔒" : `${Math.ceil(state.remaining / 60)}m`;
  browser.browserAction.setBadgeText({ text });
  browser.browserAction.setBadgeBackgroundColor({
    color: state.locked ? "#ff4e45" : "#3a3f52",
  });
}

function publicState() {
  return {
    remaining: state.remaining,
    locked: state.locked,
    finishing: !!state.finishing,
    solved: state.solved,
    limitSeconds: settings.limitMinutes * 60,
    settings,
  };
}

function redirectTab(tabId, fromUrl) {
  const url = `${GAMES_URL}?from=${encodeURIComponent(fromUrl || "")}`;
  return browser.tabs.update(tabId, { url });
}

async function lockNow() {
  state.locked = true;
  state.finishing = null;
  state.remaining = 0;
  state.solved = {};
  await browser.storage.local.remove("puzzles");
  await save();
  const tabs = await browser.tabs.query({ url: "*://*.youtube.com/shorts/*" });
  await Promise.all(tabs.map((t) => redirectTab(t.id, t.url)));
}

async function onTick(msg, sender) {
  if (state.locked) {
    if (sender.tab) await redirectTab(sender.tab.id, sender.tab.url);
    return publicState();
  }
  const now = Date.now();
  // Time is up: the Short that was playing may finish, and moving on to another one locks.
  if (state.finishing) {
    const movedOn = msg.active && msg.id !== state.finishing.id;
    if (msg.finished || movedOn || now - state.finishing.since > FINISH_LIMIT_MS) await lockNow();
    return publicState();
  }
  // Several visible tabs can tick at once; count each wall-clock second only once.
  if (msg.playing && now - lastTickAt >= 900) {
    lastTickAt = now;
    state.remaining = Math.max(0, state.remaining - 1);
    if (state.remaining === 0) state.finishing = { id: msg.id, since: now };
    await save();
  }
  return publicState();
}

async function onSolved(game) {
  if (!state.locked || !GAMES.includes(game)) return publicState();
  state.solved[game] = true;
  if (GAMES.every((g) => state.solved[g])) {
    state = freshState();
    await browser.storage.local.remove("puzzles");
  }
  await save();
  return publicState();
}

async function onSettings(next) {
  const oldLimit = settings.limitMinutes * 60;
  settings = { ...SETTINGS_DEFAULTS, ...next };
  const newLimit = settings.limitMinutes * 60;
  if (!state.locked) {
    state.remaining = Math.min(newLimit, Math.max(0, state.remaining + newLimit - oldLimit));
    if (state.remaining > 0) state.finishing = null;
    else if (!state.finishing) state.remaining = 1;
  }
  await browser.storage.local.set({ settings });
  await save();
  return publicState();
}

// Serialise handlers so concurrent ticks never interleave their read-modify-write.
let queue = Promise.resolve();
function enqueue(fn) {
  const run = queue.then(() => ready).then(fn);
  queue = run.catch(() => {});
  return run;
}

browser.runtime.onMessage.addListener((msg, sender) => {
  switch (msg.type) {
    case "tick":
      return enqueue(() => onTick(msg, sender));
    case "status":
      return enqueue(() => publicState());
    case "solved":
      return enqueue(() => onSolved(msg.game));
    case "settings":
      return enqueue(() => onSettings(msg.settings));
  }
  return false;
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url || !SHORTS_PATTERN.test(changeInfo.url)) return;
  enqueue(async () => {
    if (state.locked) await redirectTab(tabId, changeInfo.url);
  });
});
