const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeBrowser, loadPage, flush } = require("./helpers");

// A Shorts page with content.js running, answering ticks with `status`.
async function shortsPage({ path = "/shorts/aaa", status = {}, before, fail = false } = {}) {
  const reply = { remaining: 600, locked: false, finishing: false, ...status };
  const fake = fakeBrowser({
    onSend: async () => {
      if (fail) throw new Error("Could not establish connection");
      return { ...reply };
    },
  });
  const page = loadPage({
    url: `https://www.youtube.com${path}`,
    html: `<!doctype html><html><head></head><body>${before || ""}</body></html>`,
    scripts: [],
    browser: fake.browser,
  });
  const run = () => page.evaluate(require("./helpers").read("content.js"));
  const api = {
    ...page,
    reply,
    sent: fake.calls.sent,
    ticks: () => fake.calls.sent.filter((m) => m.type === "tick"),
    lastTick: () => api.ticks().at(-1),
    pill: () => page.document.getElementById("shorts-break-pill"),
    pills: () => page.document.querySelectorAll("#shorts-break-pill"),
    start: async () => {
      run();
      await flush();
    },
    // One more interval tick.
    step: async () => page.clock.advance(1000),
    navigate: (p) => page.window.history.pushState({}, "", p),
    video: (props) => addVideo(page.document, props),
  };
  return api;
}

function addVideo(document, { paused = false, ended = false, readyState = 4, currentTime = 0 } = {}) {
  const v = document.createElement("video");
  const state = { paused, ended, readyState, currentTime, pauses: 0 };
  for (const key of ["paused", "ended", "readyState", "currentTime"]) {
    Object.defineProperty(v, key, { get: () => state[key], set: (x) => (state[key] = x), configurable: true });
  }
  v.pause = () => {
    state.paused = true;
    state.pauses++;
  };
  document.body.appendChild(v);
  return state;
}

test("on other YouTube pages", async (t) => {
  await t.test("shows no timer and sends nothing", async () => {
    const p = await shortsPage({ path: "/watch?v=abc" });
    await p.start();
    await p.step();
    assert.equal(p.pill(), null);
    assert.equal(p.ticks().length, 0);
  });
  await t.test("hides the timer after leaving Shorts", async () => {
    const p = await shortsPage();
    await p.start();
    assert.equal(p.pill().hidden, false);
    p.navigate("/feed/subscriptions");
    await p.step();
    assert.equal(p.pill().hidden, true);
  });
  await t.test("shows it again on coming back", async () => {
    const p = await shortsPage();
    await p.start();
    p.navigate("/");
    await p.step();
    p.navigate("/shorts/bbb");
    await p.step();
    assert.equal(p.pill().hidden, false);
  });
});

test("the timer pill", async (t) => {
  await t.test("appears with the time left", async () => {
    const p = await shortsPage();
    p.video({ currentTime: 0.5 });
    await p.start();
    assert.equal(p.pill().textContent, "⏱ 10:00");
  });
  await t.test("says paused when nothing plays", async () => {
    const p = await shortsPage();
    p.video({ paused: true });
    await p.start();
    assert.equal(p.pill().textContent, "⏱ 10:00 · paused");
  });
  await t.test("says paused when there is no video yet", async () => {
    const p = await shortsPage();
    await p.start();
    assert.equal(p.pill().textContent, "⏱ 10:00 · paused");
  });
  await t.test("is not red with more than a minute left", async () => {
    const p = await shortsPage({ status: { remaining: 61 } });
    await p.start();
    assert.equal(p.pill().classList.contains("shorts-break-warn"), false);
  });
  await t.test("turns red for the last minute", async () => {
    const p = await shortsPage({ status: { remaining: 60 } });
    await p.start();
    assert.equal(p.pill().classList.contains("shorts-break-warn"), true);
  });
  await t.test("says the Short will finish once time is up", async () => {
    const p = await shortsPage({ status: { remaining: 0, finishing: true } });
    p.video();
    await p.start();
    assert.equal(p.pill().textContent, "⏱ 0:00 · locks when this Short ends");
    assert.equal(p.pill().classList.contains("shorts-break-warn"), true);
  });
  await t.test("updates every second", async () => {
    const p = await shortsPage();
    await p.start();
    p.reply.remaining = 599;
    await p.step();
    assert.equal(p.pill().textContent, "⏱ 9:59 · paused");
  });
  await t.test("reuses one element", async () => {
    const p = await shortsPage();
    await p.start();
    await p.clock.advance(5000);
    assert.equal(p.pills().length, 1);
  });
  await t.test("removes a pill a previous version left behind", async () => {
    const p = await shortsPage({ before: '<div id="shorts-break-pill">⏱ 4:12</div>' });
    await p.start();
    assert.equal(p.pills().length, 1);
    assert.equal(p.pill().textContent, "⏱ 10:00 · paused");
  });
  await t.test("removes several stale pills", async () => {
    const p = await shortsPage({ before: '<div id="shorts-break-pill">a</div><div id="shorts-break-pill">b</div>' });
    await p.start();
    assert.equal(p.pills().length, 1);
  });
  await t.test("stays as it was when the add-on can't be reached", async () => {
    const p = await shortsPage({ fail: true });
    await p.start();
    await p.step();
    assert.equal(p.pill(), null);
  });
});

