const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBackground, loadPage, htmlOf, flush, seededRandom } = require("./helpers");

const parse = (s) => [...s.replace(/\s/g, "")].map((c) => (c === "." ? 0 : Number(c)));
const PUZZLE = parse("53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79");
const SOLUTION = parse("534678912672195348198342567859761423426853791713924856961537284287419635345286179");
const EMPTY_CELLS = PUZZLE.flatMap((v, i) => (v ? [] : [i]));

const locked = (extra = {}) => ({ remaining: 0, locked: true, solved: {}, ...extra });

// The puzzle page talking to a real background script.
async function gamesPage({ state = locked(), settings = {}, puzzles, from, random = seededRandom(7) } = {}) {
  const storage = { settings: { limitMinutes: 1, ...settings }, state };
  if (puzzles !== null) {
    storage.puzzles = puzzles || { sudoku: { difficulty: settings.sudokuDifficulty || "medium", puzzle: PUZZLE, solution: SOLUTION, entries: PUZZLE.slice() } };
  }
  const bg = await loadBackground({ storage });
  const browser = { ...bg.browser, runtime: { ...bg.browser.runtime, sendMessage: (msg) => bg.send(msg) } };
  const query = from === undefined ? "" : `?from=${encodeURIComponent(from)}`;
  const page = loadPage({
    url: `https://ext.test/games.html${query}`,
    html: htmlOf("games.html"),
    scripts: ["lib/common.js", "lib/sudoku.js", "games.js"],
    browser,
    random,
  });
  await flush();
  const $ = (id) => page.document.getElementById(id);
  const visibleGame = () => [...page.document.querySelectorAll(".game")].filter((s) => !s.hidden).map((s) => s.id);
  return { ...page, bg, $, visibleGame };
}

function key(page, el, k) {
  const e = new page.window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
}

const cells = (p) => [...p.$("sudoku-grid").querySelectorAll("input")];
const boxes = (p) => [...p.$("sudoku-grid").children];

async function typeDigits(p, indexes, valueOf) {
  for (const i of indexes) key(p, cells(p)[i], String(valueOf(i)));
  await flush();
}

test("page state", async (t) => {
  await t.test("starts on the sudoku when locked", async () => {
    const p = await gamesPage();
    assert.deepEqual(p.visibleGame(), ["game-sudoku"]);
    assert.equal(p.$("steps").hidden, false);
  });
  await t.test("skips to the first unsolved puzzle", async () => {
    const p = await gamesPage({ state: locked({ solved: { sudoku: true } }) });
    assert.deepEqual(p.visibleGame(), ["game-math"]);
  });
  await t.test("ticks off solved puzzles in the steps", async () => {
    const p = await gamesPage({ state: locked({ solved: { sudoku: true, math: true } }) });
    const marks = [...p.document.querySelectorAll("#steps button")].map((b) => [b.dataset.game, b.querySelector(".check").textContent, b.classList.contains("solved")]);
    assert.deepEqual(marks, [["sudoku", "✓", true], ["math", "✓", true], ["memory", "○", false]]);
    assert.deepEqual(p.visibleGame(), ["game-memory"]);
  });
  await t.test("highlights the open puzzle's step", async () => {
    const p = await gamesPage();
    const active = [...p.document.querySelectorAll("#steps button.active")].map((b) => b.dataset.game);
    assert.deepEqual(active, ["sudoku"]);
  });
  await t.test("switches puzzle from the steps", async () => {
    const p = await gamesPage();
    p.document.querySelector('#steps button[data-game="memory"]').click();
    assert.deepEqual(p.visibleGame(), ["game-memory"]);
    p.document.querySelector('#steps button[data-game="math"]').click();
    assert.deepEqual(p.visibleGame(), ["game-math"]);
  });
  await t.test("says Shorts are unlocked when they are", async () => {
    const p = await gamesPage({ state: { remaining: 45, locked: false, solved: {} } });
    assert.deepEqual(p.visibleGame(), ["done"]);
    assert.equal(p.$("headline").textContent, "Shorts are unlocked");
    assert.equal(p.$("done-time").textContent, "0:45");
    assert.equal(p.$("steps").hidden, true);
    assert.equal(p.$("subline").hidden, true);
  });
});

