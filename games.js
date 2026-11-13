const $ = (id) => document.getElementById(id);
let status = null;

async function send(msg) {
  status = await browser.runtime.sendMessage(msg);
  return status;
}

async function markSolved(game) {
  await send({ type: "solved", game });
  render();
}

function backUrl() {
  const from = new URLSearchParams(location.search).get("from");
  try {
    const url = new URL(from);
    if (/(^|\.)youtube\.com$/.test(url.hostname)) return url.href;
  } catch {}
  return "https://www.youtube.com/shorts";
}

function show(id) {
  document.querySelectorAll(".game").forEach((s) => (s.hidden = s.id !== id));
  document.querySelectorAll("#steps button").forEach((b) => {
    b.classList.toggle("active", `game-${b.dataset.game}` === id);
  });
  const game = id.replace("game-", "");
  if (starters[game]) starters[game]();
}

function render() {
  const steps = $("steps");
  if (!status.locked) {
    steps.hidden = true;
    $("headline").textContent = "Shorts are unlocked";
    $("subline").hidden = true;
    $("done-time").textContent = formatTime(status.remaining);
    show("done");
    return;
  }
  steps.querySelectorAll("button").forEach((b) => {
    const solved = !!status.solved[b.dataset.game];
    b.classList.toggle("solved", solved);
    b.querySelector(".check").textContent = solved ? "✓" : "○";
  });
  const next = GAMES.find((g) => !status.solved[g]);
  show(`game-${next}`);
}

$("steps").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (btn) show(`game-${btn.dataset.game}`);
});

/* ---------- Sudoku ---------- */

const ALL_NOTES = 0x3fe; // bits 1..9
let sudoku = null;
let cellEls = [];
// The digit picked on the pad (1-9), "erase", or null.
let tool = null;
let notesMode = false;
// Board snapshots before each change, newest last, for undo.
let history = [];

async function loadSudoku() {
  const { puzzles = {} } = await browser.storage.local.get("puzzles");
  const difficulty = status.settings.sudokuDifficulty;
  if (puzzles.sudoku && puzzles.sudoku.difficulty === difficulty) {
    return { notes: new Array(81).fill(0), ...puzzles.sudoku };
  }
  const { puzzle, solution } = Sudoku.generate(SUDOKU_CLUES[difficulty] || SUDOKU_CLUES.medium);
  const fresh = { difficulty, puzzle, solution, entries: puzzle.slice(), notes: new Array(81).fill(0) };
  await browser.storage.local.set({ puzzles: { ...puzzles, sudoku: fresh } });
  return fresh;
}

function savePuzzle(name, value) {
  return browser.storage.local.get("puzzles").then(({ puzzles = {} }) =>
    browser.storage.local.set({ puzzles: { ...puzzles, [name]: value } })
  );
}

const saveSudoku = () => savePuzzle("sudoku", sudoku);

async function startSudoku() {
  if (sudoku) return;
  $("sudoku-msg").textContent = "Generating…";
  sudoku = await loadSudoku();
  history = [];
  drawUndo();
  $("sudoku-msg").textContent = "";
  const grid = $("sudoku-grid");
  grid.replaceChildren();
  cellEls = sudoku.puzzle.map((given, i) => {
    const box = document.createElement("div");
    box.className = "cell";
    if (i % 9 === 2 || i % 9 === 5) box.classList.add("col-3");
    if (Math.floor(i / 9) === 2 || Math.floor(i / 9) === 5) box.classList.add("row-3");
    const cell = document.createElement("input");
    cell.dataset.i = i;
    cell.maxLength = 1;
    // The number pad replaces the on-screen keyboard; a real keyboard still works.
    cell.inputMode = "none";
    cell.setAttribute("aria-label", `Row ${Math.floor(i / 9) + 1}, column ${(i % 9) + 1}`);
    if (given) {
      cell.value = given;
      cell.readOnly = true;
      cell.classList.add("given");
    } else if (sudoku.entries[i]) {
      cell.value = sudoku.entries[i];
    }
    const notes = document.createElement("div");
    notes.className = "notes";
    notes.setAttribute("aria-hidden", "true");
    for (let d = 1; d <= 9; d++) notes.appendChild(document.createElement("span"));
    box.append(cell, notes);
    grid.appendChild(box);
    return cell;
  });
  cellEls.forEach((_, i) => drawNotes(i));
  refreshSudoku();
  highlightSame(highlightedDigit());
}

const editable = (i) => !sudoku.puzzle[i];

