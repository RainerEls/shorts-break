const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBackground } = require("./helpers");

const SHORT = "https://www.youtube.com/shorts/aaa";
const GAMES_PAGE = "moz-extension://test-uuid/games.html";
const tab = (id = 1, url = SHORT) => ({ id, url });

// One playing tick per wall-clock second, as content.js sends them.
async function play(bg, seconds, msg = {}) {
  let status;
  for (let i = 0; i < seconds; i++) {
    await bg.clock.advance(1000);
    status = await bg.send({ type: "tick", id: "aaa", active: true, playing: true, ...msg }, tab());
  }
  return status;
}

async function tick(bg, msg, sender = tab()) {
  await bg.clock.advance(1000);
  return bg.send({ type: "tick", ...msg }, sender);
}

async function solveAll(bg) {
  let status;
  for (const game of ["sudoku", "math", "memory"]) status = await bg.send({ type: "solved", game });
  return status;
}

// With a one-minute budget, run it down to 0:00 on Short "aaa".
async function runOut(bg) {
  return play(bg, 60);
}

const oneMinute = (extra = {}) => ({ storage: { settings: { limitMinutes: 1 } }, ...extra });

test("startup", async (t) => {
  await t.test("starts with the default ten minutes", async () => {
    const bg = await loadBackground();
    const s = await bg.send({ type: "status" });
    assert.equal(s.remaining, 600);
    assert.equal(s.limitSeconds, 600);
    assert.equal(s.locked, false);
    assert.equal(s.finishing, false);
    assert.deepEqual({ ...s.solved }, {});
  });
  await t.test("uses stored settings, filling gaps with defaults", async () => {
    const bg = await loadBackground({ storage: { settings: { limitMinutes: 3 } } });
    const s = await bg.send({ type: "status" });
    assert.equal(s.remaining, 180);
    assert.equal(s.settings.limitMinutes, 3);
    assert.equal(s.settings.sudokuDifficulty, "medium");
    assert.equal(s.settings.mathProblems, 10);
  });
  await t.test("restores a stored state", async () => {
    const bg = await loadBackground({ storage: { state: { remaining: 42, locked: false, solved: {} } } });
    assert.equal((await bg.send({ type: "status" })).remaining, 42);
  });
  await t.test("restores a lock across restarts", async () => {
    const bg = await loadBackground({ storage: { state: { remaining: 0, locked: true, solved: { math: true } } } });
    const s = await bg.send({ type: "status" });
    assert.equal(s.locked, true);
    assert.equal(s.solved.math, true);
  });
  await t.test("sets the badge to the minutes left", async () => {
    const bg = await loadBackground();
    assert.equal(bg.calls.badge.at(-1), "10");
  });
  await t.test("keeps the badge to two characters", async () => {
    for (const [limitMinutes, expected] of [[1, "1"], [99, "99"], [100, "2h"], [120, "2h"], [121, "3h"], [240, "4h"]]) {
      const bg = await loadBackground({ storage: { settings: { limitMinutes } } });
      assert.equal(bg.calls.badge.at(-1), expected, `${limitMinutes} minutes`);
      assert.ok([...expected].length <= 2);
    }
  });
  await t.test("shows a lock on the badge when locked", async () => {
    const bg = await loadBackground({ storage: { state: { remaining: 0, locked: true, solved: {} } } });
    assert.equal(bg.calls.badge.at(-1), "🔒");
    assert.equal(bg.calls.badgeColor.at(-1), "#ff4e45");
  });
});