test("back link", async (t) => {
  const cases = [
    ["https://www.youtube.com/shorts/abc", "https://www.youtube.com/shorts/abc"],
    ["https://m.youtube.com/shorts/abc", "https://m.youtube.com/shorts/abc"],
    ["https://youtube.com/shorts/abc?x=1", "https://youtube.com/shorts/abc?x=1"],
    ["https://evil.example/shorts/abc", "https://www.youtube.com/shorts"],
    ["https://youtube.com.evil.example/shorts", "https://www.youtube.com/shorts"],
    ["https://notyoutube.com/shorts", "https://www.youtube.com/shorts"],
    ["javascript:alert(1)", "https://www.youtube.com/shorts"],
    ["not a url", "https://www.youtube.com/shorts"],
    ["", "https://www.youtube.com/shorts"],
    [undefined, "https://www.youtube.com/shorts"],
  ];
  for (const [from, expected] of cases) {
    await t.test(`from ${JSON.stringify(from)}`, async () => {
      const p = await gamesPage({ state: { remaining: 60, locked: false, solved: {} }, from });
      assert.equal(p.$("back-link").href, expected);
    });
  }
});

test("sudoku board", async (t) => {
  await t.test("has 81 cells with the givens read-only", async () => {
    const p = await gamesPage();
    assert.equal(cells(p).length, 81);
    cells(p).forEach((c, i) => {
      assert.equal(c.readOnly, !!PUZZLE[i]);
      assert.equal(c.classList.contains("given"), !!PUZZLE[i]);
      assert.equal(c.value, PUZZLE[i] ? String(PUZZLE[i]) : "");
    });
  });
  await t.test("draws the 3×3 box lines", async () => {
    const p = await gamesPage();
    assert.equal(boxes(p).filter((c) => c.classList.contains("col-3")).length, 18);
    assert.equal(boxes(p).filter((c) => c.classList.contains("row-3")).length, 18);
  });
  await t.test("labels cells by row and column", async () => {
    const p = await gamesPage();
    assert.equal(cells(p)[0].getAttribute("aria-label"), "Row 1, column 1");
    assert.equal(cells(p)[80].getAttribute("aria-label"), "Row 9, column 9");
    assert.equal(cells(p)[10].getAttribute("aria-label"), "Row 2, column 2");
  });
  await t.test("restores saved progress", async () => {
    const entries = PUZZLE.slice();
    entries[2] = 4;
    const p = await gamesPage({ puzzles: { sudoku: { difficulty: "medium", puzzle: PUZZLE, solution: SOLUTION, entries } } });
    assert.equal(cells(p)[2].value, "4");
  });
  await t.test("makes a new puzzle when none is saved and saves it", async () => {
    const p = await gamesPage({ puzzles: null, settings: { sudokuDifficulty: "easy" } });
    const saved = p.bg.data.puzzles.sudoku;
    assert.equal(saved.difficulty, "easy");
    assert.equal(saved.puzzle.filter(Boolean).length >= 40, true);
    assert.deepEqual(saved.entries, saved.puzzle);
    assert.equal(cells(p).filter((c) => c.readOnly).length, saved.puzzle.filter(Boolean).length);
  });
  await t.test("makes a new puzzle when the difficulty changed", async () => {
    const p = await gamesPage({ settings: { sudokuDifficulty: "hard" }, puzzles: { sudoku: { difficulty: "easy", puzzle: PUZZLE, solution: SOLUTION, entries: PUZZLE.slice() } } });
    assert.equal(p.bg.data.puzzles.sudoku.difficulty, "hard");
    assert.notDeepEqual(p.bg.data.puzzles.sudoku.puzzle, PUZZLE);
  });
  await t.test("falls back to medium for an unknown difficulty", async () => {
    const p = await gamesPage({ puzzles: null, settings: { sudokuDifficulty: "brutal" } });
    const clues = p.bg.data.puzzles.sudoku.puzzle.filter(Boolean).length;
    assert.ok(clues >= 32 && clues < 40, `${clues} clues`);
  });
});