const peers = (i) =>
  [...Array(81).keys()].filter(
    (j) => j !== i && (Math.floor(j / 9) === Math.floor(i / 9) || j % 9 === i % 9 || Sudoku.box(j) === Sudoku.box(i))
  );

function setCell(i, value) {
  if (!editable(i)) return;
  sudoku.entries[i] = value;
  const cell = cellEls[i];
  cell.value = value || "";
  cell.classList.remove("wrong");
  if (value) {
    // A placed number can't also be a candidate anywhere it can see,
    // unless it clashes there, in which case it is about to be fixed.
    sudoku.notes[i] = 0;
    const seen = peers(i);
    const clashes = seen.some((j) => sudoku.entries[j] === value);
    for (const j of clashes ? [] : seen) {
      if (sudoku.notes[j] & (1 << value)) {
        sudoku.notes[j] &= ~(1 << value);
        drawNotes(j);
      }
    }
  }
  drawNotes(i);
  saveSudoku();
  refreshSudoku();
  highlightSame(tool > 0 ? tool : value);
}

function toggleNote(i, d) {
  if (!editable(i) || sudoku.entries[i]) return;
  sudoku.notes[i] ^= 1 << d;
  drawNotes(i);
  saveSudoku();
}

function clearCell(i) {
  if (!editable(i)) return;
  sudoku.notes[i] = 0;
  setCell(i, 0);
}

function drawNotes(i) {
  const shown = sudoku.entries[i] ? 0 : sudoku.notes[i];
  [...cellEls[i].nextSibling.children].forEach((span, k) => {
    span.textContent = shown & (1 << (k + 1)) ? k + 1 : "";
  });
}

const snapshot = () => ({ entries: sudoku.entries.slice(), notes: sudoku.notes.slice() });
const sameBoard = (a, b) => a.entries.every((v, i) => v === b.entries[i]) && a.notes.every((v, i) => v === b.notes[i]);

function drawUndo() {
  $("sudoku-undo").disabled = !history.length;
}

// Runs one player action, remembering the board before it if it changed anything.
function act(change) {
  const before = snapshot();
  change();
  if (!sameBoard(before, sudoku)) {
    history.push(before);
    drawUndo();
  }
}

function undo() {
  const before = history.pop();
  if (!before) return;
  sudoku.entries = before.entries;
  sudoku.notes = before.notes;
  cellEls.forEach((cell, i) => {
    cell.value = sudoku.entries[i] || "";
    cell.classList.remove("wrong");
    drawNotes(i);
  });
  drawUndo();
  saveSudoku();
  refreshSudoku();
  highlightSame(highlightedDigit());
}

// With a number or the eraser picked, tapping a square or pressing Enter on it uses it.
function useTool(i) {
  if (tool === "erase") clearCell(i);
  else if (tool) enterDigit(i, tool, true);
}

// Typing or tapping a number: a note in notes mode, otherwise the cell's value.
function enterDigit(i, d, toggle) {
  if (notesMode) toggleNote(i, d);
  else setCell(i, toggle && sudoku.entries[i] === d ? 0 : d);
}

function highlightedDigit() {
  if (tool > 0) return tool;
  const cell = document.activeElement;
  return cellEls.includes(cell) ? Number(cell.value) || 0 : 0;
}

function highlightSame(value) {
  const d = Number(value) || 0;
  cellEls.forEach((cell, i) => {
    cell.classList.toggle("same", !!d && cell.value === String(d));
    [...cell.nextSibling.children].forEach((span, k) => span.classList.toggle("same", k + 1 === d));
  });
}

function setTool(next) {
  tool = tool === next ? null : next;
  document.querySelectorAll("#sudoku-pad button").forEach((b) => {
    const value = b.dataset.digit ? Number(b.dataset.digit) : b.dataset.tool;
    b.setAttribute("aria-pressed", String(value === tool));
  });
  highlightSame(highlightedDigit());
}

function setNotesMode(on) {
  notesMode = on;
  $("sudoku-notes").setAttribute("aria-pressed", String(on));
}

$("sudoku-pad").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn || !sudoku) return;
  setTool(btn.dataset.digit ? Number(btn.dataset.digit) : btn.dataset.tool);
});

// The pad and the buttons below the board leave the selected square selected.
for (const id of ["sudoku-pad", "sudoku-actions"]) {
  $(id).addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) e.preventDefault();
  });
}

$("sudoku-notes").addEventListener("click", () => setNotesMode(!notesMode));

$("sudoku-undo").addEventListener("click", () => {
  if (sudoku) undo();
});

