# Code review — edge cases, corner cases and error handling

Review of the 1.0.0 code base before the first Chrome Web Store submission.
Severity: **P1** breaks the feature, **P2** breaks it in less common situations,
**P3** polish.

## Fixed

| # | Sev | Problem | Fix |
| --- | --- | --- | --- |
| 1 | P1 | Settings were written to `chrome.storage.sync` on **every** `input` event of the speed and pitch sliders. `storage.sync` allows roughly 120 writes per minute, so dragging a slider produced failed writes (`chrome.runtime.lastError` was never read) and the user's choice was silently lost. | Writes are debounced by 400 ms, flushed on `pagehide`/`visibilitychange`, and wrapped in `try/catch`. |
| 2 | P1 | The popup did `chrome.tabs.query(...)` and immediately used `tabs[0].id` and `tab.url.startsWith(...)`. With no tabs or a tab without a URL (new tab, some special pages) this threw inside an async callback, so the popup stopped responding with no error shown. | Every tab lookup is now awaited, guarded and wrapped in `try/catch`; unsupported pages are detected up front with a readable message. |
| 3 | P1 | Stopping a reading and starting a new one left the old utterance's `onend`/`onerror` handlers alive. The old handler emitted `readingComplete` (the popup displayed "Stopped" while reading) and could start a stale speech chunk. | Each reading gets a session token; every callback returns early when its session is no longer current. |
| 4 | P1 | Even after the fixes above, `speechSynthesis.cancel()` immediately followed by `speak()` in the same task is dropped by Chrome (a long-standing bug), so a restart could produce silence. | Playback starts after a short settle delay. |
| 5 | P2 | The 10 second "keep the speech alive" interval was only cleared in `onend`/`onerror`. After a stop or a restart it could keep nudging the engine forever. | All timers are cleared through one helper, and the keep-alive interval also self-cancels when its session is stale. |
| 6 | P2 | Chrome silently truncates or refuses very long utterances, so a long article stopped early or failed. | Text over 30,000 characters is split at sentence (then word) boundaries with the original offsets preserved, so highlighting still lines up. Normal reads still use a single utterance, exactly as before. |
| 7 | P2 | The selected voice was stored as the **index** in the voice list. The list order changes between sessions and machines, so the wrong voice (or no voice) was used. | The voice is stored by name, with automatic migration from the old index value and a sensible local-voice fallback. |
| 8 | P2 | `settings.rate` / `settings.pitch` were used unchecked. `SpeechSynthesisUtterance` throws a `TypeError` for out-of-range values, so a `NaN` (empty slider, older stored value) could kill the whole read. | Values are parsed, defaulted and clamped to 0.5–2 in the content script, and the message handler always answers. |
| 9 | P2 | Manually pausing and then switching away and back resumed playback even though the user had asked for a pause. | The pause is now tagged as "caused by the tab becoming inactive"; only that pause is auto-resumed. |
| 10 | P2 | The page-visible cleanup only handled the highlight and marker it knew about in memory. A leftover marker from an earlier injection stayed in the DOM for the life of the page. | Cleanup deletes every `#read-aloud-selection-marker` and `.read-aloud-highlight` element, whatever created it, and normalises the touched text nodes. |
| 11 | P2 | Errors inside the content script used `alert()`, which blocks the page and is easy to miss while the popup is open. Failures also still answered `{success: true}`, so the popup showed "Reading…" when nothing was playing. | The content script returns an error code (`no-text`, `unsupported`, `unexpected`), the popup turns it into a specific message, and runtime problems show as a non-blocking on-page toast. |
| 12 | P2 | `extractMainContent()` ran without a guard for documents without a `body` (XML, early injection) and could throw out of the message handler. | It is wrapped in `try/catch`, returns `null` for unusable documents, and the caller falls back to the popup message. |
| 13 | P3 | `document.body.innerText` and `document.body.insertBefore(...)` were used without checking that `document.body` exists. | Body access is guarded everywhere, and DOM failures only disable the (optional) marker and highlighting. |
| 14 | P3 | The message listener replied for unknown actions and did not validate the message shape, which can keep a message port open. | Non-object messages are ignored, unknown actions return `false`, and every handled action responds exactly once. |
| 15 | P3 | Dozens of emoji `console.log` calls ran on every page, which is noisy for users and reviewers. | Logging is behind a single `DEBUG` flag; warnings and errors are still reported. |
| 16 | P3 | The popup's default pitch in `popup.html` was `1.1` while the script used `1.0`, and `voice-warning`/`hint` elements were created with inline styles in JavaScript. | The markup and the defaults agree, and the notice elements live in `popup.html` with proper classes, `role` and `aria-live`. |
| 17 | P3 | Dead code: `getTextNodesInRange()`, `textNodes`, `searchStartNode`, `currentText` and unused CSS rules (`#read-aloud-current-word`, `#read-aloud-selection-container`, two keyframes). | Removed. |
| 18 | P3 | `background.js` was a `console.log` and nothing else, so the extension had no install/update hook. | It now seeds the documented defaults on install/update (guarded by `try/catch`) and logs the installed version. |
| 19 | P3 | The manifest was missing `short_name`, `default_title`, `minimum_chrome_version` and any keyboard shortcut; the 32 px toolbar icon was missing. | All added, plus a regenerated icon set with rounded corners. |
| 20 | **P1** | **The highlight jumped to the wrong copy of repeated text.** The highlighter searched the whole document for a 70-character context, so a sentence repeated at the top, middle and bottom of a page could match an earlier copy. The subsequent scroll then dragged the reader up, and the next word dragged them back down: the viewport bounced for as long as the repeated text was being read. | The spoken text is now mapped **exactly** onto the text nodes of the selection (`buildRangeMap` + `core.findTextPosition`), so an offset has one destination and nothing is guessed. The map is verified against the text that is spoken; if a page mutates mid-reading it is rebuilt once, and only then does the old forward-only search act as a fallback. |
| 21 | **P1** | **The page scrolled far too eagerly**, re-centring the viewport on almost every word (`rect.top < 150 || rect.bottom > height - 150`), including upwards. | Scroll decisions moved into `core.planScroll`: a visible word never scrolls; scrolling down anchors the word at 35% of the viewport so the next lines need no further movement; scrolling up happens only when the word is completely above the viewport (the user scrolled away); targets closer than 16 px are ignored so an in-flight smooth scroll is not restarted. `prefers-reduced-motion` switches to an instant jump. Covered by 6 behaviour tests and 13 unit tests. |
| 22 | P2 | A word split across inline markup (`<strong>`, `<em>`, links) was clamped to the first text node, so part of it was not highlighted. | The map extends the range across text nodes, so the box covers the whole word. |
| 23 | P2 | Selections were trimmed before being read, which shifted every offset by the number of removed characters and made the highlight land one word early on long selections. | The text is kept exactly as the range reports it; readability is checked separately. |
| 24 | **P1** | **The popup was hard to read**: 13px text, 320px wide, and buttons using `#ea8c00` (orange) and `#dc2626` (red) with white text — around 3.1:1 and 4.5:1 contrast, below the 4.5:1 needed for normal text. | Rebuilt at 360px with 14px base text, 44px buttons and a palette where every foreground/background pair reaches at least 4.5:1 (measured: 5.0–17.9:1), plus a dark theme for `prefers-color-scheme: dark`. `npm run check` now measures every pair and fails below the threshold. |