test("sudoku input", async (t) => {
  const empty = EMPTY_CELLS[0]; // index 2
  await t.test("a digit key fills an empty cell", async () => {
    const p = await gamesPage();
    const e = key(p, cells(p)[empty], "4");
    assert.equal(cells(p)[empty].value, "4");
    assert.equal(e.defaultPrevented, true);
  });
  await t.test("saves entries as they are made", async () => {
    const p = await gamesPage();
    key(p, cells(p)[empty], "4");
    await flush();
    assert.equal(p.bg.data.puzzles.sudoku.entries[empty], 4);
  });
  await t.test("givens can't be changed", async () => {
    const p = await gamesPage();
    key(p, cells(p)[0], "9");
    assert.equal(cells(p)[0].value, "5");
  });
  for (const k of ["Backspace", "Delete", "0", " "]) {
    await t.test(`${JSON.stringify(k)} clears a cell`, async () => {
      const p = await gamesPage();
      key(p, cells(p)[empty], "4");
      key(p, cells(p)[empty], k);
      assert.equal(cells(p)[empty].value, "");
    });
  }
  await t.test("letters are blocked", async () => {
    const p = await gamesPage();
    const e = key(p, cells(p)[empty], "x");
    assert.equal(e.defaultPrevented, true);
    assert.equal(cells(p)[empty].value, "");
  });
  await t.test("Tab is left alone", async () => {
    const p = await gamesPage();
    assert.equal(key(p, cells(p)[empty], "Tab").defaultPrevented, false);
  });
  const moves = [["ArrowRight", 40, 41], ["ArrowLeft", 40, 39], ["ArrowDown", 40, 49], ["ArrowUp", 40, 31], ["ArrowUp", 4, 4], ["ArrowDown", 76, 76]];
  for (const [k, from, to] of moves) {
    await t.test(`${k} from cell ${from} goes to ${to}`, async () => {
      const p = await gamesPage();
      cells(p)[from].focus();
      const e = key(p, cells(p)[from], k);
      assert.equal(p.document.activeElement, cells(p)[to]);
      assert.equal(e.defaultPrevented, true);
    });
  }
  await t.test("typing on a soft keyboard keeps the last digit", async () => {
    const p = await gamesPage();
    const c = cells(p)[empty];
    c.value = "4a7";
    c.dispatchEvent(new p.window.Event("input", { bubbles: true }));
    assert.equal(c.value, "7");
  });
  await t.test("typing a non-digit on a soft keyboard clears the cell", async () => {
    const p = await gamesPage();
    const c = cells(p)[empty];
    c.value = "z";
    c.dispatchEvent(new p.window.Event("input", { bubbles: true }));
    assert.equal(c.value, "");
  });
  await t.test("zero isn't a sudoku digit", async () => {
    const p = await gamesPage();
    const c = cells(p)[empty];
    c.value = "0";
    c.dispatchEvent(new p.window.Event("input", { bubbles: true }));
    assert.equal(c.value, "");
  });
});

test("sudoku feedback", async (t) => {
  await t.test("marks a clash with a given", async () => {
    const p = await gamesPage();
    key(p, cells(p)[2], "5"); // the row already has a 5 at 0
    assert.ok(cells(p)[2].classList.contains("conflict"));
    assert.ok(cells(p)[0].classList.contains("conflict"));
  });
  await t.test("clears the clash when the entry changes", async () => {
    const p = await gamesPage();
    key(p, cells(p)[2], "5");
    key(p, cells(p)[2], "4");
    assert.equal(cells(p).some((c) => c.classList.contains("conflict")), false);
  });
  await t.test("Check marks wrong entries and counts them", async () => {
    const p = await gamesPage();
    key(p, cells(p)[2], "1"); // should be 4
    key(p, cells(p)[3], "2"); // should be 6
    key(p, cells(p)[5], "8"); // right
    p.$("sudoku-check").click();
    assert.equal(p.$("sudoku-msg").textContent, "2 wrong entries marked.");
    assert.deepEqual(cells(p).flatMap((c, i) => (c.classList.contains("wrong") ? [i] : [])), [2, 3]);
  });
  await t.test("Check says one wrong entry in the singular", async () => {
    const p = await gamesPage();
    key(p, cells(p)[2], "1");
    p.$("sudoku-check").click();
    assert.equal(p.$("sudoku-msg").textContent, "1 wrong entry marked.");
  });
  await t.test("Check is happy with right entries", async () => {
    const p = await gamesPage();
    key(p, cells(p)[2], "4");
    p.$("sudoku-check").click();
    assert.equal(p.$("sudoku-msg").textContent, "Everything so far is right.");
    assert.ok(p.$("sudoku-msg").classList.contains("good"));
  });
  await t.test("changing a wrong entry clears its mark", async () => {
    const p = await gamesPage();
    key(p, cells(p)[2], "1");
    p.$("sudoku-check").click();
    key(p, cells(p)[2], "4");
    assert.equal(cells(p)[2].classList.contains("wrong"), false);
  });
  await t.test("highlights the same digit on focus", async () => {
    const p = await gamesPage();
    cells(p)[0].focus();
    const same = cells(p).flatMap((c, i) => (c.classList.contains("same") ? [i] : []));
    assert.deepEqual(same, PUZZLE.flatMap((v, i) => (v === 5 ? [i] : [])));
  });
  await t.test("highlights the digit just entered", async () => {
    const p = await gamesPage();
    key(p, cells(p)[2], "8");
    assert.ok(cells(p)[2].classList.contains("same"));
    assert.ok(cells(p).filter((c) => c.classList.contains("same")).length > 1);
  });
  await t.test("highlights nothing for an empty cell", async () => {
    const p = await gamesPage();
    cells(p)[2].focus();
    assert.equal(cells(p).some((c) => c.classList.contains("same")), false);
  });
  await t.test("a full but wrong grid says so", async () => {
    const p = await gamesPage();
    await typeDigits(p, EMPTY_CELLS, (i) => (i === EMPTY_CELLS[0] ? (SOLUTION[i] % 9) + 1 : SOLUTION[i]));
    assert.equal(p.$("sudoku-msg").textContent, "Not quite — something doesn't fit yet.");
    await p.clock.advance(1000);
    assert.equal(p.bg.data.state.solved.sudoku, undefined);
  });
  await t.test("solving it marks the sudoku solved", async () => {
    const p = await gamesPage();
    await typeDigits(p, EMPTY_CELLS, (i) => SOLUTION[i]);
    assert.equal(p.$("sudoku-msg").textContent, "Solved!");
    await p.clock.advance(700);
    assert.equal(p.bg.data.state.solved.sudoku, true);
    assert.deepEqual(p.visibleGame(), ["game-math"]);
  });
});

