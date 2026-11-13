async function refresh() {
  const s = await browser.runtime.sendMessage({ type: "status" });
  document.body.classList.toggle("locked", s.locked);
  document.getElementById("label").textContent = s.locked
    ? `Locked · ${GAMES.filter((g) => s.solved[g]).length} / ${GAMES.length} puzzles solved`
    : s.finishing
      ? "Locks when this Short ends"
      : "Shorts time left";
  document.getElementById("time").textContent = s.locked ? "🔒" : formatTime(s.remaining);
  document.getElementById("bar").style.width = `${(s.remaining / s.limitSeconds) * 100}%`;
  document.getElementById("puzzles").hidden = !s.locked;
}

document.getElementById("puzzles").addEventListener("click", () => {
  browser.tabs.create({ url: browser.runtime.getURL("games.html") });
  window.close();
});

document.getElementById("settings").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
  window.close();
});

refresh();
setInterval(refresh, 1000);