## Reviewed and deliberately kept

| Item | Why it is fine |
| --- | --- |
| A hidden `<span id="read-aloud-selection-marker">` is inserted into the page while reading. | It is the only reliable way to map speech offsets back to page text. It is removed on stop/finish/error, is `display: none`, and failure to insert it degrades gracefully (highlighting falls back to a text search). |
| The extension cancels any speech already running on the page before it starts. | Chrome's `speechSynthesis` is a single queue per page; cancelling is required to give the user a predictable "Read" button. |
| Keeping the Chrome "pause/resume every 10 s" workaround. | Without it Chrome stops long utterances at around 15 seconds. It only runs while a reading is active and not paused. |
| `all_frames: false` for the content script. | Reading inside advertising or widget iframes would surprise users; the main frame covers the normal use case. |
| Every message is now shown inside the popup (an `aria-live` hint area) or as an on-page toast. No blocking `alert()` remains. | It keeps the extension from freezing a tab and makes errors readable in a screen reader as well. |

## Known limitations (documented, not fixable in code)

- `chrome://` pages, the Chrome Web Store, the New Tab page and the built-in PDF
  viewer cannot be scripted by any extension.
- Word highlighting needs voices that fire `boundary` events. Online/neural
  voices do not, so the extension highlights the start of the selection instead
  and warns the user in the popup.
