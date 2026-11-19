# Chrome Web Store listing

Everything here is copy-and-paste ready for the developer dashboard. Replace
anything marked `TODO`, then run `npm run check:listing` — it enforces the
official listing rules (blank description, missing images, transparency in
screenshots and keyword spam) before you submit.

Rules verified against the live policy pages on 22 September 2026. Sources are
listed in [../docs/chrome-web-store-compliance.md](../docs/chrome-web-store-compliance.md).

## Copy-paste field values

| Field | Value |
| --- | --- |
| Extension name | `Read Aloud with Highlight` (25 characters, limit 45) |
| Short name (manifest) | `Read Aloud` |
| Category | `Accessibility` |
| Language | `English (United States)` — add `Hindi` after the first release |
| Homepage URL | `https://github.com/malikrajat/readLoude` |
| Support URL | `https://github.com/malikrajat/readLoude/issues` |
| Privacy policy URL | `https://github.com/malikrajat/readLoude/blob/main/PRIVACY.md` |

## Summary

This text must stay identical to the `description` field in `manifest.json`
(132 character limit). `npm run check` fails if they drift apart.

```
Read any page or selection aloud with word-by-word highlighting. Pauses when you switch tabs and works offline.
```

## Detailed description

```
Read Aloud with Highlight speaks the page you are already reading and marks each word as the voice reaches it.

Select a paragraph, or select nothing at all, then press Read. The extension picks up the text, starts speaking with the voice you chose and draws a soft highlight over the current word. It is plain text to speech: the voices are the ones already installed in Chrome, with nothing extra to download and no account to create. It is made for people who study, proofread their own writing, learn a language, or simply prefer listening to a screen.

WHAT IT DOES

- Speaks the text you selected, or detects the main article when you select nothing
- Marks every spoken word so your eyes can follow the voice
- Pauses by itself when you change tabs and continues when you come back
- Gives you Pause, Resume and Stop at any time
- Lets you choose any voice installed in Chrome and fine-tune speed and pitch, with Slow, Normal and Fast presets
- Remembers your voice, speed and pitch for the next session
- Follows your light or dark theme, with large buttons and readable contrast
- Opens with the keyboard shortcut Alt+Shift+R

WHO IT HELPS

- Studying: listen to course material or documentation while you take notes
- Proofreading: hearing your own sentences is the fastest way to catch clumsy ones
- Language learning: compare what you wrote with how it sounds
- Focus and fatigue: keep up with long pages when reading on screen is tiring
- Accessibility: a second way to take in the same page, alongside your screen reader

PRIVACY, IN PLAIN WORDS

There is no account, no advertising and no analytics. The text of a page is turned into audio by the text to speech engine built into Chrome, on your own device, and is never uploaded. Your voice, speed and pitch are stored in your browser profile so the extension can remember them; they contain nothing personal. Full details are in the privacy policy.

GOOD TO KNOW

- Voices without the "(online)" label start instantly, work offline and support word markers. Chrome's online voices cannot report word positions, so the marker stays on the starting point and the popup says so.
- Chrome does not let any extension read its own pages: chrome://, the New Tab page, the Chrome Web Store and the built-in PDF viewer. Any normal website works.
- Text inside images, videos and canvases cannot be read.

TIP

Pin the extension to the toolbar and use Alt+Shift+R: select a paragraph, press the shortcut, press Read. Pause, switch tabs to check something, come back, and the reading picks up where it stopped.

Questions, bug reports and feature requests: github.com/malikrajat/readLoude/issues
```

## Graphics

| Asset | Requirement | File |
| --- | --- | --- |
| Store icon | 128×128 PNG | `icons/icon128.png` (uploaded with the package) |
| Screenshot 1 | 1280×800 PNG | `store/screenshot-1-read-aloud.png` |
| Screenshot 2 | 1280×800 PNG | `store/screenshot-2-word-highlight.png` |
| Screenshot 3 | 1280×800 PNG | `store/screenshot-3-voice-controls.png` |
| Screenshot 4 | 1280×800 PNG | `store/screenshot-4-pauses-on-tab-switch.png` |
| Screenshot 5 | 1280×800 PNG | `store/screenshot-5-private-offline.png` |
| Small promo tile | 440×280 PNG | `store/promo-small-440x280.png` |
| Marquee promo tile | 1400×560 PNG | `store/promo-marquee-1400x560.png` |

All images are 24-bit PNG without transparency, which the store requires.
`npm run check:listing` verifies the dimensions, the colour type and that at
least one screenshot exists. Regenerate with `npm run store-assets`.

Screenshot captions (shown in some store surfaces):

1. Read any article aloud — one click, and it speaks the page you are reading.
2. Follow along, word by word — the marker moves with the voice.
3. Your voice, your speed — pick any voice installed in Chrome.
4. Keeps your place — reading pauses when you switch tabs.
5. Nothing leaves your browser — works without a connection, no account needed.

## Keyword map

Chrome Web Store search ranks on listing metadata (name, summary, description,
category), so keywords belong *in context*, not in a list. Google rejects
"Keyword Spam", and states that **repeating the same keyword more than five
times in the description is spam**. `npm run check:listing` counts every phrase
below and fails above five.

