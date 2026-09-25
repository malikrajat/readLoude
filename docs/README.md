# Documentation index

Start here, then follow the link that matches what you are doing.

| If you want to... | Read |
| --- | --- |
| Understand what the extension does and how to use it | [../README.md](../README.md) |
| See what was fixed and why (the audit) | [code-review.md](code-review.md) |
| Publish or update the Chrome Web Store listing | [../store/SUBMISSION-CHECKLIST.md](../store/SUBMISSION-CHECKLIST.md) |
| Copy the listing text, permission justifications and privacy answers | [../store/listing.md](../store/listing.md) |
| Check the extension against the current store policies | [chrome-web-store-compliance.md](chrome-web-store-compliance.md) |
| Know exactly what data is handled, and where | [../PRIVACY.md](../PRIVACY.md) |
| Contribute code, tests or artwork | [../CONTRIBUTING.md](../CONTRIBUTING.md) |
| Report a security issue | [../SECURITY.md](../SECURITY.md) |
| See what changed between versions | [../CHANGELOG.md](../CHANGELOG.md) |

## Map of the repository

```
manifest.json                   Extension manifest (MV3)
background.js                   Service worker: seeds defaults on install/update
lib/core.js                     Shared pure logic: settings, chunking, URL rules
content.js                      Reading, highlighting, pause/resume, on-page messages
content.css                     Styles for the marker, the fallback box and the toast
popup.html / popup.js           Toolbar popup and its controller
icons/                          16, 32, 48, 128 px icons

test/core.test.js               Unit tests for lib/core.js
test/content.test.js            Behaviour tests for content.js
test/popup.test.js              Behaviour tests for popup.js
test/helpers/                   Fake DOM, fake timers and the two harnesses

scripts/verify.js               Manifest + MV3 + CSP + icon validation
scripts/check-listing.js        Store listing rules and keyword-spam limits
scripts/test.js                 Runs every test file in one process
scripts/build.js                Builds dist/unpacked and the store zip
scripts/clean.js                Removes dist/

tools/generate-icons.py         Regenerates the icon set
tools/generate-store-assets.py  Regenerates screenshots and promo tiles
tools/requirements.txt          Pinned Pillow for the generators

store/listing.md                Listing copy, permission justifications, keyword map
store/SUBMISSION-CHECKLIST.md   Step-by-step publishing walkthrough
store/*.png                     Screenshots (1280x800) and promo tiles

docs/code-review.md             Edge cases, corner cases and fixes
docs/chrome-web-store-compliance.md   Policy-by-policy compliance
biome.json                      Linter and formatter configuration
test-page.html                  Manual test page with edge cases
.github/workflows/ci.yml        Lint, manifest, listing, tests, build
.github/workflows/release.yml   Tag-driven release with the package attached
```

## Command reference

| Command | What it does |
| --- | --- |
| `npm ci` | Installs Biome, the only dev dependency |
| `npm run lint` | Biome: lint + format + safe-fix checks over JS, JSON, CSS and HTML |
| `npm run lint:fix` | Applies Biome's safe fixes |
| `npm run format` | Rewrites files with the Biome formatter |
| `npm run check` | Validates the manifest, MV3 rules, CSP, referenced files and icon dimensions, and syntax-checks every script |
| `npm run check:listing` | Validates `store/listing.md`: screenshots, sizes, transparency, description length and the five-repeat keyword limit |
| `npm test` | 145 unit and behaviour tests |
| `npm run verify` | lint + check + check:listing + test — the full gate |
| `npm run ci` | Alias for `verify`, the same thing CI runs |
| `npm run build` | Writes `dist/unpacked/` and `dist/read-aloud-with-highlight-v<version>.zip` |
| `npm run create` | `clean` + `build`, for a release build |
| `npm run release` | `verify` + `build` |
| `npm run assets` | Regenerates icons and store images (needs Python + Pillow) |

## Linting and formatting policy

Biome handles both, configured in [../biome.json](../biome.json):

- 2-space indent, 100-column lines, LF endings, single quotes, semicolons.
- The **recommended** rule set stays on. Two deliberate exceptions, plus one
  module-level choice, are documented here so nobody has to guess:

  | Disabled | Why |
  | --- | --- |
  | CSS linter | `content.css` is injected into pages that already have their own styles, so `!important` on every rule is required by design. The CSS *formatter* is still on. |
  | `complexity/useLiteralKeys` | Keeps `obj['key']` readable where the key is dynamic or mirrors a manifest field. |
  | `style/useTemplate` | Some messages are concatenated deliberately to stay on one line while formatting. |

  `noForEach` stays off because `forEach` reads better than `for...of` for the
  short list operations in the tooling, and `noNonNullAssertion` / `noExplicitAny`
  / `useNamingConvention` are TypeScript-oriented and never trigger here.

- `biome check .` (what `npm run lint` runs) fails on lint errors *and* on
  formatting drift. `npm run lint:fix` fixes both automatically.

## Conventions

- Plain JavaScript, no build step, no runtime dependencies. If a change needs a
  bundler, it is probably the wrong change.
- Pure logic belongs in `lib/core.js` where it can be unit tested; DOM and
  `chrome.*` work belongs in `content.js` / `popup.js`.
- Every user-visible string lives in `popup.html`, `content.js`, `lib/core.js`
  or `store/listing.md` — nowhere else.
- Anything the store can reject is checked by a script, not by memory. See
  [chrome-web-store-compliance.md](chrome-web-store-compliance.md).
- Update `CHANGELOG.md` and both `version` fields for every release.
