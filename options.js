const fields = ["limitMinutes", "sudokuDifficulty", "mathProblems"];

browser.runtime.sendMessage({ type: "status" }).then(({ settings }) => {
  for (const f of fields) document.getElementById(f).value = settings[f];
});

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const settings = {
    limitMinutes: Number(document.getElementById("limitMinutes").value),
    sudokuDifficulty: document.getElementById("sudokuDifficulty").value,
    mathProblems: Number(document.getElementById("mathProblems").value),
  };
  await browser.runtime.sendMessage({ type: "settings", settings });
  const msg = document.getElementById("msg");
  msg.textContent = "Saved.";
  setTimeout(() => (msg.textContent = ""), 1500);
});