$("sudoku-fill-notes").addEventListener("click", () => {
  if (!sudoku) return;
  act(() =>
    sudoku.puzzle.forEach((given, i) => {
      if (!given && !sudoku.entries[i]) sudoku.notes[i] = ALL_NOTES;
      drawNotes(i);
    })
  );
  saveSudoku();
  highlightSame(highlightedDigit());
});

$("sudoku-grid").addEventListener("click", (e) => {
  if (e.target.tagName !== "INPUT" || !tool) return;
  act(() => useTool(Number(e.target.dataset.i)));
});

$("sudoku-grid").addEventListener("mouseover", (e) => {
  if (e.target.tagName === "INPUT" && !tool) highlightSame(e.target.value);
});
$("sudoku-grid").addEventListener("mouseleave", () => highlightSame(highlightedDigit()));
$("sudoku-grid").addEventListener("focusin", (e) => {
  if (!tool) highlightSame(e.target.value);
});

$("sudoku-check").addEventListener("click", () => {
  if (!sudoku) return;
  let wrong = 0;
  cellEls.forEach((cell, i) => {
    const bad = !sudoku.puzzle[i] && sudoku.entries[i] && sudoku.entries[i] !== sudoku.solution[i];
    cell.classList.toggle("wrong", !!bad);
    if (bad) wrong++;
  });
  const msg = $("sudoku-msg");
  msg.textContent = wrong ? `${wrong} wrong ${wrong === 1 ? "entry" : "entries"} marked.` : "Everything so far is right.";
  msg.className = wrong ? "msg bad" : "msg good";
});

function refreshSudoku() {
  const bad = Sudoku.conflicts(sudoku.entries);
  cellEls.forEach((cell, i) => cell.classList.toggle("conflict", bad.has(i)));
  // Dim numbers that are all on the board already.
  const counts = new Array(10).fill(0);
  sudoku.entries.forEach((v) => counts[v]++);
  document.querySelectorAll("#sudoku-pad button[data-digit]").forEach((b) => {
    b.classList.toggle("complete", counts[Number(b.dataset.digit)] >= 9);
  });
  const full = sudoku.entries.every(Boolean);
  const msg = $("sudoku-msg");
  if (full && sudoku.entries.every((v, i) => v === sudoku.solution[i])) {
    msg.textContent = "Solved!";
    msg.className = "msg good";
    if (status.locked && !status.solved.sudoku) setTimeout(() => markSolved("sudoku"), 700);
  } else if (full) {
    msg.textContent = "Not quite — something doesn't fit yet.";
    msg.className = "msg bad";
  } else {
    msg.textContent = "";
    msg.className = "msg";
  }
}

$("sudoku-grid").addEventListener("keydown", (e) => {
  const cell = e.target;
  if (cell.tagName !== "INPUT") return;
  const i = Number(cell.dataset.i);
  const moves = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 };
  if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
    undo();
    e.preventDefault();
  } else if (e.key in moves) {
    const j = i + moves[e.key];
    if (j >= 0 && j < 81) cellEls[j].focus();
    e.preventDefault();
  } else if (/^[1-9]$/.test(e.key)) {
    act(() => enterDigit(i, Number(e.key), false));
    e.preventDefault();
  } else if (e.key === "Enter") {
    act(() => useTool(i));
    e.preventDefault();
  } else if (["Backspace", "Delete", "0", " "].includes(e.key)) {
    act(() => clearCell(i));
    e.preventDefault();
  } else if (e.key === "n" || e.key === "N") {
    setNotesMode(!notesMode);
    e.preventDefault();
  } else if (e.key === "Escape") {
    if (tool) setTool(tool);
    e.preventDefault();
  } else if (e.key.length === 1) {
    e.preventDefault();
  }
});

// Soft keyboards don't always send key events; normalise whatever was typed.
$("sudoku-grid").addEventListener("input", (e) => {
  const i = Number(e.target.dataset.i);
  const digit = e.target.value.replace(/[^1-9]/g, "").slice(-1);
  act(() => {
    if (notesMode && digit) {
      e.target.value = sudoku.entries[i] || "";
      toggleNote(i, Number(digit));
    } else {
      setCell(i, digit ? Number(digit) : 0);
    }
  });
});

/* ---------- Math sprint ---------- */

const math = { goal: 10, score: 0, answer: null, started: false };

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function nextProblem() {
  const kind = rand(0, 2);
  let a, b, text;
  if (kind === 0) {
    a = rand(12, 99);
    b = rand(12, 99);
    text = `${a} + ${b}`;
    math.answer = a + b;
  } else if (kind === 1) {
    a = rand(30, 120);
    b = rand(11, a - 5);
    text = `${a} − ${b}`;
    math.answer = a - b;
  } else {
    a = rand(3, 12);
    b = rand(4, 15);
    text = `${a} × ${b}`;
    math.answer = a * b;
  }
  $("math-question").textContent = `${text} =`;
  $("math-answer").value = "";
  $("math-answer").focus();
}