test("counting time", async (t) => {
  await t.test("counts down one second per playing tick", async () => {
    const bg = await loadBackground();
    const s = await play(bg, 5);
    assert.equal(s.remaining, 595);
  });
  await t.test("does not count ticks that aren't playing", async () => {
    const bg = await loadBackground();
    const s = await tick(bg, { id: "aaa", active: false, playing: false });
    assert.equal(s.remaining, 600);
  });
  await t.test("does not count a rewatch", async () => {
    const bg = await loadBackground();
    const s = await tick(bg, { id: "aaa", active: true, playing: false });
    assert.equal(s.remaining, 600);
  });
  await t.test("counts two tabs ticking in the same second once", async () => {
    const bg = await loadBackground();
    await bg.clock.advance(1000);
    await bg.send({ type: "tick", id: "aaa", active: true, playing: true }, tab(1));
    await bg.clock.advance(100);
    const s = await bg.send({ type: "tick", id: "bbb", active: true, playing: true }, tab(2, "https://www.youtube.com/shorts/bbb"));
    assert.equal(s.remaining, 599);
  });
  await t.test("counts ticks 900 ms apart", async () => {
    const bg = await loadBackground();
    await bg.clock.advance(1000);
    await bg.send({ type: "tick", id: "aaa", active: true, playing: true }, tab());
    await bg.clock.advance(900);
    const s = await bg.send({ type: "tick", id: "aaa", active: true, playing: true }, tab());
    assert.equal(s.remaining, 598);
  });
  await t.test("saves the remaining time", async () => {
    const bg = await loadBackground();
    await play(bg, 3);
    assert.equal(bg.data.state.remaining, 597);
  });
  await t.test("rounds the badge up to whole minutes", async () => {
    const bg = await loadBackground();
    await play(bg, 61);
    assert.equal(bg.calls.badge.at(-1), "9");
  });
  await t.test("serialises concurrent ticks", async () => {
    const bg = await loadBackground();
    await bg.clock.advance(1000);
    const [a, b] = await Promise.all([
      bg.send({ type: "tick", id: "aaa", active: true, playing: true }, tab(1)),
      bg.send({ type: "tick", id: "aaa", active: true, playing: true }, tab(2)),
    ]);
    assert.equal(a.remaining, 599);
    assert.equal(b.remaining, 599);
  });
});

test("when time runs out", async (t) => {
  await t.test("lets the current Short finish instead of locking", async () => {
    const bg = await loadBackground(oneMinute({ tabs: [tab()] }));
    const s = await runOut(bg);
    assert.equal(s.remaining, 0);
    assert.equal(s.finishing, true);
    assert.equal(s.locked, false);
    assert.equal(bg.calls.updated.length, 0);
  });
  await t.test("remembers which Short and when", async () => {
    const bg = await loadBackground(oneMinute());
    await runOut(bg);
    assert.equal(bg.data.state.finishing.id, "aaa");
    assert.equal(bg.data.state.finishing.since, bg.clock.now());
  });
  await t.test("keeps going while the same Short plays", async () => {
    const bg = await loadBackground(oneMinute());
    await runOut(bg);
    for (let i = 0; i < 30; i++) {
      const s = await tick(bg, { id: "aaa", active: true, playing: false });
      assert.equal(s.locked, false);
    }
  });
  await t.test("stops counting while finishing", async () => {
    const bg = await loadBackground(oneMinute());
    await runOut(bg);
    const s = await tick(bg, { id: "aaa", active: true, playing: true });
    assert.equal(s.remaining, 0);
  });
  await t.test("locks when the Short ends", async () => {
    const bg = await loadBackground(oneMinute({ tabs: [tab()] }));
    await runOut(bg);
    const s = await tick(bg, { id: "aaa", active: true, playing: false, finished: true });
    assert.equal(s.locked, true);
    assert.equal(s.finishing, false);
  });
  await t.test("locks when another Short starts playing", async () => {
    const bg = await loadBackground(oneMinute());
    await runOut(bg);
    const s = await tick(bg, { id: "bbb", active: true, playing: true });
    assert.equal(s.locked, true);
  });
  await t.test("does not lock for a paused Short in another tab", async () => {
    const bg = await loadBackground(oneMinute());
    await runOut(bg);
    const s = await tick(bg, { id: "bbb", active: false, playing: false }, tab(2, "https://www.youtube.com/shorts/bbb"));
    assert.equal(s.locked, false);
  });
  await t.test("locks after three minutes however the Short is doing", async () => {
    const bg = await loadBackground(oneMinute());
    await runOut(bg);
    await bg.clock.advance(3 * 60 * 1000);
    let s = await bg.send({ type: "tick", id: "aaa", active: false, playing: false }, tab());
    assert.equal(s.locked, false, "exactly three minutes is still allowed");
    s = await tick(bg, { id: "aaa", active: false, playing: false });
    assert.equal(s.locked, true);
  });
  await t.test("survives a restart while finishing", async () => {
    const first = await loadBackground(oneMinute());
    await runOut(first);
    const bg = await loadBackground({ storage: first.data });
    assert.equal((await bg.send({ type: "status" })).finishing, true);
    const s = await tick(bg, { id: "aaa", active: true, playing: false, finished: true });
    assert.equal(s.locked, true);
  });
  await t.test("reads a state saved before finishing existed", async () => {
    const bg = await loadBackground({ storage: { settings: { limitMinutes: 1 }, state: { remaining: 2, locked: false, solved: {} } } });
    let s = await play(bg, 1);
    assert.equal(s.finishing, false);
    s = await play(bg, 1);
    assert.equal(s.finishing, true);
  });
});

