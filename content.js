(() => {
  let pill = null;

  const onShorts = () => location.pathname.startsWith("/shorts");

  const isPlaying = () =>
    [...document.querySelectorAll("video")].some(
      (v) => !v.paused && !v.ended && v.readyState > 2
    );

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
    const playing = document.visibilityState === "visible" && isPlaying();
    let status;
    try {
      status = await browser.runtime.sendMessage({ type: "tick", playing });
    } catch {
      return;
    }
    if (status.locked) {
      document.querySelectorAll("video").forEach((v) => v.pause());
      return;
    }
    const label = `⏱ ${formatTime(status.remaining)}${playing ? "" : " · paused"}`;
    showPill(label, status.remaining <= 60);
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  setInterval(tick, 1000);
  tick();
})();
