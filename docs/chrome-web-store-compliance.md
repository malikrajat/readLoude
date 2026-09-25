# Chrome Web Store compliance

Everything in this file was checked against the live policy pages on
**22 September 2026**. Chrome changes these pages without notice, so re-run this
list before every submission (see [Keeping this current](#keeping-this-current)).

## Sources

| Policy page | URL | Page date |
| --- | --- | --- |
| Program Policies (index) | <https://developer.chrome.com/docs/webstore/program-policies> | fetched 22 Sep 2026 |
| Listing Requirements | <https://developer.chrome.com/docs/webstore/program-policies/listing-requirements> | fetched 22 Sep 2026 |
| MV3 Requirements | <https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements> | fetched 22 Sep 2026 |
| Quality Guidelines | <https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines> | fetched 22 Sep 2026 |
| Minimum Functionality | <https://developer.chrome.com/docs/webstore/program-policies/minimum-functionality> | fetched 22 Sep 2026 |
| Use of Permissions | <https://developer.chrome.com/docs/webstore/program-policies/permissions> | fetched 22 Sep 2026 |
| User Data FAQ | <https://developer.chrome.com/docs/webstore/program-policies/user-data-faq> | fetched 22 Sep 2026 |
| Data Handling | <https://developer.chrome.com/docs/webstore/program-policies/data-handling> | fetched 22 Sep 2026 |
| Spam and Abuse | <https://developer.chrome.com/docs/webstore/program-policies/spam-and-abuse> | 1 Nov 2022 |
| Discovery and ranking | <https://developer.chrome.com/docs/webstore/discovery> | 21 Mar 2022 |
| Privacy practices tab | <https://developer.chrome.com/docs/webstore/cws-dashboard-privacy> | fetched 22 Sep 2026 |
| Manifest reference | <https://developer.chrome.com/docs/extensions/reference/manifest> | fetched 22 Sep 2026 |
| `content_scripts` reference | <https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts> | fetched 22 Sep 2026 |

## Technical requirements (Manifest V3)

The MV3 policy requires that "the full functionality of an extension must be
easily discernible from its submitted code", with the logic self-contained in the
package. Remote execution is only tolerated through the Debugger or User Scripts
APIs, neither of which this extension uses.

| Rule | State | Enforced by |
| --- | --- | --- |
| No `<script>` tag pointing outside the package | No external scripts anywhere | `npm run check` scans the popup HTML |
| No `eval()` | Not used | `npm run check` greps every script |
| No `new Function()` or interpreter fed from the network | Not used | `npm run check` greps every script |
| All logic self-contained | 3 local scripts, no dynamic imports | Reviewer notes in the listing |
| Restrictive extension CSP | `script-src 'self'; object-src 'self'` declared explicitly | `npm run check` rejects `unsafe-eval`, `unsafe-inline`, `wasm-unsafe-eval` and remote origins in the CSP |
| Modern manifest | `manifest_version: 3`, service worker background, `minimum_chrome_version: 111` | `npm run check` |
| Content script isolated from page JavaScript | `"world": "ISOLATED"`, `all_frames: false`, `match_about_blank: false` | `npm run check` |
| 2-step verification for publishing | Account setting, not code | Checklist step 1 |

## Listing requirements

The policy states that a blank description, a missing icon or missing screenshots
is an automatic rejection, that metadata must be accurate and complete, and that
"Keyword Spam" is prohibited. Google gives three examples of keyword spam:

1. lists of sites, brands or keywords without substance,
2. lists of regional locations,
3. **"unnatural repetition of the same keyword more than 5 times"**.

Unattributed or anonymous testimonials in the description are also not allowed.

| Rule | State | Enforced by |
| --- | --- | --- |
| Description is not blank | Full detailed description in `store/listing.md` | `npm run check:listing` |
| Icon present | 16/32/48/128 px, PNG | `npm run check` (dimensions re-read from the files) |
| At least one screenshot | 5 screenshots at 1280×800 | `npm run check:listing` |
| Screenshots 1280×800 or 640×400, 24-bit, no alpha | All RGB, no alpha channel | `npm run check:listing` reads the PNG header |
| No keyword repeated more than 5 times | Highest count is 2 | `npm run check:listing` counts each target phrase |
| No raw keyword lists | No comma/semicolon list of short tokens | `npm run check:listing` |
| No anonymous testimonials | None in the description | `npm run check:listing` warns |
| Privacy fields match the privacy policy and the code | See the table below | Manual, before every submission |
| Summary matches the manifest description | Byte-identical by design | `npm run check:listing` warns on drift |

## User data and privacy

The User Data FAQ is explicit on the point that catches most read-aloud
extensions:

> "Does an extension need to disclose user data handling if the data is only
> processed or stored locally on a user's device? **Yes.**"

and it lists *website content and resources* as user data. Reading a page aloud
therefore counts as handling user data even though nothing is transmitted. The
consequences, all applied in this repository:

| Requirement | State | Where |
| --- | --- | --- |
| Publish a privacy policy | Yes, linked from the listing | [../PRIVACY.md](../PRIVACY.md) |
| Disclose local handling | The policy describes the page text, the settings and the hidden marker, each with purpose, destination and retention | [../PRIVACY.md](../PRIVACY.md) |
| Tick the right data category in the dashboard | **Website content**, not "none" | [../store/listing.md](../store/listing.md) |
| Data handling statement in the dashboard | Free-text explanation provided | [../store/listing.md](../store/listing.md) |
| No transmission of browsing activity | The extension makes no network requests | `npm run check` plus the reviewer notes |
| Secure handling of anything collected | Nothing is collected | [../PRIVACY.md](../PRIVACY.md) |

## Permissions

> "Request access to the narrowest permissions necessary... Don't attempt to
> 'future proof' your Product by requesting a permission that might benefit
> services or features that have not yet been implemented."

| Permission | Narrowest possible? | Justification |
| --- | --- | --- |
| `<all_urls>` | Yes — the extension reads whatever page the user chooses, and a content script has to be declared before the click. | Reading the page the user asked for |
| `activeTab` | Yes, it is the narrow fallback path | Acting on the visible tab |
| `scripting` | Yes, there is no narrower way to inject on demand | Injecting the reader and reading the selection |
| `storage` | Yes | Remembering three settings |

Deliberately not requested: `tabs`, `cookies`, `history`, `downloads`,
`webRequest`, `notifications`, `identity`, `clipboardRead`, `management`,
`web_accessible_resources`, `optional_host_permissions`.

## Quality and minimum functionality

| Rule | State |
| --- | --- |
| Single, narrow purpose | Speaking the page the user chose, and marking the spoken word |
| No bundle of unrelated features | None; three buttons and two sliders |
| Not a launcher for another site or app | Fully functional on its own |
| No broken functionality | 101 automated checks plus a manual test page |
| No ads and no ad injection | None |
| Does not hijack search or the new tab page | It touches neither |

## Discoverability

Ranking is a heuristic, not a keyword auction. Google documents that it uses
**ratings** and **usage statistics such as installs versus uninstalls over
time**, along with design quality, a clear purpose, an intuitive setup and ease
of use. Search additionally uses listing metadata. There is no keyword field,
placement cannot be bought, and manipulating reviews or installs is a removal
offence.

Practical order of impact for this extension:

1. **First-run success.** A user who gets audio in one click stays installed.
2. **Ratings.** Ask after a few days of real use, never in exchange for anything.
3. **Listing completeness.** Name, summary, description, category, five
   screenshots, promo tiles — all done here.
4. **Badges.** *Established Publisher* needs verified identity and a clean record
   over months. The *Featured* badge can be nominated through One Stop Support:
   extension, English support, public listing, no violations, core features free.

## Keeping this current

Re-read the policy pages listed at the top (each shows its own date), then run:

```bash
npm run check            # manifest, MV3 rules, CSP, icons, scripts
npm run check:listing    # listing rules, keyword counts, image requirements
npm test                 # reading behaviour
npm run release          # all of the above, then rebuild the upload zip
```

If a policy changes, update this file first, then the code or the listing, then
bump the version in `manifest.json` and `package.json` (both), add a
`CHANGELOG.md` entry and rebuild.
