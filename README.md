# Read Aloud with Highlight

A Chrome extension (Manifest V3) that reads a page — or just the text you
selected — out loud and highlights every word as it is spoken. It uses the
speech engine already built into Chrome, so there is no server, no account and
nothing to install beyond the extension itself.

## Features

- **Read a selection or the whole article.** If text is selected it is read;
  otherwise the extension detects the main article of the page.
- **Word-by-word highlighting** that follows the audio exactly, even when the
  same sentence appears several times on the page. The page only scrolls when
  the spoken word would otherwise leave the screen, and it always moves forward.
- **Pause, resume and stop** from the popup. Reading pauses on its own when you
  switch tabs and continues when you come back to it.
- **Voice, speed and pitch controls**, with Slow / Normal / Fast presets. Offline
  (local) voices are suggested first because they work offline and support word
  highlighting.
- **Readable interface** with large, high-contrast controls and a light and dark
  theme that follows your system setting.
- **Keyboard shortcut** `Alt+Shift+R` opens the popup.
- **Works offline** with local voices and keeps your settings between sessions.

## Install

### From the Chrome Web Store

Open the store listing and click *Add to Chrome*.
<!-- Replace with your listing URL after publishing. -->

### From source (developer mode)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Optionally open the extension details and enable **Allow access to file URLs**
   if you want to read local HTML files.

## Usage

1. Open any article, documentation page or blog post.
2. Select the text you want to hear, or select nothing to read the whole article.
3. Click the Read Aloud icon in the toolbar (or press `Alt+Shift+R`).
4. Press **Read**. Use **Pause** and **Stop** at any time.

If nothing is selected and no article can be detected, the popup tells you to
select text instead.

## Settings

| Setting | What it does |
| --- | --- |
| Voice | Any voice installed in Chrome. Voices without the `(online)` suffix are local, start instantly and support word highlighting. |
| Speed | 0.5× – 2×, with Slow / Normal / Fast presets. |
| Pitch | 0.5 – 2. |

