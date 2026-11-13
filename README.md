# Shorts Break

A Firefox extension for people who open YouTube Shorts "for a minute" and look up an hour later.

You get a time budget for Shorts (10 minutes by default). It only goes down while a Short is actually playing in front of you, and each Short only counts once, so loops and rewatches are free. When the budget runs out, the Short you're watching plays to the end, and then Shorts are locked. To unlock them you solve a sudoku, a quick round of mental math and a memory game, and then your time resets.

It won't stop someone who really wants to get around it. You can always disable it. It's there to make you stop and think before scrolling more.

## How it behaves

- A small timer sits in the corner of the Shorts page. It turns red for the last minute and tells you when it isn't counting.
- Paused videos, background tabs and minimised windows don't use time.
- Looping a Short, rewinding, or scrolling back to one of the last three you watched doesn't use time either.
- Once locked, any `youtube.com/shorts` page sends you to the puzzle page. The rest of YouTube still works.
- Puzzles you've finished stay finished if you close the tab, and so does your sudoku progress.

<img src="docs/screenshots/shorts-page.png" width="650" alt="A Shorts page, video blurred, with an arrow pointing to the timer in the top-right corner showing 28:49, paused">

## The puzzles

**Sudoku.** A fresh puzzle each time, with exactly one solution. Clashing numbers turn red as you type. Hover over or select a cell to highlight every cell with the same number. **Check** marks wrong entries red but leaves them in place, so you can see where you went wrong.

<img src="docs/screenshots/sudoku.png" width="380" alt="Sudoku with every 5 highlighted and two wrong entries marked red">

**Math sprint.** Addition, subtraction and multiplication. Get 10 right; each wrong answer costs you one.

<img src="docs/screenshots/math.png" width="420" alt="Math sprint, four of ten answered">

**Memory pairs.** Sixteen cards, eight pairs.

<img src="docs/screenshots/memory.png" width="380" alt="Memory pairs game, partly solved">

## Settings

Click the toolbar icon to see how much time you have left.

<img src="docs/screenshots/popup.png" width="292" alt="Toolbar popup showing 6:22 left">

**Settings** in that popup, or the add-on's **Preferences** tab in `about:addons`, lets you change:

- the time budget (1–240 minutes)
- sudoku difficulty (easy, medium or hard)
- how many math problems you need to get right

<img src="docs/screenshots/settings.png" width="500" alt="Shorts Break preferences in the Firefox add-ons manager">

Changing the budget moves the time you have left by the same amount, but it won't unlock Shorts once they're locked.

## Installing

To try it out, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and pick `manifest.json` from this folder. Firefox forgets temporary add-ons when it restarts.

For a permanent install, download `shorts-break-<version>.zip` from the latest release. Regular Firefox only installs add-ons signed by Mozilla, so that zip has to go through addons.mozilla.org first.

## License

GPL-3.0. See [LICENSE](LICENSE).