test("math sprint", async (t) => {
  async function mathPage(opts) {
    const p = await gamesPage({ state: locked({ solved: { sudoku: true } }), ...opts });
    const answer = () => p.evaluate("math.answer");
    const submit = async (value) => {
      p.$("math-answer").value = String(value);
      p.$("math-form").dispatchEvent(new p.window.Event("submit", { bubbles: true, cancelable: true }));
      await flush();
    };
    return { ...p, answer, submit, score: () => p.evaluate("math.score") };
  }

  await t.test("asks for the configured number of problems", async () => {
    const p = await mathPage({ settings: { mathProblems: 7 } });
    assert.equal(p.$("math-goal").textContent, "7");
  });
  await t.test("shows a problem", async () => {
    const p = await mathPage();
    assert.match(p.$("math-question").textContent, /^\d+ [+−×] \d+ =$/);
  });
  await t.test("the shown problem matches the expected answer", async () => {
    const p = await mathPage();
    for (let i = 0; i < 20; i++) {
      const [a, op, b] = p.$("math-question").textContent.replace(" =", "").split(" ");
      const expected = { "+": +a + +b, "−": a - b, "×": a * b }[op];
      assert.equal(p.answer(), expected);
      await p.submit(p.answer());
      if (p.score() >= 10) break;
    }
  });
  await t.test("a right answer scores", async () => {
    const p = await mathPage();
    await p.submit(p.answer());
    assert.equal(p.score(), 1);
    assert.equal(p.$("math-msg").textContent, "Correct — 1 / 10");
    assert.equal(p.$("math-bar").style.width, "10%");
  });
  await t.test("a wrong answer costs one", async () => {
    const p = await mathPage();
    await p.submit(p.answer());
    await p.submit(p.answer());
    const right = p.answer();
    await p.submit(right + 1);
    assert.equal(p.score(), 1);
    assert.equal(p.$("math-msg").textContent, `It was ${right} — 1 / 10`);
    assert.ok(p.$("math-answer").classList.contains("shake"));
  });
  await t.test("the score never goes below zero", async () => {
    const p = await mathPage();
    await p.submit(p.answer() + 1);
    await p.submit(p.answer() + 1);
    assert.equal(p.score(), 0);
  });
  for (const junk of ["", "  ", "abc", "1.5", "4e2", "--3"]) {
    await t.test(`ignores ${JSON.stringify(junk)}`, async () => {
      const p = await mathPage();
      const before = p.$("math-question").textContent;
      await p.submit(junk);
      assert.equal(p.score(), 0);
      assert.equal(p.$("math-msg").textContent, "");
      assert.equal(p.$("math-question").textContent, before);
    });
  }
  await t.test("accepts surrounding spaces", async () => {
    const p = await mathPage();
    await p.submit(`  ${p.answer()} `);
    assert.equal(p.score(), 1);
  });
  await t.test("moves to a new problem after each answer", async () => {
    const p = await mathPage();
    await p.submit(p.answer());
    assert.equal(p.$("math-answer").value, "");
  });
  await t.test("finishing the sprint marks math solved", async () => {
    const p = await mathPage({ settings: { mathProblems: 3 } });
    for (let i = 0; i < 3; i++) await p.submit(p.answer());
    assert.equal(p.$("math-msg").textContent, "Sprint complete!");
    assert.equal(p.$("math-question").textContent, "✓");
    await p.clock.advance(700);
    assert.equal(p.bg.data.state.solved.math, true);
    assert.deepEqual(p.visibleGame(), ["game-memory"]);
  });
  await t.test("answers after the sprint are ignored", async () => {
    const p = await mathPage({ settings: { mathProblems: 3 } });
    for (let i = 0; i < 3; i++) await p.submit(p.answer());
    await p.submit(1);
    assert.equal(p.score(), 3);
  });
  await t.test("problems stay in their ranges", async () => {
    const p = await mathPage({ random: seededRandom(1234) });
    for (let i = 0; i < 300; i++) {
      p.evaluate("nextProblem()");
      const [a, op, b] = p.$("math-question").textContent.replace(" =", "").split(" ").map((x) => (/\d/.test(x) ? Number(x) : x));
      if (op === "+") {
        assert.ok(a >= 12 && a <= 99 && b >= 12 && b <= 99);
      } else if (op === "−") {
        assert.ok(a >= 30 && a <= 120 && b >= 11 && a - b >= 5, `${a} − ${b}`);
      } else {
        assert.equal(op, "×");
        assert.ok(a >= 3 && a <= 12 && b >= 4 && b <= 15);
      }
    }
  });
  await t.test("uses all three kinds of problem", async () => {
    const p = await mathPage({ random: seededRandom(99) });
    const ops = new Set();
    for (let i = 0; i < 60; i++) {
      p.evaluate("nextProblem()");
      ops.add(p.$("math-question").textContent.split(" ")[1]);
    }
    assert.deepEqual([...ops].sort(), ["+", "×", "−"].sort());
  });
});

