const Sudoku = (() => {
  const ALL = 0x3fe; // bits 1..9

  const box = (i) => Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor((i % 9) / 3);

  function popcount(n) {
    let c = 0;
    while (n) {
      n &= n - 1;
      c++;
    }
    return c;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Backtracking search with most-constrained-cell ordering.
  // Stops once `limit` solutions are found; `onSolution` sees each one.
  function search(grid, limit, randomise, onSolution) {
    const rows = new Array(9).fill(0);
    const cols = new Array(9).fill(0);
    const boxes = new Array(9).fill(0);
    for (let i = 0; i < 81; i++) {
      if (!grid[i]) continue;
      const bit = 1 << grid[i];
      const r = Math.floor(i / 9), c = i % 9, b = box(i);
      if ((rows[r] | cols[c] | boxes[b]) & bit) return 0;
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[b] |= bit;
    }

    let found = 0;
    const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    (function rec() {
      let best = -1, bestMask = 0, bestCount = 10;
      for (let i = 0; i < 81; i++) {
        if (grid[i]) continue;
        const mask = ALL & ~(rows[Math.floor(i / 9)] | cols[i % 9] | boxes[box(i)]);
        const count = popcount(mask);
        if (count < bestCount) {
          best = i;
          bestMask = mask;
          bestCount = count;
          if (count === 0) return;
        }
      }
      if (best === -1) {
        found++;
        if (onSolution) onSolution(grid);
        return;
      }
      const r = Math.floor(best / 9), c = best % 9, b = box(best);
      const order = randomise ? shuffle(digits.slice()) : digits;
      for (const d of order) {
        const bit = 1 << d;
        if (!(bestMask & bit)) continue;
        grid[best] = d;
        rows[r] |= bit;
        cols[c] |= bit;
        boxes[b] |= bit;
        rec();
        grid[best] = 0;
        rows[r] &= ~bit;
        cols[c] &= ~bit;
        boxes[b] &= ~bit;
        if (found >= limit) return;
      }
    })();

    return found;
  }

  function countSolutions(grid, limit = 2) {
    return search(grid.slice(), limit, false);
  }

  function solvedGrid() {
    let result = null;
    search(new Array(81).fill(0), 1, true, (g) => (result = g.slice()));
    return result;
  }

  // Removes cells in random order while the puzzle keeps exactly one solution.
  function generate(targetClues) {
    const solution = solvedGrid();
    const puzzle = solution.slice();
    let clues = 81;
    for (const i of shuffle([...Array(81).keys()])) {
      if (clues <= targetClues) break;
      const kept = puzzle[i];
      puzzle[i] = 0;
      if (countSolutions(puzzle) === 1) clues--;
      else puzzle[i] = kept;
    }
    return { puzzle, solution };
  }

  // Indexes of cells whose value repeats in their row, column or box.
  function conflicts(grid) {
    const bad = new Set();
    for (let i = 0; i < 81; i++) {
      if (!grid[i]) continue;
      for (let j = i + 1; j < 81; j++) {
        if (grid[i] !== grid[j]) continue;
        const sameRow = Math.floor(i / 9) === Math.floor(j / 9);
        const sameCol = i % 9 === j % 9;
        if (sameRow || sameCol || box(i) === box(j)) {
          bad.add(i);
          bad.add(j);
        }
      }
    }
    return bad;
  }

  return { generate, countSolutions, conflicts, box };
})();

if (typeof module !== "undefined") module.exports = Sudoku;
