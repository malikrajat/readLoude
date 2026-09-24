# Changelog

All notable changes to this extension are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project uses [semantic versioning](https://semver.org/).

## [1.0.0] - 2026-09-22

First public release.

### Added

- Read the selected text aloud, or the main article when nothing is selected.
- Word-by-word highlighting that follows the spoken audio.
- Voice, speed and pitch controls with Slow / Normal / Fast presets.
- Automatic pause when the tab goes to the background and resume when it returns.
- Keyboard shortcut `Alt+Shift+R` to open the popup.
- 16, 32, 48 and 128 px extension icons.
- `npm run check` (package validation) and `npm run build` (store zip).
- Store listing copy, screenshots and promotional images.
- `npm run check:listing` — enforces the Chrome Web Store listing rules,
  including Google's limit of five repetitions per keyword.
- Biome for linting and formatting (`npm run lint`, `npm run format`) with the
  configuration committed in `biome.json`.
- A real test suite under `test/`: unit tests for the shared logic plus
  behaviour tests for the content script and the popup (145 tests, run with
  `npm test`).
- `npm run build` now writes both `dist/unpacked/` (for *Load unpacked*) and the
  store zip, and `npm run create` cleans `dist/` first. `npm run clean` removes
  the build output.
- `lib/core.js` — the pure logic (settings validation, text chunking, URL rules,
  voice choice, error messages) moved out of the two entry points so it can be
  unit tested and shared.
- `.github/workflows/ci.yml` runs lint, manifest, listing, tests (on Node 20, 22
  and 24) and the build as separate jobs, and uploads both artifacts.
  `.github/workflows/release.yml` publishes a GitHub Release from a `v*` tag.
- `docs/chrome-web-store-compliance.md` — every applicable policy page mapped to
  the file that satisfies it, with the date it was checked.
- `CONTRIBUTING.md`, `SECURITY.md`, `docs/README.md`, `.editorconfig` and a
  GitHub Actions workflow that runs the checks, the tests and the build.

### Changed

- **The highlight no longer jumps when the same text appears several times on
  a page.** It used to search the whole document for the surrounding sentence,
  so a repeated paragraph could match an earlier copy, drag the highlight there,
  and bounce the viewport up and down. The spoken offsets are now mapped exactly
  onto the text nodes of the selection, which also fixes a word that is split
  across inline markup such as `<strong>`.
- **The page scrolls far less.** A word that is already visible never moves the
  page, scrolling down anchors the word at 35% of the viewport so the following
  lines need no movement, and the view only scrolls back if the word is
  completely off-screen. Scrolling respects `prefers-reduced-motion`.
- **The popup is readable.** Larger text (14px base), 44px buttons,
  high-contrast colours (every pair is now at least 4.5:1 and checked by
  `npm run check`), and a proper dark theme that follows Chrome's
  `prefers-color-scheme`.
- Manifest modernised for current Manifest V3: `minimum_chrome_version` 111, an
  explicit `content_security_policy`, and a content script declared with
  `"world": "ISOLATED"` and `"match_about_blank": false` so reviewers can see it
  never touches page JavaScript.
- The privacy policy now discloses the page text, the stored settings and the
  hidden marker with purpose, destination and retention. Chrome requires local
  processing to be disclosed, and the store's data usage form must tick
  *Website content* rather than nothing.
- The store listing is written for search without keyword spam: each target
  phrase appears once or twice in context, and the limit is enforced by a script.

### Fixed

- Settings were written to `chrome.storage.sync` on every slider movement, which
  exceeded the sync write quota and silently lost the user's choice. Writes are
  now debounced and flushed when the popup closes.
- The selected voice was stored by its list index, so the wrong voice was used
  whenever the list changed. Voices are now stored by name.
- Stopping or restarting a reading could leave the 10 second keep-alive timer
  running and produced stray "reading complete" messages from the previous
  utterance. Both are now tied to the current reading session.
- Speech queued in the same tick as `speechSynthesis.cancel()` could be dropped
  by Chrome; playback now starts after a short settle delay.
- Very long articles could stop early because Chrome fails on oversized
  utterances. Text above 30,000 characters is now split at sentence boundaries.
- The popup crashed on tabs without a readable URL (for example a new tab) and
  swallowed the error. Restrictions are now detected up front with a clear
  message.
- Manually pausing and then switching tabs resumed playback against the user's
  wish. Only a pause caused by the tab becoming inactive is auto-resumed.
- Leftover highlight markers from an earlier injection could stay in the page;
  cleanup now removes every trace.
- Rate and pitch arriving from the popup are clamped, so out-of-range values can
  no longer throw inside `SpeechSynthesisUtterance`.
- Removed dead code and the very verbose per-page logging (available again with
  the `DEBUG` flag in `content.js`).
