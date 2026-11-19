# Privacy Policy — Read Aloud with Highlight

Last updated: 22 September 2026
Applies to: Read Aloud with Highlight (Chrome extension, version 1.0.0 and later)
Developer: Rajat Malik

## The short version

The extension does not collect, transmit, sell or share any personal data, and it
has no server, no account, no analytics and no advertising. It reads the text you
ask it to read, hands that text to the speech engine built into Chrome on your
own device, and stores the three settings you chose (voice, speed, pitch).

Chrome's policy counts *processing data on your device* as "handling" user data,
so this policy describes that processing too — see [Website content](#1-website-content-the-text-of-a-page) below.

## What the extension handles, and why

### 1. Website content (the text of a page)

When you press *Read*, the extension takes the text you selected — or, if you
selected nothing, the main article it detects — and passes it to the browser's
`speechSynthesis` API to produce audio.

- **Purpose:** to read the text aloud and to mark the word being spoken.
- **Where it goes:** nowhere. The conversion happens on your device with the
  voices already installed in Chrome or your operating system.
- **Storage and retention:** the text is held in memory only while it is being
  read. It is discarded when reading stops, when the page is closed, or when the
  browser is closed. It is never written to disk and never sent to any server,
  including the developer's.
- **Note:** if you choose a voice that Chrome has marked *online*, Chrome itself
  may fetch voice data from Google. That request is made by Chrome, not by this
  extension, and is covered by [Google's privacy policy](https://policies.google.com/privacy).
  Voices without the "(online)" label work entirely offline.

### 2. Your settings (voice, speed, pitch)

Your chosen voice name, speed and pitch are stored with Chrome's `storage.sync`
API.

- **Purpose:** to remember your preferences between sessions.
- **Where it goes:** into your own browser profile. If you are signed in to
  Chrome with sync enabled, Chromium may sync these three values to your other
  signed-in devices as part of your browser profile. The developer never sees
  them.
- **Storage and retention:** until you change them or uninstall the extension.
- **Deleting them:** remove the extension, or clear site/extension data for it in
  Chrome's settings.

### 3. A hidden marker inside the page

While reading, the extension inserts one hidden `<span>` element at the position
where your selection started. It is what lets the highlight follow the correct
word when the same words appear several times on a page.

- **Purpose:** to map the spoken position back to the page.
- **Where it goes:** it stays inside the page you are reading, is invisible, and
  is removed as soon as reading finishes — stop the reading and it is gone, along
  with the highlight.
- **Storage and retention:** only for the duration of a reading.

## What the extension does not do

- No personal information, browsing history, page content, form data, keystrokes
  or location data is collected, transmitted or stored.
- No analytics, telemetry, tracking, crash reporting or advertising.
- No data is sold or shared with third parties, because no data leaves your
  device.
- No account, no sign-in, no payment.

## Permissions, and why each is needed

| Permission | Why it is needed |
| --- | --- |
| Read data on all websites (`<all_urls>`) | To read the text of the page you ask it to read. The page is only examined when you press *Read* or *Pause*/*Stop* while a reading is active. |
| `activeTab` | To act on the tab you are looking at, including pages that are not yet covered by host permissions. It is never used in the background. |
| `scripting` | To inject the reading and highlighting code into the page and to read your current text selection. |
| `storage` | To remember your voice, speed and pitch. Nothing else is stored. |

The content script runs in the *isolated world*, which means it cannot read or
modify the page's own JavaScript, and the extension makes no network requests of
its own.

## Third-party services

None. The extension bundles all of its code; it loads nothing remotely and calls
no external API.

## Children

The extension is not directed at children and collects no data from anyone.

## Your rights

Because no personal data is collected or transmitted, there is no stored personal
data to access, correct, export or delete. Removing the extension removes the
only data it created (your three settings).

## Changes to this policy

Any change will be published at this URL with an updated date. If a future
version were ever to handle data differently, the change would be described here
before that version is published.

## Contact

Questions, concerns or requests: open an issue at
<https://github.com/malikrajat/readLoude/issues> — or use the developer contact
address shown on the Chrome Web Store listing.