test("memory pairs", async (t) => {
  async function memoryPage(opts) {
    const p = await gamesPage({ state: locked({ solved: { sudoku: true, math: true } }), ...opts });
    const cards = () => [...p.$("memory-grid").children];
    const bySymbol = () => {
      const map = new Map();
      cards().forEach((c) => map.set(c.dataset.symbol, [...(map.get(c.dataset.symbol) || []), c]));
      return map;
    };
    const mismatch = () => {
      const [[, [a]], [, [b]]] = [...bySymbol()];
      return [a, b];
    };
    return { ...p, cards, bySymbol, mismatch };
  }

  await t.test("deals eight pairs face down", async () => {
    const p = await memoryPage();
    assert.equal(p.cards().length, 16);
    assert.equal(p.bySymbol().size, 8);
    for (const [, pair] of p.bySymbol()) assert.equal(pair.length, 2);
    assert.ok(p.cards().every((c) => c.classList.contains("hidden-face")));
  });
  await t.test("shuffles the deal", async () => {
    const a = await memoryPage({ random: seededRandom(1) });
    const b = await memoryPage({ random: seededRandom(2) });
    assert.notDeepEqual(a.cards().map((c) => c.dataset.symbol), b.cards().map((c) => c.dataset.symbol));
  });
  await t.test("labels cards without giving them away", async () => {
    const p = await memoryPage();
    p.cards().forEach((c, i) => assert.equal(c.getAttribute("aria-label"), `Card ${i + 1}`));
  });
  await t.test("a click turns a card over", async () => {
    const p = await memoryPage();
    const [card] = p.cards();
    card.click();
    assert.equal(card.classList.contains("hidden-face"), false);
    assert.equal(card.getAttribute("aria-label"), card.dataset.symbol);
  });
  await t.test("a matching pair stays open", async () => {
    const p = await memoryPage();
    const [[, [a, b]]] = [...p.bySymbol()];
    a.click();
    b.click();
    await p.clock.advance(2000);
    assert.ok(a.classList.contains("matched") && b.classList.contains("matched"));
    assert.equal(a.classList.contains("hidden-face"), false);
  });
  await t.test("a wrong pair turns back over", async () => {
    const p = await memoryPage();
    const [a, b] = p.mismatch();
    a.click();
    b.click();
    assert.equal(a.classList.contains("hidden-face"), false);
    await p.clock.advance(800);
    assert.ok(a.classList.contains("hidden-face") && b.classList.contains("hidden-face"));
    assert.equal(a.getAttribute("aria-label"), "Hidden card");
  });
  await t.test("clicks wait while a wrong pair is showing", async () => {
    const p = await memoryPage();
    const [a, b] = p.mismatch();
    a.click();
    b.click();
    const third = p.cards().find((c) => c !== a && c !== b);
    third.click();
    assert.ok(third.classList.contains("hidden-face"));
    await p.clock.advance(800);
    third.click();
    assert.equal(third.classList.contains("hidden-face"), false);
  });
  await t.test("clicking an open card again does nothing", async () => {
    const p = await memoryPage();
    const [card] = p.cards();
    card.click();
    card.click();
    assert.equal(p.evaluate("memory.open.length"), 1);
  });
  await t.test("matched cards can't be picked again", async () => {
    const p = await memoryPage();
    const [[, [a, b]]] = [...p.bySymbol()];
    a.click();
    b.click();
    a.click();
    assert.equal(p.evaluate("memory.open.length"), 0);
  });
  await t.test("finding every pair marks memory solved and unlocks", async () => {
    const p = await memoryPage();
    for (const [, [a, b]] of p.bySymbol()) {
      a.click();
      b.click();
    }
    assert.equal(p.$("memory-msg").textContent, "All pairs found!");
    await p.clock.advance(700);
    assert.equal(p.bg.data.state.locked, false);
    assert.equal(p.$("headline").textContent, "Shorts are unlocked");
    assert.deepEqual(p.visibleGame(), ["done"]);
  });
  await t.test("seven pairs is not enough", async () => {
    const p = await memoryPage();
    [...p.bySymbol()].slice(0, 7).forEach(([, [a, b]]) => {
      a.click();
      b.click();
    });
    await p.clock.advance(1000);
    assert.equal(p.$("memory-msg").textContent, "");
    assert.equal(p.bg.data.state.locked, true);
  });
});

