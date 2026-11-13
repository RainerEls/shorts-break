const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeBrowser, loadPage, htmlOf, flush } = require("./helpers");

const SETTINGS = { limitMinutes: 10, sudokuDifficulty: "medium", mathProblems: 10 };

function popup(status) {
  const reply = { remaining: 600, locked: false, finishing: false, solved: {}, limitSeconds: 600, settings: SETTINGS, ...status };
  const fake = fakeBrowser({ onSend: async () => ({ ...reply }) });
  const page = loadPage({ url: "https://ext.test/popup.html", html: htmlOf("popup.html"), scripts: ["lib/common.js", "popup.js"], browser: fake.browser });
  let closed = 0;
  page.window.close = () => closed++;
  const $ = (id) => page.document.getElementById(id);
  return { ...page, ...fake, reply, $, closed: () => closed };
}

test("popup", async (t) => {
  await t.test("shows the time left", async () => {
    const p = popup({ remaining: 125 });
    await flush();
    assert.equal(p.$("label").textContent, "Shorts time left");
    assert.equal(p.$("time").textContent, "2:05");
    assert.equal(p.$("puzzles").hidden, true);
  });
  await t.test("fills the bar by the share left", async () => {
    const p = popup({ remaining: 150, limitSeconds: 600 });
    await flush();
    assert.equal(p.$("bar").style.width, "25%");
  });
  await t.test("says when the last Short is finishing", async () => {
    const p = popup({ remaining: 0, finishing: true });
    await flush();
    assert.equal(p.$("label").textContent, "Locks when this Short ends");
    assert.equal(p.$("time").textContent, "0:00");
  });
  await t.test("shows the lock and puzzle progress", async () => {
    const p = popup({ remaining: 0, locked: true, solved: { sudoku: true } });
    await flush();
    assert.equal(p.$("label").textContent, "Locked · 1 / 3 puzzles solved");
    assert.equal(p.$("time").textContent, "🔒");
    assert.equal(p.$("puzzles").hidden, false);
    assert.ok(p.document.body.classList.contains("locked"));
  });
  await t.test("refreshes every second", async () => {
    const p = popup({ remaining: 300 });
    await flush();
    p.reply.remaining = 299;
    await p.clock.advance(1000);
    assert.equal(p.$("time").textContent, "4:59");
  });
  await t.test("the unlock button opens the puzzles and closes", async () => {
    const p = popup({ remaining: 0, locked: true });
    await flush();
    p.$("puzzles").click();
    assert.deepEqual(p.calls.created, ["moz-extension://test-uuid/games.html"]);
    assert.equal(p.closed(), 1);
  });
  await t.test("the settings button opens the options and closes", async () => {
    const p = popup();
    await flush();
    p.$("settings").click();
    assert.equal(p.calls.optionsOpened, 1);
    assert.equal(p.closed(), 1);
  });
});

function options(settings = SETTINGS) {
  const fake = fakeBrowser({ onSend: async (msg) => (msg.type === "status" ? { settings } : { settings: msg.settings }) });
  const page = loadPage({ url: "https://ext.test/options.html", html: htmlOf("options.html"), scripts: ["options.js"], browser: fake.browser });
  const $ = (id) => page.document.getElementById(id);
  const submit = async () => {
    $("form").dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
    await flush();
  };
  return { ...page, ...fake, $, submit };
}

test("options", async (t) => {
  await t.test("shows the current settings", async () => {
    const p = options({ limitMinutes: 25, sudokuDifficulty: "hard", mathProblems: 4 });
    await flush();
    assert.equal(p.$("limitMinutes").value, "25");
    assert.equal(p.$("sudokuDifficulty").value, "hard");
    assert.equal(p.$("mathProblems").value, "4");
  });
  await t.test("offers the three difficulties", async () => {
    const p = options();
    const values = [...p.$("sudokuDifficulty").options].map((o) => o.value);
    assert.deepEqual(values, ["easy", "medium", "hard"]);
  });
  await t.test("saves numbers, not strings", async () => {
    const p = options();
    await flush();
    p.$("limitMinutes").value = "15";
    p.$("sudokuDifficulty").value = "easy";
    p.$("mathProblems").value = "12";
    await p.submit();
    assert.deepEqual(JSON.parse(JSON.stringify(p.calls.sent.at(-1))), { type: "settings", settings: { limitMinutes: 15, sudokuDifficulty: "easy", mathProblems: 12 } });
  });
  await t.test("confirms the save, then clears the message", async () => {
    const p = options();
    await flush();
    await p.submit();
    assert.equal(p.$("msg").textContent, "Saved.");
    await p.clock.advance(1500);
    assert.equal(p.$("msg").textContent, "");
  });
  await t.test("the fields have the ranges the add-on expects", async () => {
    const p = options();
    assert.equal(p.$("limitMinutes").min, "1");
    assert.equal(p.$("limitMinutes").max, "240");
    assert.equal(p.$("mathProblems").min, "3");
    assert.equal(p.$("mathProblems").max, "30");
    assert.ok(p.$("limitMinutes").required && p.$("mathProblems").required);
  });
});