test("locking", async (t) => {
  async function locked(extra) {
    const bg = await loadBackground(oneMinute(extra));
    await runOut(bg);
    await tick(bg, { id: "aaa", active: true, playing: false, finished: true });
    return bg;
  }
  await t.test("sends every open Shorts tab to the puzzles", async () => {
    const tabs = [tab(1), tab(2, "https://m.youtube.com/shorts/bbb"), { id: 3, url: "https://www.youtube.com/watch?v=x" }];
    const bg = await locked({ tabs });
    const ids = bg.calls.updated.map((u) => u.id).sort();
    assert.deepEqual(ids, [1, 2]);
  });
  await t.test("passes the Short's URL to the puzzle page", async () => {
    const bg = await locked({ tabs: [tab()] });
    assert.equal(bg.calls.updated[0].url, `${GAMES_PAGE}?from=${encodeURIComponent(SHORT)}`);
  });
  await t.test("clears solved puzzles and saved puzzle progress", async () => {
    const bg = await loadBackground(oneMinute({ storage: { settings: { limitMinutes: 1 }, puzzles: { sudoku: {} } } }));
    await runOut(bg);
    const s = await tick(bg, { id: "aaa", active: true, playing: false, finished: true });
    assert.deepEqual({ ...s.solved }, {});
    assert.equal("puzzles" in bg.data, false);
  });
  await t.test("shows the lock on the badge", async () => {
    const bg = await locked();
    assert.equal(bg.calls.badge.at(-1), "🔒");
  });
  await t.test("saves the lock", async () => {
    const bg = await locked();
    assert.equal(bg.data.state.locked, true);
    assert.equal(bg.data.state.finishing, null);
  });
  await t.test("redirects a tab that ticks while locked", async () => {
    const bg = await locked();
    const before = bg.calls.updated.length;
    await tick(bg, { id: "ccc", active: true, playing: true }, tab(7, "https://www.youtube.com/shorts/ccc"));
    assert.equal(bg.calls.updated.length, before + 1);
    assert.equal(bg.calls.updated.at(-1).id, 7);
  });
  await t.test("does not count time while locked", async () => {
    const bg = await locked();
    const s = await tick(bg, { id: "ccc", active: true, playing: true });
    assert.equal(s.remaining, 0);
  });
});