function drawMath() {
  $("math-goal").textContent = math.goal;
  $("math-bar").style.width = `${(math.score / math.goal) * 100}%`;
}

function startMath() {
  if (!math.started) {
    math.started = true;
    math.goal = status.settings.mathProblems;
    drawMath();
    nextProblem();
  }
  $("math-answer").focus();
}

$("math-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (math.score >= math.goal) return;
  const input = $("math-answer");
  const raw = input.value.trim();
  if (!/^-?\d+$/.test(raw)) return;
  const msg = $("math-msg");
  if (Number(raw) === math.answer) {
    math.score++;
    msg.textContent = `Correct — ${math.score} / ${math.goal}`;
    msg.className = "msg good";
  } else {
    math.score = Math.max(0, math.score - 1);
    msg.textContent = `It was ${math.answer} — ${math.score} / ${math.goal}`;
    msg.className = "msg bad";
    input.classList.remove("shake");
    void input.offsetWidth;
    input.classList.add("shake");
  }
  drawMath();
  if (math.score >= math.goal) {
    msg.textContent = "Sprint complete!";
    $("math-question").textContent = "✓";
    if (status.locked && !status.solved.math) setTimeout(() => markSolved("math"), 700);
  } else {
    nextProblem();
  }
});

/* ---------- Memory pairs ---------- */

const SYMBOLS = ["🍎", "🚀", "🎲", "🌵", "🐙", "⚡", "🎧", "🧩", "🍩", "🦊", "🌙", "🔑"];
// The deal lives here, not on the cards, so a face-down card holds nothing to select or read.
const memory = { started: false, deck: [], found: [], open: [], busy: false };
const PAIRS = 8;

function deal() {
  const picks = SYMBOLS.slice().sort(() => Math.random() - 0.5).slice(0, PAIRS);
  const deck = [...picks, ...picks];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function turn(card, up) {
  const symbol = memory.deck[card.dataset.i];
  card.textContent = up ? symbol : "";
  card.classList.toggle("hidden-face", !up);
  card.setAttribute("aria-label", up ? symbol : "Hidden card");
}

function allFound() {
  const msg = $("memory-msg");
  msg.textContent = "All pairs found!";
  msg.className = "msg good";
}

// The deal is kept with the other puzzles, so coming back shows the same board,
// finished if it was finished, until the next lock starts fresh ones.
async function startMemory() {
  if (memory.started) return;
  memory.started = true;
  const { puzzles = {} } = await browser.storage.local.get("puzzles");
  const saved = puzzles.memory;
  memory.deck = saved ? saved.deck : deal();
  memory.found = saved ? saved.found : [];
  if (status.solved.memory) memory.found = memory.deck.map((_, i) => i);
  if (!saved) savePuzzle("memory", { deck: memory.deck, found: memory.found });
  const grid = $("memory-grid");
  grid.replaceChildren(
    ...memory.deck.map((_, i) => {
      const card = document.createElement("button");
      card.dataset.i = i;
      card.setAttribute("aria-label", `Card ${i + 1}`);
      card.classList.add("hidden-face");
      if (memory.found.includes(i)) {
        turn(card, true);
        card.classList.add("matched");
      }
      return card;
    })
  );
  if (memory.found.length === memory.deck.length) allFound();
}

$("memory-grid").addEventListener("click", (e) => {
  const card = e.target.closest("button");
  if (!card || memory.busy || !card.classList.contains("hidden-face")) return;
  turn(card, true);
  memory.open.push(card);
  if (memory.open.length < 2) return;

  const [a, b] = memory.open;
  memory.open = [];
  if (a.textContent === b.textContent) {
    a.classList.add("matched");
    b.classList.add("matched");
    memory.found.push(Number(a.dataset.i), Number(b.dataset.i));
    savePuzzle("memory", { deck: memory.deck, found: memory.found });
    if (memory.found.length === memory.deck.length) {
      allFound();
      if (status.locked && !status.solved.memory) setTimeout(() => markSolved("memory"), 700);
    }
  } else {
    memory.busy = true;
    setTimeout(() => {
      turn(a, false);
      turn(b, false);
      memory.busy = false;
    }, 800);
  }
});

/* ---------- Boot ---------- */

const starters = { sudoku: startSudoku, math: startMath, memory: startMemory };

$("back-link").href = backUrl();
send({ type: "status" }).then(render);
