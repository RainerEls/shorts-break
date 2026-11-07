(() => {
  let pill = null;

  const onShorts = () => location.pathname.startsWith("/shorts");

  const playingVideo = () =>
    [...document.querySelectorAll("video")].find(
      (v) => !v.paused && !v.ended && v.readyState > 2
    );

  // Whole seconds of each Short already watched, so loops and rewinds don't count again.
  // Kept for the most recent Shorts only; Map order doubles as least-recently-used order.
  const HISTORY = 3;
  const watched = new Map();
  let last = null;

  function isFirstViewing(id, t) {
    const seen = watched.get(id) || new Set();
    watched.delete(id);
    watched.set(id, seen);
    if (watched.size > HISTORY) watched.delete(watched.keys().next().value);
    const sec = Math.floor(t);
    const fresh = !seen.has(sec);
    // Mark every second since the previous sample, so timer jitter leaves no gaps a replay could hit.
    const continuous = last && last.id === id && t > last.t && t - last.t < 3;
    for (let s = continuous ? Math.floor(last.t) : sec; s <= sec; s++) seen.add(s);
    last = { id, t };
    return fresh;
  }

  function showPill(text, warn) {
    if (!pill) {
      pill = document.createElement("div");
      pill.id = "shorts-break-pill";
      document.documentElement.appendChild(pill);
    }
    pill.textContent = text;
    pill.classList.toggle("shorts-break-warn", warn);
    pill.hidden = false;
  }

  function hidePill() {
    if (pill) pill.hidden = true;
  }

  async function tick() {
    if (!onShorts()) return hidePill();
    const video = document.visibilityState === "visible" && playingVideo();
    const id = location.pathname.split("/")[2] || "";
    const counting = !!video && isFirstViewing(id, video.currentTime);
    let status;
    try {
      status = await browser.runtime.sendMessage({ type: "tick", playing: counting });
    } catch {
      return;
    }
    if (status.locked) {
      document.querySelectorAll("video").forEach((v) => v.pause());
      return;
    }
    const note = counting ? "" : video ? " · rewatch, not counting" : " · paused";
    const label = `⏱ ${formatTime(status.remaining)}${note}`;
    showPill(label, status.remaining <= 60);
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  setInterval(tick, 1000);
  tick();
})();