- Pages that constantly rebuild their DOM (some editors and single-page apps) can
  invalidate the highlight; playback is unaffected because it is never dependent
  on the DOM.
- Text inside images, canvas, video and cross-origin iframes cannot be read.

## How the changes were verified

- `npm run check` — manifest fields, referenced files, real icon dimensions,
  Manifest V3 CSP (no inline scripts), no `eval` / `new Function` / remote code,
  and a syntax check of every script.
- `npm run lint` — Biome lints, formats and safe-fix-checks every JS, JSON, CSS
  and HTML file. It caught two things the tests could not: a variable left
  behind by the `lib/core.js` refactor, and a `<label>` in the popup that was
  not associated with any control.
- `npm test` — **145 tests** with the built-in `node:test` runner.
  `test/core.test.js` unit-tests the pure logic in `lib/core.js` directly:
  clamping, settings validation, chunk splitting (character-for-character over
  seven kinds of text, including unicode and 45,000-character inputs),
  readable-text detection, blocked-URL rules, error-code messages and voice
  selection, offset lookup (boundaries, past the end, invalid input) and scroll
  planning (13 cases, including a simulated 6,000 px page that must never scroll
  backwards). `test/content.test.js` and `test/popup.test.js` then drive the real
  scripts against a fake DOM: message protocol, rejection of malformed messages,
  error codes, whitespace-only and single-character selections, article
  detection, highlight creation/cleanup, **the same sentence repeated three times
  on a page (the highlight must stay on the selected copy)**, a word split across
  two inline text nodes, **scrolling behaviour** (once, forwards, never for a
  visible word, instant with reduced motion), boundary events with missing, zero,
  whitespace-only and out-of-range offsets, words that are not on the page,
  pause/resume/stop with and without an active reading, restart with a stale
  utterance, speech errors, late-arriving voices (event and timeout paths), an
  invalidated extension context, tab visibility, page unload, long-text
  chunking (character-for-character) and timer leaks. Popup: voice list
  building, default voice choice, restricted-URL detection, injection retry and
  refused injection, every error-code message, storage read/write failures,
  debounced and flushed saves, `readingComplete` handling, an empty voice list
  and a saved voice that no longer exists. Unhandled promise rejections fail
  the run.
- `npm run build` — packs the store zip and re-reads it to confirm the entry
  list. Both artifacts land in `dist/`: `dist/unpacked/` for *Load unpacked* and
  the versioned zip for upload. The zip was also extracted and compared byte for
  byte with the source files, and CI repeats that comparison on every push.
- Manual pass over `test-page.html` (selection, article detection, tab switch,
  long text, unicode and RTL, contenteditable, repeated words).

## What the automated checks cannot cover

These need a real Chrome session (and, for the first one, a human ear). They are
the honest remainder of the audit:

| Area | Why it is not automated | How to check it |
| --- | --- | --- |
| Actual speech audio | Node has no `speechSynthesis`; the harness only records calls | Read a paragraph on `test-page.html` and listen |
| Boundary events from real voices | Only real voices emit them, and online voices never do | Use a local voice on `test-page.html` |
| Chrome's ~15 second speech cutoff | Timing bug inside Chrome itself | Read a long article and listen past 30 seconds |
| Injected CSS against real page styles | Needs a real rendering engine | `test-page.html` plus a heavy site with aggressive CSS |
| Popup layout and rendering | The harness never parses `popup.html` | Open the popup and resize the window |
| Manifest acceptance by Chrome | `npm run check` approximates Chrome's validation | `chrome://extensions` → Load unpacked |
| Real `chrome.storage.sync` quota behaviour | Storage is faked | Drag the sliders quickly, close and reopen the popup |
| Chrome-protected pages | Cannot be scripted by design | Open the popup on `chrome://extensions` and a new tab |
| Screen-reader output | Needs assistive technology | Run Narrator/NVDA over the popup |
| Pages that rebuild their DOM | Site-specific (editors, heavy single-page apps) | Try one editor you use and confirm playback continues |