test("tab navigation", async (t) => {
  await t.test("redirects a tab that opens a Short while locked", async () => {
    const bg = await loadBackground({ storage: { state: { remaining: 0, locked: true, solved: {} } } });
    await bg.tabUpdated(5, { url: "https://www.youtube.com/shorts/xyz" });
    assert.deepEqual(bg.calls.updated, [{ id: 5, url: `${GAMES_PAGE}?from=${encodeURIComponent("https://www.youtube.com/shorts/xyz")}` }]);
  });
  await t.test("leaves the rest of YouTube alone while locked", async () => {
    const bg = await loadBackground({ storage: { state: { remaining: 0, locked: true, solved: {} } } });
    await bg.tabUpdated(5, { url: "https://www.youtube.com/watch?v=xyz" });
    await bg.tabUpdated(5, { url: "https://www.youtube.com/" });
    assert.equal(bg.calls.updated.length, 0);
  });
  await t.test("ignores updates without a URL change", async () => {
    const bg = await loadBackground({ storage: { state: { remaining: 0, locked: true, solved: {} } } });
    await bg.tabUpdated(5, { status: "complete" });
    assert.equal(bg.calls.updated.length, 0);
  });
  await t.test("lets Shorts open while unlocked", async () => {
    const bg = await loadBackground();
    await bg.tabUpdated(5, { url: "https://www.youtube.com/shorts/xyz" });
    assert.equal(bg.calls.updated.length, 0);
  });
});

test("Shorts URL pattern", async (t) => {
  const bg = await loadBackground();
  const matches = (url) => bg.evaluate(`SHORTS_PATTERN.test(${JSON.stringify(url)})`);
  for (const url of [
    "https://www.youtube.com/shorts/abc",
    "http://www.youtube.com/shorts/abc",
    "https://youtube.com/shorts/abc",
    "https://m.youtube.com/shorts/abc",
    "https://www.youtube.com/shorts",
    "https://www.youtube.com/shorts?feature=share",
    "https://WWW.YOUTUBE.COM/SHORTS/abc",
  ]) {
    await t.test(`matches ${url}`, () => assert.equal(matches(url), true));
  }
  for (const url of [
    "https://www.youtube.com/watch?v=abc",
    "https://www.youtube.com/shortsfeed",
    "https://www.youtube.com/@channel/shorts",
    "https://notyoutube.com/shorts/abc",
    "https://youtube.com.evil.example/shorts/abc",
    "https://www.youtube.com/results?q=/shorts/",
  ]) {
    await t.test(`does not match ${url}`, () => assert.equal(matches(url), false));
  }
});

test("solving puzzles", async (t) => {
  const lockedState = (solved = {}) => ({ storage: { settings: { limitMinutes: 1 }, state: { remaining: 0, locked: true, solved } } });

  await t.test("marks one puzzle solved", async () => {
    const bg = await loadBackground(lockedState());
    const s = await bg.send({ type: "solved", game: "math" });
    assert.equal(s.solved.math, true);
    assert.equal(s.locked, true);
  });
  await t.test("unlocks and refills the timer once all three are solved", async () => {
    const bg = await loadBackground(lockedState());
    const s = await solveAll(bg);
    assert.equal(s.locked, false);
    assert.equal(s.remaining, 60);
    assert.deepEqual({ ...s.solved }, {});
    assert.equal(bg.calls.badge.at(-1), "1");
  });
  await t.test("unlocks whatever the order", async () => {
    const bg = await loadBackground(lockedState());
    for (const game of ["memory", "sudoku", "math"]) await bg.send({ type: "solved", game });
    assert.equal((await bg.send({ type: "status" })).locked, false);
  });
  await t.test("keeps puzzles solved before a restart", async () => {
    const bg = await loadBackground(lockedState({ sudoku: true, math: true }));
    const s = await bg.send({ type: "solved", game: "memory" });
    assert.equal(s.locked, false);
  });
  await t.test("clears saved puzzle progress on unlock", async () => {
    const bg = await loadBackground({ storage: { ...lockedState().storage, puzzles: { sudoku: { entries: [] } } } });
    await solveAll(bg);
    assert.equal("puzzles" in bg.data, false);
  });
  await t.test("ignores an unknown puzzle", async () => {
    const bg = await loadBackground(lockedState());
    const s = await bg.send({ type: "solved", game: "chess" });
    assert.equal(s.solved.chess, undefined);
  });
  await t.test("ignores solving while unlocked", async () => {
    const bg = await loadBackground();
    const s = await bg.send({ type: "solved", game: "math" });
    assert.equal(s.solved.math, undefined);
    assert.equal(s.remaining, 600);
  });
  await t.test("does not unlock on the same puzzle three times", async () => {
    const bg = await loadBackground(lockedState());
    for (let i = 0; i < 3; i++) await bg.send({ type: "solved", game: "sudoku" });
    assert.equal((await bg.send({ type: "status" })).locked, true);
  });
});