test("all three puzzles in a row unlock Shorts", async () => {
  const p = await gamesPage();
  await typeDigits(p, EMPTY_CELLS, (i) => SOLUTION[i]);
  await p.clock.advance(700);
  for (let i = 0; i < 10; i++) {
    p.$("math-answer").value = String(p.evaluate("math.answer"));
    p.$("math-form").dispatchEvent(new p.window.Event("submit", { bubbles: true, cancelable: true }));
    await flush();
  }
  await p.clock.advance(700);
  const pairs = new Map();
  [...p.$("memory-grid").children].forEach((c) => pairs.set(c.dataset.symbol, [...(pairs.get(c.dataset.symbol) || []), c]));
  for (const [, [a, b]] of pairs) {
    a.click();
    b.click();
  }
  await p.clock.advance(700);
  const s = await p.bg.send({ type: "status" });
  assert.equal(s.locked, false);
  assert.equal(s.remaining, 60);
  assert.equal(p.$("done-time").textContent, "1:00");
});

test("sudoku number pad and notes", async (t) => {
  const padButton = (p, d) => p.document.querySelector(`#sudoku-pad button[data-digit="${d}"]`);
  const eraser = (p) => p.document.querySelector('#sudoku-pad button[data-tool="erase"]');
  const notesOf = (p, i) => [...boxes(p)[i].querySelector(".notes").children].map((s) => s.textContent).join("");
  const sameCells = (p) => cells(p).flatMap((c, i) => (c.classList.contains("same") ? [i] : []));
  const where = (grid, d) => grid.flatMap((v, i) => (v === d ? [i] : []));
  const [a, b] = EMPTY_CELLS; // 2 and 3: same row, so they are peers
  const far = EMPTY_CELLS.find((i) => Math.floor(i / 9) > 2 && i % 9 > 3); // shares no row, column or box with a

  await t.test("has 1 to 9 and an eraser, none picked", async () => {
    const p = await gamesPage();
    const labels = [...p.document.querySelectorAll("#sudoku-pad button")].map((x) => x.textContent);
    assert.deepEqual(labels, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫"]);
    assert.ok([...p.document.querySelectorAll("#sudoku-pad button")].every((x) => x.getAttribute("aria-pressed") === "false"));
  });
  await t.test("squares don't open the on-screen keyboard", async () => {
    const p = await gamesPage();
    assert.ok(cells(p).every((c) => c.inputMode === "none"));
  });
  await t.test("picking a number highlights it across the board", async () => {
    const p = await gamesPage();
    padButton(p, 5).click();
    assert.equal(padButton(p, 5).getAttribute("aria-pressed"), "true");
    assert.deepEqual(sameCells(p), where(PUZZLE, 5));
  });
  await t.test("picking it again lets go of it", async () => {
    const p = await gamesPage();
    padButton(p, 5).click();
    padButton(p, 5).click();
    assert.equal(padButton(p, 5).getAttribute("aria-pressed"), "false");
    assert.deepEqual(sameCells(p), []);
  });
  await t.test("picking another number moves the pick", async () => {
    const p = await gamesPage();
    padButton(p, 5).click();
    padButton(p, 8).click();
    assert.equal(padButton(p, 5).getAttribute("aria-pressed"), "false");
    assert.equal(padButton(p, 8).getAttribute("aria-pressed"), "true");
    assert.deepEqual(sameCells(p), where(PUZZLE, 8));
  });
  await t.test("Escape lets go of the picked number", async () => {
    const p = await gamesPage();
    padButton(p, 5).click();
    key(p, cells(p)[a], "Escape");
    assert.equal(padButton(p, 5).getAttribute("aria-pressed"), "false");
  });
  await t.test("tapping a square places the picked number", async () => {
    const p = await gamesPage();
    padButton(p, 4).click();
    cells(p)[a].click();
    await flush();
    assert.equal(cells(p)[a].value, "4");
    assert.equal(p.bg.data.puzzles.sudoku.entries[a], 4);
  });
  await t.test("the placed number joins the highlight", async () => {
    const p = await gamesPage();
    padButton(p, 4).click();
    cells(p)[a].click();
    assert.deepEqual(sameCells(p), [...where(PUZZLE, 4), a].sort((x, y) => x - y));
  });
  await t.test("tapping it again takes it out", async () => {
    const p = await gamesPage();
    padButton(p, 4).click();
    cells(p)[a].click();
    cells(p)[a].click();
    assert.equal(cells(p)[a].value, "");
  });
  await t.test("tapping a square with another number replaces it", async () => {
    const p = await gamesPage();
    padButton(p, 4).click();
    cells(p)[a].click();
    padButton(p, 1).click();
    cells(p)[a].click();
    assert.equal(cells(p)[a].value, "1");
  });
  await t.test("tapping a given changes nothing", async () => {
    const p = await gamesPage();
    padButton(p, 4).click();
    cells(p)[0].click();
    assert.equal(cells(p)[0].value, "5");
  });
  await t.test("tapping with nothing picked places nothing", async () => {
    const p = await gamesPage();
    cells(p)[a].click();
    assert.equal(cells(p)[a].value, "");
  });
  await t.test("the eraser clears a number", async () => {
    const p = await gamesPage();
    key(p, cells(p)[a], "4");
    eraser(p).click();
    cells(p)[a].click();
    assert.equal(cells(p)[a].value, "");
    assert.equal(eraser(p).getAttribute("aria-pressed"), "true");
  });
  await t.test("the eraser clears notes", async () => {
    const p = await gamesPage();
    p.$("sudoku-fill-notes").click();
    eraser(p).click();
    cells(p)[a].click();
    assert.equal(notesOf(p, a), "");
  });
  await t.test("the eraser leaves givens alone", async () => {
    const p = await gamesPage();
    eraser(p).click();
    cells(p)[0].click();
    assert.equal(cells(p)[0].value, "5");
  });
  await t.test("a number is dimmed once all nine are on the board", async () => {
    const p = await gamesPage();
    assert.equal(padButton(p, 9).classList.contains("complete"), false);
    await typeDigits(p, EMPTY_CELLS.filter((i) => SOLUTION[i] === 9), () => 9);
    assert.equal(padButton(p, 9).classList.contains("complete"), true);
    assert.equal(padButton(p, 8).classList.contains("complete"), false);
  });
  await t.test("the whole puzzle can be solved from the pad", async () => {
    const p = await gamesPage();
    for (let d = 1; d <= 9; d++) {
      padButton(p, d).click();
      EMPTY_CELLS.filter((i) => SOLUTION[i] === d).forEach((i) => cells(p)[i].click());
    }
    await flush();
    assert.equal(p.$("sudoku-msg").textContent, "Solved!");
    await p.clock.advance(700);
    assert.equal(p.bg.data.state.solved.sudoku, true);
  });

  await t.test("Notes is off to start with", async () => {
    const p = await gamesPage();
    assert.equal(p.$("sudoku-notes").getAttribute("aria-pressed"), "false");
    assert.ok(EMPTY_CELLS.every((i) => notesOf(p, i) === ""));
  });
  await t.test("the Notes button toggles notes mode", async () => {
    const p = await gamesPage();
    p.$("sudoku-notes").click();
    assert.equal(p.$("sudoku-notes").getAttribute("aria-pressed"), "true");
    p.$("sudoku-notes").click();
    assert.equal(p.$("sudoku-notes").getAttribute("aria-pressed"), "false");
  });
  await t.test("N toggles notes mode from the board", async () => {
    const p = await gamesPage();
    const e = key(p, cells(p)[a], "n");
    assert.equal(p.$("sudoku-notes").getAttribute("aria-pressed"), "true");
    assert.equal(e.defaultPrevented, true);
    key(p, cells(p)[a], "N");
    assert.equal(p.$("sudoku-notes").getAttribute("aria-pressed"), "false");
  });
  await t.test("in notes mode a tap adds a small number", async () => {
    const p = await gamesPage();
    p.$("sudoku-notes").click();
    padButton(p, 3).click();
    cells(p)[a].click();
    padButton(p, 7).click();
    cells(p)[a].click();
    assert.equal(notesOf(p, a), "37");
    assert.equal(cells(p)[a].value, "");
  });
  await t.test("tapping a note again removes it", async () => {
    const p = await gamesPage();
    p.$("sudoku-notes").click();
    padButton(p, 3).click();
    cells(p)[a].click();
    cells(p)[a].click();
    assert.equal(notesOf(p, a), "");
  });
  await t.test("in notes mode typed digits become notes", async () => {
    const p = await gamesPage();
    p.$("sudoku-notes").click();
    key(p, cells(p)[a], "2");
    key(p, cells(p)[a], "6");
    key(p, cells(p)[a], "2");
    assert.equal(notesOf(p, a), "6");
    assert.equal(cells(p)[a].value, "");
  });
  await t.test("in notes mode a soft-keyboard digit becomes a note", async () => {
    const p = await gamesPage();
    p.$("sudoku-notes").click();
    const c = cells(p)[a];
    c.value = "8";
    c.dispatchEvent(new p.window.Event("input", { bubbles: true }));
    assert.equal(notesOf(p, a), "8");
    assert.equal(c.value, "");
  });
  await t.test("notes can't go on a given", async () => {
    const p = await gamesPage();
    p.$("sudoku-notes").click();
    key(p, cells(p)[0], "2");
    assert.equal(notesOf(p, 0), "");
  });
  await t.test("notes can't go on a filled square", async () => {
    const p = await gamesPage();
    key(p, cells(p)[a], "4");
    p.$("sudoku-notes").click();
    key(p, cells(p)[a], "2");
    assert.equal(notesOf(p, a), "");
    assert.equal(cells(p)[a].value, "4");
  });
  await t.test("placing a number clears that square's notes", async () => {
    const p = await gamesPage();
    p.$("sudoku-notes").click();
    key(p, cells(p)[a], "2");
    key(p, cells(p)[a], "4");
    p.$("sudoku-notes").click();
    key(p, cells(p)[a], "4");
    assert.equal(notesOf(p, a), "");
    key(p, cells(p)[a], "Backspace");
    assert.equal(notesOf(p, a), "", "the notes don't come back");
  });
  await t.test("placing a number removes it from notes it can see", async () => {
    const p = await gamesPage();
    p.$("sudoku-fill-notes").click();
    key(p, cells(p)[a], "4");
    assert.equal(notesOf(p, b), "12356789");
    assert.equal(notesOf(p, far), "123456789");
  });
  await t.test("Backspace clears notes", async () => {
    const p = await gamesPage();
    p.$("sudoku-fill-notes").click();
    key(p, cells(p)[a], "Backspace");
    assert.equal(notesOf(p, a), "");
  });
  await t.test("Fill all notes puts 1 to 9 in every empty square", async () => {
    const p = await gamesPage();
    key(p, cells(p)[a], "4");
    p.$("sudoku-fill-notes").click();
    EMPTY_CELLS.filter((i) => i !== a).forEach((i) => assert.equal(notesOf(p, i), "123456789", `cell ${i}`));
    assert.equal(notesOf(p, a), "");
    assert.equal(notesOf(p, 0), "");
    assert.equal(cells(p)[a].value, "4");
  });
  await t.test("Fill all notes leaves no hidden notes under a placed number", async () => {
    const p = await gamesPage();
    padButton(p, 4).click();
    cells(p)[a].click();
    p.$("sudoku-fill-notes").click();
    cells(p)[a].click(); // tap 4 again to take it out
    assert.equal(cells(p)[a].value, "");
    assert.equal(notesOf(p, a), "");
  });
  await t.test("the picked number is highlighted inside notes", async () => {
    const p = await gamesPage();
    p.$("sudoku-fill-notes").click();
    padButton(p, 6).click();
    const spans = [...boxes(p)[a].querySelector(".notes").children];
    assert.deepEqual(spans.flatMap((s, k) => (s.classList.contains("same") ? [k + 1] : [])), [6]);
  });
  await t.test("hovering doesn't change the highlight while a number is picked", async () => {
    const p = await gamesPage();
    padButton(p, 5).click();
    cells(p)[1].dispatchEvent(new p.window.MouseEvent("mouseover", { bubbles: true }));
    assert.deepEqual(sameCells(p), where(PUZZLE, 5));
  });
  await t.test("hovering highlights as before with nothing picked", async () => {
    const p = await gamesPage();
    cells(p)[1].dispatchEvent(new p.window.MouseEvent("mouseover", { bubbles: true }));
    assert.deepEqual(sameCells(p), where(PUZZLE, 3));
  });
  await t.test("notes are saved and come back", async () => {
    const p = await gamesPage();
    p.$("sudoku-notes").click();
    key(p, cells(p)[a], "2");
    key(p, cells(p)[a], "9");
    await flush();
    const saved = p.bg.data.puzzles.sudoku;
    assert.equal(saved.notes[a], (1 << 2) | (1 << 9));
    const again = await gamesPage({ puzzles: { sudoku: saved } });
    assert.equal(notesOf(again, a), "29");
  });
  await t.test("progress saved before notes existed still loads", async () => {
    const entries = PUZZLE.slice();
    entries[a] = 4;
    const p = await gamesPage({ puzzles: { sudoku: { difficulty: "medium", puzzle: PUZZLE, solution: SOLUTION, entries } } });
    assert.equal(cells(p)[a].value, "4");
    p.$("sudoku-fill-notes").click();
    assert.equal(notesOf(p, b), "123456789");
  });
});