Settings are saved automatically (with a short debounce, so dragging a slider
does not spam Chrome's storage quota).

## Permissions and privacy

| Permission | Why it is needed |
| --- | --- |
| `<all_urls>` (read data on all websites) | The extension has to read the text of whatever page you ask it to read. It only looks at the page when you press Read. |
| `activeTab` | Acts on the tab you are looking at; used as the fallback when a page is not covered by host permissions yet. |
| `scripting` | Injects the reading/highlighting script and reads your current selection. |
| `storage` | Remembers voice, speed and pitch. |

Nothing is collected or uploaded. Page text is passed to Chrome's own
`speechSynthesis` engine and never leaves your device. See
[PRIVACY.md](PRIVACY.md).

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| The page scrolled to the wrong place while reading | The highlight is mapped exactly onto your selection instead of searching the page, and the view only ever scrolls forwards. If you still see it, the page is changing while it is read — the extension rebuilds its map once and then falls back to a forward-only search. |
| "Chrome does not allow extensions to read browser pages" | `chrome://` pages, the New Tab page, the Web Store and the built-in PDF viewer cannot be scripted by any extension. Use a normal website. |
| Nothing happens on a local file | Open `chrome://extensions`, open the extension details and enable **Allow access to file URLs**. |
| No word highlighting | The selected voice does not report word boundaries. Pick a voice without the `(online)` suffix. |
| Reading stops after a page reload | The page reloaded, so the content script restarted. Press Read again. Highlighting may also stop on pages that rebuild their DOM constantly (for example some editors); playback continues. |
| The popup shows the wrong voice | Voices are matched by name; if a voice was removed from the system the extension falls back to the default local voice. |
| Reading is too fast or slow | Use the Speed slider or the presets; the value is remembered. |
| Two things are reading at once | Each tab has its own reading session. Press Stop in the tab you do not want. |
| The popup looks washed out | It follows Chrome's light or dark theme. Contrast is verified in both themes by `npm run check`, so please open an issue with a screenshot if it still looks wrong. |

## Project structure

```
manifest.json                   Extension manifest (MV3)
background.js                   Service worker: seeds defaults on install/update
lib/core.js                     Shared pure logic (settings, chunking, URL rules)
content.js                      Reading, highlighting, pause/resume, on-page messages
content.css                     Styles for the marker, the fallback box and the toast
popup.html / popup.js           Toolbar popup UI and its controller
icons/                          Extension icons (16, 32, 48, 128 px)

store/                          Store listing copy, screenshots and promo images
docs/                           Documentation index, audit, policy compliance
test/                           Unit tests (lib/core.js) and behaviour tests
scripts/verify.js               Package validation (npm run check)
scripts/check-listing.js        Store listing rules (npm run check:listing)
scripts/test.js                 Runs every test file (npm test)
scripts/build.js                Builds dist/unpacked and the store zip
scripts/clean.js                Removes dist/ (npm run clean)
tools/generate-icons.py         Regenerates the icon set
tools/generate-store-assets.py  Regenerates the store screenshots and tiles
biome.json                      Linter and formatter configuration
test-page.html                  Manual test page with edge cases
```

## Documentation

| Topic | Where |
| --- | --- |
| Everything, indexed | [docs/README.md](docs/README.md) |
| What was fixed and why | [docs/code-review.md](docs/code-review.md) |
| Chrome Web Store policy compliance | [docs/chrome-web-store-compliance.md](docs/chrome-web-store-compliance.md) |
| Listing text, permissions and privacy answers | [store/listing.md](store/listing.md) |
| Publishing, step by step | [store/SUBMISSION-CHECKLIST.md](store/SUBMISSION-CHECKLIST.md) |
| Data handling in plain words | [PRIVACY.md](PRIVACY.md) |
| Contributing and code style | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Which branches may run the GitHub Actions | [BRANCH-RULES.md](BRANCH-RULES.md) |

## Discoverability

The extension ranks on Chrome Web Store search through its listing metadata and
its **ratings and install-to-uninstall ratio** — not through keyword stuffing,
which the store treats as spam and rejects. The listing here is written with
that in mind: `read aloud`, `text to speech`, `highlight`, `article`, `offline`
and `accessibility` each appear once or twice in context, and
`npm run check:listing` fails the build if any of them is repeated more than
five times (Google's stated limit).

Also worth knowing: the store has no keyword field, placement cannot be bought,
and the [Established Publisher](https://developer.chrome.com/docs/webstore/discovery)
badge needs verified identity plus a clean track record over months. What
matters most in practice is that a first-time user gets audio within one click.

Details: [docs/chrome-web-store-compliance.md](docs/chrome-web-store-compliance.md).

## Development

Requirements: Node.js 18+ (20+ recommended) for the tooling. Python with Pillow
is only needed to regenerate images (`pip install -r tools/requirements.txt`).

```bash
npm ci                    # install Biome, the only dev dependency
npm run verify            # lint + manifest + listing + tests (the full gate)
npm run lint              # Biome: lint, format and safe-fix checks
npm run lint:fix          # apply Biome's safe fixes
npm run format            # rewrite files with the Biome formatter
npm test                  # unit tests + behaviour tests (145 of them)
npm run create            # clean dist/, then build both outputs
npm run build             # dist/unpacked + dist/read-aloud-with-highlight-v1.0.0.zip
npm run build:zip         # only the store zip
npm run build:unpacked    # only the loadable folder
npm run clean             # remove dist/
npm run assets            # regenerate icons and store images
```

### What each command checks

`npm run lint` runs Biome over every JS, JSON, CSS and HTML file. It fails on
lint errors and on formatting drift, so run `npm run lint:fix` before pushing.

`npm run check` fails on anything the store would reject: wrong manifest field
lengths or values, missing referenced files, icons whose real size does not match
the manifest, inline scripts (blocked by the MV3 CSP), `eval`, `new Function` and
JavaScript syntax errors.

`npm run check:listing` fails on listing problems: a missing or mis-sized
screenshot, a transparent PNG (the store wants 24-bit), a description that is
blank or too long, a keyword repeated more than five times, or a raw keyword
list.

The same command measures the popup's colours in both themes: every
foreground/background pair must reach a WCAG AA contrast ratio of 4.5:1, and the
measured values are printed so a regression is obvious.

`npm test` runs 145 tests: `test/core.test.js` covers the pure logic in
`lib/core.js` directly, and `test/content.test.js` / `test/popup.test.js` drive
the real scripts against a fake DOM. It cannot check how speech actually sounds
or how the popup renders; the section *What the automated checks cannot cover*
in [docs/code-review.md](docs/code-review.md) lists what still needs a real
browser, and `test-page.html` covers those manually.

### Build output

`npm run build` writes two things, always into `dist/`:

| Path | Purpose |
| --- | --- |
| `dist/unpacked/` | The extension folder. Load it with **Load unpacked** in `chrome://extensions` to test exactly what will be published. |
| `dist/read-aloud-with-highlight-v<version>.zip` | The upload for the Chrome Web Store developer dashboard. |

Both contain only the 12 runtime files: the manifest, the three scripts, the
styles, the popup, the icons and the licence. `npm run create` cleans `dist/`
first, which is the safest way to make a release build.

### Manual testing

1. Load the folder as an unpacked extension.
2. Open `test-page.html` in the browser.
3. Check the scenarios listed at the top of that page: selected text, whole
   article, no selectable text, very long text, right-to-left text and stop /
   restart behaviour.

### Debugging

Set `const DEBUG = true` at the top of `content.js` to get detailed console
logging in the page. The popup logs with the `[Read Aloud]` prefix.

## Releasing a new version

1. Change `version` in [manifest.json](manifest.json) **and** in
   [package.json](package.json).
2. Add an entry to [CHANGELOG.md](CHANGELOG.md).
3. Run `npm run release` (verify + build) or `npm run create` for a clean build.
4. Upload `dist/read-aloud-with-highlight-v<version>.zip` in the
   [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole).

Pushing a `v<version>` tag runs
[.github/workflows/release.yml](.github/workflows/release.yml), which verifies
the project, builds the package and checks that the tag matches `manifest.json`.
Neither workflow stores anything: no artifact is uploaded, nothing is attached
to a release, and the build output disappears with the run. Run `npm run create`
locally to get the files you upload.

The full walkthrough, including listing text and the review checklists, is in
[store/SUBMISSION-CHECKLIST.md](store/SUBMISSION-CHECKLIST.md).

## Known limitations

- Chrome protects some pages from every extension (`chrome://`, the Web Store,
  the New Tab page, the PDF viewer).
- Word highlighting needs a voice that reports word boundaries. Online voices do
  not, so the extension highlights the start of the selection instead and says so
  in the popup.
- Text inside images, canvas, videos and cross-origin iframes cannot be read.
- The extension adds one hidden marker element to the page while reading, which
  is removed when reading stops.

## License

[MIT](LICENSE) © Rajat Malik
