const test = require("node:test");
const assert = require("node:assert/strict");
const Sudoku = require("../lib/sudoku.js");
const { loadCommon } = require("./helpers");

const { SUDOKU_CLUES } = loadCommon();

const parse = (s) => [...s.replace(/\s/g, "")].map((c) => (c === "." ? 0 : Number(c)));

// A well-known puzzle with a unique solution, and that solution.
const PUZZLE = parse(`
  53..7....
  6..195...
  .98....6.
  8...6...3
  4..8.3..1
  7...2...6
  .6....28.
  ...419..5
  ....8..79`);
const SOLUTION = parse(`
  534678912
  672195348
  198342567
  859761423
  426853791
  713924856
  961537284
  287419635
  345286179`);

function isValidSolution(grid) {
  const groups = [];
  for (let k = 0; k < 9; k++) {
    groups.push([...Array(9).keys()].map((j) => k * 9 + j));
    groups.push([...Array(9).keys()].map((j) => j * 9 + k));
    const r0 = Math.floor(k / 3) * 3, c0 = (k % 3) * 3;
    groups.push([...Array(9).keys()].map((j) => (r0 + Math.floor(j / 3)) * 9 + c0 + (j % 3)));
  }
  return grid.length === 81 && groups.every((g) => new Set(g.map((i) => grid[i])).size === 9 && g.every((i) => grid[i] >= 1 && grid[i] <= 9));
}

test("box", async (t) => {
  await t.test("maps each corner and centre cell to its 3×3 box", () => {
    assert.equal(Sudoku.box(0), 0);
    assert.equal(Sudoku.box(8), 2);
    assert.equal(Sudoku.box(40), 4);
    assert.equal(Sudoku.box(72), 6);
    assert.equal(Sudoku.box(80), 8);
  });
  await t.test("puts exactly nine cells in every box", () => {
    const counts = new Array(9).fill(0);
    for (let i = 0; i < 81; i++) counts[Sudoku.box(i)]++;
    assert.deepEqual(counts, new Array(9).fill(9));
  });
  await t.test("keeps the cells of a box within three rows and three columns", () => {
    for (let b = 0; b < 9; b++) {
      const cells = [...Array(81).keys()].filter((i) => Sudoku.box(i) === b);
      assert.equal(new Set(cells.map((i) => Math.floor(i / 9))).size, 3);
      assert.equal(new Set(cells.map((i) => i % 9)).size, 3);
    }
  });
});

test("the reference solution is valid", () => {
  assert.ok(isValidSolution(SOLUTION));
});

test("countSolutions", async (t) => {
  await t.test("finds the one solution of a proper puzzle", () => {
    assert.equal(Sudoku.countSolutions(PUZZLE), 1);
  });
  await t.test("stops at the limit on an empty grid", () => {
    assert.equal(Sudoku.countSolutions(new Array(81).fill(0)), 2);
    assert.equal(Sudoku.countSolutions(new Array(81).fill(0), 5), 5);
  });
  await t.test("counts a finished grid as one solution", () => {
    assert.equal(Sudoku.countSolutions(SOLUTION), 1);
  });
  await t.test("finds none when the givens already clash", () => {
    const clash = PUZZLE.slice();
    clash[2] = 5; // a second 5 in the first row
    assert.equal(Sudoku.countSolutions(clash), 0);
  });
  await t.test("finds none when a cell has no candidate left", () => {
    const stuck = new Array(81).fill(0);
    [1, 2, 3, 4, 5, 6, 7, 8].forEach((d, k) => (stuck[k + 1] = d)); // row 0: _12345678
    stuck[9] = 9; // a 9 below the gap, in the same box and column
    assert.equal(Sudoku.countSolutions(stuck), 0);
  });
  await t.test("finds more than one when a clue is missing that pins it down", () => {
    const loose = SOLUTION.slice();
    // Swapping 1/2 in a rectangle that spans two boxes keeps every unit valid,
    // so with those four cells empty there are two solutions.
    const corners = findDeadlyRectangle(SOLUTION);
    corners.forEach((i) => (loose[i] = 0));
    assert.equal(Sudoku.countSolutions(loose), 2);
  });
  await t.test("does not modify the grid it is given", () => {
    const copy = PUZZLE.slice();
    Sudoku.countSolutions(copy);
    assert.deepEqual(copy, PUZZLE);
  });
});

