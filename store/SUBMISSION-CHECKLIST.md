# Chrome Web Store submission checklist

Follow this from top to bottom. Steps 0–3 are one-time setup; steps 4–9 are the
actual release. Everything you need is already in this repository.

Two rules decide most first-time rejections, so they are worth repeating:

1. **Metadata must be accurate and complete.** A blank description, a missing
   icon or missing screenshots is an automatic rejection, and privacy fields that
   contradict the privacy policy are a removal reason.
2. **No keyword spam.** Google rejects "unnatural repetition of the same keyword
   more than 5 times" in a description. `npm run check:listing` enforces that
   limit locally, so copy the description from `listing.md` rather than writing a
   new one.

Policy-by-policy detail, with the date each page was checked:
[../docs/chrome-web-store-compliance.md](../docs/chrome-web-store-compliance.md).

## 0. Before you start (10 minutes)

- [ ] `npm run ci` passes (lint, manifest checks, listing checks, 145 tests).
- [ ] `npm run create` produced `dist/read-aloud-with-highlight-v1.0.0.zip` and
      `dist/unpacked/`.
- [ ] `dist/unpacked/` loads cleanly with **Load unpacked** — that folder is
      byte-for-byte what the zip contains.
- [ ] Load the folder unpacked in `chrome://extensions` and click through the
      test scenarios in `test-page.html` one last time.
- [ ] `PRIVACY.md` is pushed to GitHub (see step 2) — the Web Store wants a live
      privacy policy URL.
- [ ] Decide the public contact email you will show in the store listing.

## 1. Create the developer account (one time)

1. Sign in to <https://chrome.google.com/webstore/devconsole> with the Google
   account that should own the extension.
2. Pay the one-time **US$5** registration fee.
3. Fill in the publisher name (this is public — use a real name or a brand) and
   the contact email.
4. Turn on **2-step verification** for that Google account. Publishing is
   blocked without it.
5. Complete the **trader / publisher declaration** if your account is asked for
   it. For a free extension, choose the non-trader option unless you actually
   sell something.

## 2. Publish the privacy policy (one time)

The listing needs a public URL. The easy option, with no extra hosting:

1. Push this repository to GitHub (`https://github.com/malikrajat/readLoude`).
2. Open `https://github.com/malikrajat/readLoude/blob/main/PRIVACY.md` and copy
   the URL.

If you prefer a clean page, enable GitHub Pages for the repository and link
`https://<username>.github.io/readLoude/PRIVACY` instead.

> Screenshot 5 in `store/` shows this URL, so update the text there
> (`tools/generate-store-assets.py`, then `npm run store-assets`) if you use a
> different link.

## 3. Prepare the listing text (one time)

- [ ] Open [store/listing.md](listing.md) and copy the name, summary, detailed
      description, permission justifications and reviewer notes.
- [ ] Replace every `TODO` (there is one in `README.md` for the store link).

## 4. Upload the package

1. In the [developer dashboard](https://chrome.google.com/webstore/devconsole)
   click **New item**.
2. Upload `dist/read-aloud-with-highlight-v1.0.0.zip`.
   The zip must contain `manifest.json` at the top level — the build script
   already does this. Do **not** zip the whole repository folder.
3. Wait for the automatic analysis to finish. It flags manifest errors, remote
   code, missing icons and unknown permissions before you go further.

## 5. Fill in the store listing

- [ ] Name, summary and detailed description from `listing.md`.
- [ ] Category **Accessibility**, language **English (United States)**.
- [ ] At least one screenshot: upload all five from `store/`.
- [ ] Small promo tile `store/promo-small-440x280.png`.
- [ ] Marquee promo tile `store/promo-marquee-1400x560.png` (optional but shown
      on the home page carousel).
- [ ] Homepage URL, support URL and the privacy policy URL from step 2.

## 6. Privacy practices tab

- [ ] **Single purpose** — paste the paragraph from `listing.md`.
- [ ] **Permission justifications** — one line per permission from the table in
      `listing.md`. This is where most submissions get slowed down, so be
      specific: say *what* the permission is used for and where.
- [ ] **Remote code** — answer **No**.
- [ ] **Data usage** — tick **Website content**. Chrome counts page text as user
      data even though it is only processed on the device, and the User Data FAQ
      says local handling must be disclosed. Then tick the three certifications
      and add the privacy policy URL. The free-text explanation is in
      `listing.md` under *Data usage — read this, it changed*.
- [ ] **Notes for the reviewer** — paste the reviewer notes; a step-by-step test
      script makes a human review much faster.

## 7. Distribution

- [ ] Visibility: **Public**.
- [ ] Regions: all regions (or restrict them if you have a reason).
- [ ] Pricing: **Free**.

## 8. Submit for review

1. Click **Submit for review**.
2. Expect a first decision in roughly 1–3 business days (up to a week for a new
   developer account). Watch the account email; Google asks for changes by
   email and in the dashboard.
3. If it is rejected, fix the specific issue, bump the version, run
   `npm run build`, upload the new zip and resubmit. See the list of common
   reasons below.

## 9. After it is published

- [ ] Open the live listing and install the extension from the store (not
      unpacked) to confirm everything works end to end.
- [ ] Add the listing URL to `README.md` and to the repository description.
- [ ] Ask a few users for an honest review — ratings decide how discoverable the
      extension is.
- [ ] Turn on the dashboard notification for "new reviews" so you can respond.

## Publishing an update later

1. Change `manifest.json` `version` and `package.json` `version` (both must
   differ from the published version).
2. Add a `CHANGELOG.md` entry.
3. `npm run create`.
4. Dashboard → your item → **Package** → *Upload new package* → **Submit for
   review**.

## Common rejection reasons to avoid

| Reason | How this project avoids it |
| --- | --- |
| Description does not match what the extension does | The listing description only describes real behaviour. |
| Missing or vague permission justification | `listing.md` has one justification per permission. |
| Remote code | No remote scripts, no `eval`, no `new Function`; `npm run check` fails if that changes. |
| Unclear single purpose | The extension only reads text aloud. |
| No privacy policy for a broad host permission | `PRIVACY.md` is published and linked in the dashboard. |
| Privacy fields that contradict the policy or the code | The data usage form ticks *Website content* and points at the matching section of `PRIVACY.md`. |
| Keyword spam in the description | `npm run check:listing` counts every target phrase and fails above Google's limit of five. |
| Screenshots that misrepresent the UI | The screenshots are drawn from the real popup layout. |
| Broken functionality in the reviewer's environment | A local voice is required for highlighting; the popup warns instead of failing. |