test("changing settings", async (t) => {
  const settings = (s) => ({ type: "settings", settings: { limitMinutes: 10, sudokuDifficulty: "medium", mathProblems: 10, ...s } });

  await t.test("raising the limit adds the difference", async () => {
    const bg = await loadBackground();
    await play(bg, 100);
    const s = await bg.send(settings({ limitMinutes: 15 }));
    assert.equal(s.remaining, 800);
    assert.equal(s.limitSeconds, 900);
  });
  await t.test("lowering the limit takes the difference off", async () => {
    const bg = await loadBackground();
    await play(bg, 100);
    const s = await bg.send(settings({ limitMinutes: 5 }));
    assert.equal(s.remaining, 200);
  });
  await t.test("never leaves more than the new limit", async () => {
    const bg = await loadBackground({ storage: { state: { remaining: 900, locked: false, solved: {} } } });
    const s = await bg.send(settings({ limitMinutes: 5 }));
    assert.equal(s.remaining, 300);
  });
  await t.test("leaves one second rather than locking outright", async () => {
    const bg = await loadBackground();
    await play(bg, 500);
    const s = await bg.send(settings({ limitMinutes: 1 }));
    assert.equal(s.remaining, 1);
    assert.equal(s.locked, false);
    assert.equal(s.finishing, false);
  });
  await t.test("does not unlock a lock", async () => {
    const bg = await loadBackground({ storage: { state: { remaining: 0, locked: true, solved: {} } } });
    const s = await bg.send(settings({ limitMinutes: 60 }));
    assert.equal(s.locked, true);
    assert.equal(s.remaining, 0);
  });
  await t.test("raising the limit while finishing gives time back", async () => {
    const bg = await loadBackground(oneMinute());
    await runOut(bg);
    const s = await bg.send(settings({ limitMinutes: 2 }));
    assert.equal(s.finishing, false);
    assert.equal(s.remaining, 60);
  });
  await t.test("saving the same limit while finishing keeps finishing", async () => {
    const bg = await loadBackground(oneMinute());
    await runOut(bg);
    const s = await bg.send(settings({ limitMinutes: 1 }));
    assert.equal(s.finishing, true);
    assert.equal(s.remaining, 0);
  });
  await t.test("saves the settings", async () => {
    const bg = await loadBackground();
    await bg.send(settings({ sudokuDifficulty: "hard", mathProblems: 5 }));
    assert.equal(bg.data.settings.sudokuDifficulty, "hard");
    assert.equal(bg.data.settings.mathProblems, 5);
  });
  await t.test("fills settings left out with defaults", async () => {
    const bg = await loadBackground();
    const s = await bg.send({ type: "settings", settings: { limitMinutes: 20 } });
    assert.equal(s.settings.sudokuDifficulty, "medium");
    assert.equal(s.settings.mathProblems, 10);
  });
  await t.test("a new limit applies to the next refill", async () => {
    const bg = await loadBackground({ storage: { state: { remaining: 0, locked: true, solved: {} } } });
    await bg.send(settings({ limitMinutes: 2 }));
    const s = await solveAll(bg);
    assert.equal(s.remaining, 120);
  });
});

test("messages", async (t) => {
  await t.test("ignores unknown message types", async () => {
    const bg = await loadBackground();
    assert.equal(await bg.send({ type: "bogus" }), false);
  });
  await t.test("status reports without changing anything", async () => {
    const bg = await loadBackground();
    await bg.clock.advance(5000);
    const s = await bg.send({ type: "status" });
    assert.equal(s.remaining, 600);
  });
  await t.test("status carries everything the pages read", async () => {
    const bg = await loadBackground();
    const s = await bg.send({ type: "status" });
    for (const key of ["remaining", "locked", "finishing", "solved", "limitSeconds", "settings"]) assert.ok(key in s, key);
  });
});
