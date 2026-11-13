const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCommon } = require("./helpers");

const { SETTINGS_DEFAULTS, SUDOKU_CLUES, GAMES, formatTime } = loadCommon();

test("formatTime", async (t) => {
  const cases = [
    [0, "0:00"],
    [1, "0:01"],
    [9, "0:09"],
    [59, "0:59"],
    [60, "1:00"],
    [61, "1:01"],
    [600, "10:00"],
    [3599, "59:59"],
    [3600, "60:00"],
    [0.2, "0:01"],
    [59.01, "1:00"],
    [-5, "0:00"],
  ];
  for (const [seconds, expected] of cases) {
    await t.test(`${seconds}s → ${expected}`, () => assert.equal(formatTime(seconds), expected));
  }
});

test("defaults are within the ranges the options page allows", () => {
  assert.ok(SETTINGS_DEFAULTS.limitMinutes >= 1 && SETTINGS_DEFAULTS.limitMinutes <= 240);
  assert.ok(SETTINGS_DEFAULTS.mathProblems >= 3 && SETTINGS_DEFAULTS.mathProblems <= 30);
  assert.ok(SETTINGS_DEFAULTS.sudokuDifficulty in SUDOKU_CLUES);
});

test("harder sudokus give fewer clues", () => {
  assert.ok(SUDOKU_CLUES.easy > SUDOKU_CLUES.medium);
  assert.ok(SUDOKU_CLUES.medium > SUDOKU_CLUES.hard);
  // 17 is the fewest clues a sudoku with a unique solution can have.
  assert.ok(SUDOKU_CLUES.hard >= 17);
});

test("the three puzzles, in order", () => {
  assert.deepEqual([...GAMES], ["sudoku", "math", "memory"]);
});