test("ticks sent to the background", async (t) => {
  await t.test("one at load and one per second", async () => {
    const p = await shortsPage();
    await p.start();
    await p.clock.advance(3000);
    assert.equal(p.ticks().length, 4);
  });
  await t.test("carry the Short's id", async () => {
    const p = await shortsPage({ path: "/shorts/xYz_123" });
    await p.start();
    assert.equal(p.lastTick().id, "xYz_123");
  });
  await t.test("count a playing Short", async () => {
    const p = await shortsPage();
    p.video({ currentTime: 1.2 });
    await p.start();
    assert.deepEqual({ ...p.lastTick() }, { type: "tick", id: "aaa", active: true, playing: true, finished: false });
  });
  await t.test("do not count a paused Short", async () => {
    const p = await shortsPage();
    p.video({ paused: true });
    await p.start();
    assert.equal(p.lastTick().playing, false);
    assert.equal(p.lastTick().active, false);
  });
  await t.test("do not count a video still loading", async () => {
    const p = await shortsPage();
    p.video({ readyState: 2 });
    await p.start();
    assert.equal(p.lastTick().active, false);
  });
  await t.test("do not count an ended video", async () => {
    const p = await shortsPage();
    p.video({ ended: true });
    await p.start();
    assert.equal(p.lastTick().active, false);
  });
  await t.test("do not count a tab in the background", async () => {
    const p = await shortsPage();
    p.video();
    Object.defineProperty(p.document, "visibilityState", { value: "hidden", configurable: true });
    await p.start();
    assert.equal(p.lastTick().active, false);
    assert.equal(p.lastTick().playing, false);
  });
  await t.test("pick the playing video among preloaded ones", async () => {
    const p = await shortsPage();
    p.video({ paused: true });
    p.video({ currentTime: 3 });
    p.video({ paused: true });
    await p.start();
    assert.equal(p.lastTick().playing, true);
  });
});

