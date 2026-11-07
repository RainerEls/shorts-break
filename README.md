# Shorts Break

Firefox extension: a timer counts down while you watch YouTube Shorts. When it runs out, every `youtube.com/shorts` page redirects to a puzzle page until you solve a sudoku, a math sprint and a memory-pairs game. Then the timer refills.

- Counts only while a Short is actually playing in a visible tab (paused, background tab or minimised window doesn't count). Several Shorts tabs at once still count one second per second.
- Each Short counts once: loops, rewinds and going back to one you already watched don't use time. The pill says "rewatch, not counting" meanwhile. It remembers the last 3 Shorts per tab; one further back counts again.
- Sudoku: hovering or selecting a cell highlights every cell with the same number; **Check** marks wrong entries red without removing them.
- A pill in the corner of the Shorts page shows the time left; it turns red in the last minute. The toolbar badge shows minutes left or 🔒.
- Solved puzzles and sudoku progress survive closing the tab.
- Settings (toolbar popup → Settings): time limit, sudoku difficulty, number of math problems. Lowering or raising the limit shifts the time left by the same amount; it can't lift a lock.

## Install

Temporary (until Firefox restarts): `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `manifest.json`.

Permanent: release Firefox only installs signed add-ons. Either sign it as an unlisted add-on on addons.mozilla.org (free, automatic, `web-ext sign --channel unlisted`), or use Firefox Developer Edition/Nightly with `xpinstall.signatures.required` set to `false` in `about:config` and install the zip (`web-ext build`) from `about:addons` → gear → **Install Add-on From File…**.

## Releases

Every push to `main` cuts a release through the shared `auto-release` workflow: conventional commits decide the version (`fix:` → patch, `feat:` → minor, `!` → major). The release gets `shorts-break-<version>.zip` with `manifest.json` at its root, ready to upload to addons.mozilla.org. The version in the repo's `manifest.json` stays `0.0.0`; the workflow stamps the release version into the zip.