| Phrase | Search intent | Where it is used | Current count |
| --- | --- | --- | --- |
| read aloud | Primary | Name and the first line of the description | 1 |
| text to speech | Secondary; people also search the acronym TTS | Intro line and the privacy paragraph | 2 |
| highlight | Feature | Name and "WHAT IT DOES" | 2 |
| article | Content type | Feature list | 1 |
| offline | Benefit | Summary and "GOOD TO KNOW" | 1 |
| accessibility | Category | "WHO IT HELPS" | 1 |
| reader | Category | "WHO IT HELPS" (screen reader) | 1 |
| speech | Technology | Carried by the text to speech phrase | 0 standalone |
| dyslexia | Audience | Deliberately not claimed yet: add it only once you have a review from that audience | 0 |

The counts are printed by `npm run check:listing` on every run, so keep them in
sync here. Aim for one to three natural uses per phrase; more than five is a
rejection.

Two further metadata levers that are free:

- **Category.** `Accessibility` is the closest fit and is browsable. Do not pick
  a category you do not belong in; misleading metadata is a removal reason.
- **Translations.** The dashboard accepts a translated listing per language,
  which gives you a second search index at no cost. There is no code change:
  the extension itself stays English until you add `_locales`, and the manifest
  check in `npm run check` refuses a half-finished localisation.

## Listing translation (Hindi draft, for after the first release)

```
नाम: Read Aloud with Highlight
संक्षिप्त विवरण: चुने हुए टेक्स्ट या पूरे लेख को शब्द-दर-शब्द हाइलाइट के साथ ज़ोर से पढ़ें। टैब बदलने पर रुक जाता है और ऑफ़लाइन काम करता है।
```

Add the matching language only after the English listing has at least a few
reviews; a thin translation with no reviews ranks worse than none.

## Privacy practices tab

### Single purpose

```
Read Aloud with Highlight has one purpose: to speak the text of the page, or the
selection, that the user asked for - using the speech engine already built into
Chrome - and to mark the word being spoken.
```

### Justification for each permission

| Permission | Justification |
| --- | --- |
| `activeTab` | Acts on the tab the user is looking at, and covers pages that are not yet covered by host permissions. Never used in the background. |
| `scripting` | Injects the reading and highlighting code into the page the user asked to read, and reads the user's current text selection so it can be spoken. |
| `storage` | Stores only the user's own preferences (voice name, speed, pitch) so they are remembered. Nothing else is stored. |
| Host permission `<all_urls>` | The extension must be able to read the text of whatever page the user asks it to read. The text is processed by the browser's local speech engine and is never transmitted. |

### Remote code

```
No. All logic is contained in the uploaded package. No script, module or
WebAssembly file is loaded from outside the extension, and it uses neither
eval() nor new Function().
```

### Data usage — read this, it changed

Earlier versions of this file told you to leave every data category unticked.
That is **wrong**, and it is the fastest way to get a listing removed for
inaccurate privacy fields.

Chrome's user data FAQ says an extension must disclose data handling *even when
the data is only processed or stored locally on the user's device*, and lists
"website content and resources" as user data. This extension reads page text to
speak it, so:

1. Tick **Website content** in the data usage form.
2. Tick the three certification boxes (no sale of data, no use unrelated to the
   single purpose, no use for creditworthiness or lending).
3. Paste the privacy policy URL.
4. In the free-text box, use:

```
Website content (the text of the page the user chose to read) is processed
entirely on the user's device by Chrome's built-in speech synthesis API. It is
never transmitted, stored or shared. The only stored values are the user's own
voice, speed and pitch preferences.
```

### Notes for the reviewer

```
How to test:
1. Open any article, for example https://en.wikipedia.org/wiki/Reading
2. Select a paragraph, click the extension icon and press "Read". Speech starts
   and a blue marker follows the spoken word.
3. Press "Pause"; switch to another tab (playback pauses automatically); come
   back and press "Pause" again to resume. Press "Stop" to end.
4. Select nothing and press "Read": the extension detects the main article.

Notes:
- The extension stores only the user's voice, speed and pitch preferences in
  chrome.storage.sync. Page text is passed to the browser's speechSynthesis API
  and never leaves the device.
- Word markers require a voice that reports word boundaries. Chrome's online
  voices do not, so the extension shows a fallback marker and explains this in
  the popup instead of failing silently.
- Chrome-protected pages (chrome://, the Web Store, the PDF viewer) are excluded
  by design and the popup explains why.
- The content script runs in the ISOLATED world, so it cannot read or change the
  page's own JavaScript.
```

## How ranking actually works

From Google's own discovery documentation, ranking is a heuristic built on:

1. **Ratings from users**, and
2. **Usage statistics, such as installs versus uninstalls over time**,

plus qualitative signals: a pleasant design, a clear purpose that fills a real
need, an intuitive setup, and general ease of use. Search additionally ranks on
listing metadata, so a complete and accurate listing matters.

What that means in practice, in order of impact:

| Lever | What to do |
| --- | --- |
| Ratings | Ask early users for an honest review after they have used it for a few days. Never incentivise reviews; that is a policy violation. |
| Installs vs uninstalls | The first five minutes decide this. A user must get audio in one click, so keep the popup to three buttons and never show an error where a hint would do. |
| Onboarding | The popup says "Select text on a page, then press Read". Keep that line accurate. |
| Listing metadata | Name, summary, description, category and screenshots all feed search. |
| Badges | The *Established Publisher* badge needs verified identity plus a clean track record over months. The *Featured* badge can be nominated through One Stop Support: it requires an extension, English support, a public listing, no active violations and core features free of credentials or payment. |

What does **not** work: repeating keywords (rejection), buying or incentivising
installs and reviews (removal), and publishing near-duplicate listings to catch
more searches (removal). There is no keyword field and no way to pay for
placement.