// Four cells at the corners of a rectangle (two rows in one band, two columns in
// different stacks) holding a,b / b,a: emptying them leaves two solutions.
function findDeadlyRectangle(g) {
  for (let r1 = 0; r1 < 9; r1++) {
    for (let r2 = r1 + 1; r2 < 9; r2++) {
      if (Math.floor(r1 / 3) !== Math.floor(r2 / 3)) continue;
      for (let c1 = 0; c1 < 9; c1++) {
        for (let c2 = c1 + 1; c2 < 9; c2++) {
          if (Math.floor(c1 / 3) === Math.floor(c2 / 3)) continue;
          const a = g[r1 * 9 + c1], b = g[r1 * 9 + c2];
          if (g[r2 * 9 + c1] === b && g[r2 * 9 + c2] === a) return [r1 * 9 + c1, r1 * 9 + c2, r2 * 9 + c1, r2 * 9 + c2];
        }
      }
    }
  }
  throw new Error("no rectangle in the reference grid");
}

test("conflicts", async (t) => {
  const empty = () => new Array(81).fill(0);
  await t.test("none on an empty grid", () => assert.equal(Sudoku.conflicts(empty()).size, 0));
  await t.test("none on a valid solution", () => assert.equal(Sudoku.conflicts(SOLUTION).size, 0));
  await t.test("none on the unsolved puzzle", () => assert.equal(Sudoku.conflicts(PUZZLE).size, 0));
  await t.test("marks both cells of a repeat in a row", () => {
    const g = empty();
    g[0] = 4;
    g[8] = 4;
    assert.deepEqual([...Sudoku.conflicts(g)].sort((a, b) => a - b), [0, 8]);
  });
  await t.test("marks both cells of a repeat in a column", () => {
    const g = empty();
    g[4] = 7;
    g[76] = 7;
    assert.deepEqual([...Sudoku.conflicts(g)].sort((a, b) => a - b), [4, 76]);
  });
  await t.test("marks both cells of a repeat in a box only", () => {
    const g = empty();
    g[0] = 2;
    g[20] = 2; // row 2, column 2: same box, different row and column
    assert.deepEqual([...Sudoku.conflicts(g)].sort((a, b) => a - b), [0, 20]);
  });
  await t.test("ignores the same digit in unrelated cells", () => {
    const g = empty();
    g[0] = 3;
    g[40] = 3;
    assert.equal(Sudoku.conflicts(g).size, 0);
  });
  await t.test("marks all three cells of a triple", () => {
    const g = empty();
    g[0] = g[1] = g[2] = 9;
    assert.deepEqual([...Sudoku.conflicts(g)].sort((a, b) => a - b), [0, 1, 2]);
  });
  await t.test("marks a wrong entry against a given", () => {
    const g = PUZZLE.slice();
    g[2] = 3; // the first row's given 3 is at index 1
    assert.ok(Sudoku.conflicts(g).has(2));
    assert.ok(Sudoku.conflicts(g).has(1));
  });
});

test("generate", async (t) => {
  for (const [difficulty, clues] of Object.entries(SUDOKU_CLUES)) {
    await t.test(`${difficulty}: a unique puzzle consistent with a valid solution`, () => {
      const { puzzle, solution } = Sudoku.generate(clues);
      assert.equal(puzzle.length, 81);
      assert.ok(isValidSolution(solution));
      const given = puzzle.filter(Boolean).length;
      assert.ok(given >= clues, `${given} clues, wanted at least ${clues}`);
      assert.ok(given <= clues + 6, `${given} clues is far above the ${clues} asked for`);
      puzzle.forEach((v, i) => v && assert.equal(v, solution[i]));
      assert.equal(Sudoku.countSolutions(puzzle), 1);
    });
  }
  await t.test("gives a different puzzle each time", () => {
    const a = Sudoku.generate(SUDOKU_CLUES.easy);
    const b = Sudoku.generate(SUDOKU_CLUES.easy);
    assert.notDeepEqual(a.solution, b.solution);
  });
  await t.test("returns a full grid when asked for 81 clues", () => {
    const { puzzle, solution } = Sudoku.generate(81);
    assert.deepEqual(puzzle, solution);
  });
});
