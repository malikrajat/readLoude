# Contributing

Thanks for helping. This extension is deliberately small: three plain
JavaScript files, no build step and no runtime dependencies, so it should stay
easy to read in one sitting.

## Getting started

1. Clone the repository and run `npm ci` (Biome is the only dev dependency).
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load
   unpacked** and pick `dist/unpacked` after running `npm run build`.
3. Open `test-page.html` in the browser and work through the checklist at the
   top of that page.

Node.js 18+ is only needed for the tooling. Python with Pillow is only needed to
regenerate images (`pip install -r tools/requirements.txt`).

Loading `dist/unpacked` rather than the repository root means you test exactly
the files that get published.

## Before you open a pull request

```bash
npm run verify    # lint + manifest + listing + tests
npm run create    # clean build into dist/
```

Both must pass. `npm run verify` is what the GitHub workflow runs.

## Linting and formatting

Biome does both. Run `npm run lint:fix` before you push; CI runs `npm run lint`
and fails on formatting drift.

The configuration is in `biome.json`. The CSS linter is off on purpose (the
injected stylesheet needs `!important` to survive page styles), and a few
recommended rules are disabled for readability. The reasons are written down in
[docs/README.md](docs/README.md) under *Linting and formatting policy* — if you
disable another rule, add it there in the same commit.

## What to test when you change something

| Area you touched | Also check |
| --- | --- |
| `lib/core.js` | `npm test` — the unit tests in `test/core.test.js` cover it directly |
| `content.js` reading path | `npm test`, then read a paragraph on `test-page.html` |
| `content.js` highlighting | Select text that is split across `<strong>`/`<em>` and confirm the marker tracks the right word |
| `content.js` messages | Stop, restart, reopen the popup mid-read, switch tabs mid-read |
| `popup.js` | Settings persist after closing and reopening the popup; Pause/Stop states stay correct |
| `manifest.json` | `npm run check`, then reload the unpacked extension |
| Listing or images | `npm run check:listing` |

## Code style

- 2-space indentation, semicolons, single quotes in `.js` files.
- `'use strict';` at the top of every script.
- Guard browser APIs with `try/catch`; the extension runs inside pages it does
  not control and must never break a page.
- Never add a network request, remote script, `eval` or `new Function`.
  `npm run check` fails on the last three, and the store rejects the first.
- Prefix every log with `[Read Aloud]`, and keep new verbose logging behind the
  `DEBUG` flag in `content.js`.

## Adding tests

Three files, all using the built-in `node:test` runner:

| File | Use it for |
| --- | --- |
| `test/core.test.js` | Pure functions. Fastest and most precise — prefer adding logic here when you can. |
| `test/content.test.js` | Anything that touches the DOM, messages or speech in the page. |
| `test/popup.test.js` | Popup state, storage, tab handling and error messages. |

`test/helpers/fake-dom.js` provides the fake DOM, fake timers and the sandbox
loader; `test/helpers/harness.js` provides `createContentHarness()` and
`createPopupHarness()`, which load the *real* extension scripts. Each factory
returns an isolated environment, so tests do not depend on each other's order.

Add a `it('what it should do', () => { ... })` next to the area you changed. If
your change needs a new browser API, extend the fake DOM rather than mocking
around the code under test.

## Updating the store listing

Edit `store/listing.md`, then run `npm run check:listing`. Two rules matter more
than the others:

- the detailed description must stay accurate (misleading metadata is a removal
  reason), and
- no tracked keyword may appear more than five times.

If you add a keyword you want to rank for, add it to the table in
`scripts/check-listing.js` as well so it is counted from then on.

## Releases

1. Bump `version` in `manifest.json` **and** `package.json`.
2. Add a `CHANGELOG.md` entry.
3. `npm run release`.
4. Upload `dist/read-aloud-with-highlight-v<version>.zip` in the developer
   dashboard and submit for review.

See [store/SUBMISSION-CHECKLIST.md](store/SUBMISSION-CHECKLIST.md).
