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

let sudoku = null;

async function loadSudoku() {
  const { puzzles = {} } = await browser.storage.local.get("puzzles");
  const difficulty = status.settings.sudokuDifficulty;
  if (puzzles.sudoku && puzzles.sudoku.difficulty === difficulty) return puzzles.sudoku;
  const { puzzle, solution } = Sudoku.generate(SUDOKU_CLUES[difficulty] || SUDOKU_CLUES.medium);
  const fresh = { difficulty, puzzle, solution, entries: puzzle.slice() };
  await browser.storage.local.set({ puzzles: { ...puzzles, sudoku: fresh } });
  return fresh;
}

function saveSudoku() {
  browser.storage.local.get("puzzles").then(({ puzzles = {} }) =>
    browser.storage.local.set({ puzzles: { ...puzzles, sudoku } })
  );
}

async function startSudoku() {
  if (sudoku) return;
  $("sudoku-msg").textContent = "Generating…";
  sudoku = await loadSudoku();
  $("sudoku-msg").textContent = "";
  const grid = $("sudoku-grid");
  grid.replaceChildren();
  sudoku.puzzle.forEach((given, i) => {
    const cell = document.createElement("input");
    cell.dataset.i = i;
    cell.maxLength = 1;
    cell.inputMode = "numeric";
    cell.setAttribute("aria-label", `Row ${Math.floor(i / 9) + 1}, column ${(i % 9) + 1}`);
    if (i % 9 === 2 || i % 9 === 5) cell.classList.add("col-3");
    if (Math.floor(i / 9) === 2 || Math.floor(i / 9) === 5) cell.classList.add("row-3");
    if (given) {
      cell.value = given;
      cell.readOnly = true;
      cell.classList.add("given");
    } else if (sudoku.entries[i]) {
      cell.value = sudoku.entries[i];
    }
    grid.appendChild(cell);
  });
  refreshSudoku();
}

function setCell(i, value) {
  if (sudoku.puzzle[i]) return;
  sudoku.entries[i] = value;
  const cell = $("sudoku-grid").children[i];
  cell.value = value || "";
  cell.classList.remove("wrong");
  saveSudoku();
  refreshSudoku();
  highlightSame(value);
}

function highlightSame(value) {
  for (const cell of $("sudoku-grid").children) {
    cell.classList.toggle("same", !!value && cell.value === String(value));
  }
}

function focusedValue() {
  const cell = document.activeElement;
  return cell && cell.parentElement === $("sudoku-grid") ? cell.value : "";
}

$("sudoku-grid").addEventListener("mouseover", (e) => {
  if (e.target.tagName === "INPUT") highlightSame(e.target.value);
});
$("sudoku-grid").addEventListener("mouseleave", () => highlightSame(focusedValue()));
$("sudoku-grid").addEventListener("focusin", (e) => highlightSame(e.target.value));

$("sudoku-check").addEventListener("click", () => {
  if (!sudoku) return;
  let wrong = 0;
  [...$("sudoku-grid").children].forEach((cell, i) => {
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
  [...$("sudoku-grid").children].forEach((cell, i) => cell.classList.toggle("conflict", bad.has(i)));
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
  if (e.key in moves) {
    const j = i + moves[e.key];
    if (j >= 0 && j < 81) $("sudoku-grid").children[j].focus();
    e.preventDefault();
  } else if (/^[1-9]$/.test(e.key)) {
    setCell(i, Number(e.key));
    e.preventDefault();
  } else if (["Backspace", "Delete", "0", " "].includes(e.key)) {
    setCell(i, 0);
    e.preventDefault();
  } else if (e.key.length === 1) {
    e.preventDefault();
  }
});

// Soft keyboards don't always send key events; normalise whatever was typed.
$("sudoku-grid").addEventListener("input", (e) => {
  const i = Number(e.target.dataset.i);
  const digit = e.target.value.replace(/[^1-9]/g, "").slice(-1);
  setCell(i, digit ? Number(digit) : 0);
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
const memory = { started: false, open: [], busy: false, matched: 0 };

function startMemory() {
  if (memory.started) return;
  memory.started = true;
  const picks = SYMBOLS.slice().sort(() => Math.random() - 0.5).slice(0, 8);
  const deck = [...picks, ...picks];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const grid = $("memory-grid");
  grid.replaceChildren(
    ...deck.map((symbol, i) => {
      const card = document.createElement("button");
      card.textContent = symbol;
      card.dataset.symbol = symbol;
      card.className = "hidden-face";
      card.setAttribute("aria-label", `Card ${i + 1}`);
      return card;
    })
  );
}

$("memory-grid").addEventListener("click", (e) => {
  const card = e.target.closest("button");
  if (!card || memory.busy || !card.classList.contains("hidden-face")) return;
  card.classList.remove("hidden-face");
  card.setAttribute("aria-label", card.dataset.symbol);
  memory.open.push(card);
  if (memory.open.length < 2) return;

  const [a, b] = memory.open;
  memory.open = [];
  if (a.dataset.symbol === b.dataset.symbol) {
    a.classList.add("matched");
    b.classList.add("matched");
    memory.matched++;
    if (memory.matched === 8) {
      const msg = $("memory-msg");
      msg.textContent = "All pairs found!";
      msg.className = "msg good";
      if (status.locked && !status.solved.memory) setTimeout(() => markSolved("memory"), 700);
    }
  } else {
    memory.busy = true;
    setTimeout(() => {
      for (const c of [a, b]) {
        c.classList.add("hidden-face");
        c.setAttribute("aria-label", "Hidden card");
      }
      memory.busy = false;
    }, 800);
  }
});

/* ---------- Boot ---------- */

const starters = { sudoku: startSudoku, math: startMath, memory: startMemory };

$("back-link").href = backUrl();
send({ type: "status" }).then(render);