test("each second of a Short counts once", async (t) => {
  await t.test("the same second twice counts once", async () => {
    const p = await shortsPage();
    const v = p.video({ currentTime: 4.1 });
    await p.start();
    v.currentTime = 4.8;
    await p.step();
    assert.deepEqual(p.ticks().map((m) => m.playing), [true, false]);
  });
  await t.test("says a rewatch isn't counting", async () => {
    const p = await shortsPage();
    const v = p.video({ currentTime: 4.1 });
    await p.start();
    v.currentTime = 4.5;
    await p.step();
    assert.equal(p.pill().textContent, "⏱ 10:00 · rewatch, not counting");
  });
  await t.test("new seconds keep counting", async () => {
    const p = await shortsPage();
    const v = p.video({ currentTime: 0 });
    await p.start();
    for (const t of [1, 2, 3]) {
      v.currentTime = t;
      await p.step();
    }
    assert.deepEqual(p.ticks().map((m) => m.playing), [true, true, true, true]);
  });
  await t.test("a loop back to the start doesn't count again", async () => {
    const p = await shortsPage();
    const v = p.video({ currentTime: 0 });
    await p.start();
    for (const t of [1, 2, 3, 0.2, 1.1]) {
      v.currentTime = t;
      await p.step();
    }
    assert.deepEqual(p.ticks().map((m) => m.playing), [true, true, true, true, false, false]);
  });
  await t.test("seconds skipped by timer jitter count as watched", async () => {
    const p = await shortsPage();
    const v = p.video({ currentTime: 1.0 });
    await p.start();
    v.currentTime = 2.9; // second 2 was never sampled
    await p.step();
    v.currentTime = 0.5; // loop
    await p.step();
    v.currentTime = 2.2;
    await p.step();
    assert.equal(p.lastTick().playing, false);
  });
  await t.test("a seek forward does not mark the skipped part watched", async () => {
    const p = await shortsPage();
    const v = p.video({ currentTime: 1 });
    await p.start();
    v.currentTime = 20;
    await p.step();
    v.currentTime = 10;
    await p.step();
    assert.equal(p.lastTick().playing, true);
  });
  await t.test("scrolling back to a recent Short doesn't count again", async () => {
    const p = await shortsPage();
    const v = p.video({ currentTime: 5 });
    await p.start();
    p.navigate("/shorts/bbb");
    v.currentTime = 5;
    await p.step();
    p.navigate("/shorts/aaa");
    await p.step();
    assert.deepEqual(p.ticks().map((m) => m.playing), [true, true, false]);
  });
  await t.test("remembers only the last three Shorts", async () => {
    const p = await shortsPage();
    const v = p.video({ currentTime: 5 });
    await p.start();
    for (const id of ["bbb", "ccc", "ddd", "aaa"]) {
      p.navigate(`/shorts/${id}`);
      await p.step();
    }
    assert.equal(p.lastTick().playing, true);
  });
  await t.test("revisiting a Short keeps it among the remembered three", async () => {
    const p = await shortsPage();
    const v = p.video({ currentTime: 5 });
    await p.start();
    for (const id of ["bbb", "aaa", "ccc", "ddd", "aaa"]) {
      p.navigate(`/shorts/${id}`);
      await p.step();
    }
    assert.equal(p.lastTick().playing, false);
  });
});

test("finishing the last Short", async (t) => {
  await t.test("reports a loop back to the start", async () => {
    const p = await shortsPage();
    const v = p.video({ currentTime: 28 });
    await p.start();
    v.currentTime = 29;
    await p.step();
    v.currentTime = 0.3;
    await p.step();
    assert.deepEqual(p.ticks().map((m) => m.finished), [false, false, true]);
  });
  await t.test("does not report small backward jitter", async () => {
    const p = await shortsPage();
    const v = p.video({ currentTime: 5 });
    await p.start();
    v.currentTime = 4.5;
    await p.step();
    assert.equal(p.lastTick().finished, false);
  });
  await t.test("reports an ended video", async () => {
    const p = await shortsPage();
    p.video({ ended: true });
    await p.start();
    assert.equal(p.lastTick().finished, true);
  });
  await t.test("does not call moving to another Short a loop", async () => {
    const p = await shortsPage();
    const v = p.video({ currentTime: 20 });
    await p.start();
    p.navigate("/shorts/bbb");
    v.currentTime = 0.2;
    await p.step();
    assert.equal(p.lastTick().finished, false);
    assert.equal(p.lastTick().id, "bbb");
  });
});

test("when locked", async (t) => {
  await t.test("pauses every video on the page", async () => {
    const p = await shortsPage({ status: { locked: true, remaining: 0 } });
    const a = p.video();
    const b = p.video({ currentTime: 3 });
    await p.start();
    assert.equal(a.pauses, 1);
    assert.equal(b.pauses, 1);
  });
  await t.test("shows no timer", async () => {
    const p = await shortsPage({ status: { locked: true, remaining: 0 } });
    await p.start();
    assert.equal(p.pill(), null);
  });
  await t.test("keeps pausing while the redirect happens", async () => {
    const p = await shortsPage({ status: { locked: true, remaining: 0 } });
    const v = p.video();
    await p.start();
    v.paused = false;
    await p.step();
    assert.equal(v.pauses, 2);
  });
});
