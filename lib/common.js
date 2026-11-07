const SETTINGS_DEFAULTS = {
  limitMinutes: 10,
  sudokuDifficulty: "medium",
  mathProblems: 10,
};

const SUDOKU_CLUES = { easy: 40, medium: 32, hard: 27 };

const GAMES = ["sudoku", "math", "memory"];

function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
