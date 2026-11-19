# Security policy

## Reporting a vulnerability

Please report privately through GitHub's **Report a vulnerability** button on the
Security tab of <https://github.com/malikrajat/readLoude>, or by opening a
minimal public issue that does **not** include exploit details.

Include the extension version, the browser version, the site or page where it
happened, and the steps to reproduce. Expect an initial reply within a week.

## Scope

In scope:

- Anything that lets a web page read, modify or exfiltrate data through the
  extension.
- Anything that lets the extension send page content, browsing activity or
  settings off the device.
- Privilege escalation through the content script or the service worker.
- Ways to make the extension misbehave permanently (unescapable loops, storage
  exhaustion).

Out of scope:

- Chrome's own `speechSynthesis` behaviour, including the ~15 second cutoff for
  long utterances (worked around, not a vulnerability here).
- Pages that Chrome protects from every extension (`chrome://`, the Web Store,
  the PDF viewer).
- The absence of word highlighting with online voices.

## Design guarantees

These are properties of the design, and regressions are treated as bugs:

1. **No network access.** The extension makes no requests of its own. There is
   no `fetch`, `XMLHttpRequest`, `WebSocket` or remote script anywhere in the
   package.
2. **No remote code.** No `eval`, no `new Function`, no dynamic imports, no
   `wasm-unsafe-eval`. `npm run check` fails if one appears.
3. **Isolated world only.** The content script runs with `"world": "ISOLATED"`,
   so it cannot read or change the page's own JavaScript, and the page cannot
   call into the extension.
4. **Least privilege.** `activeTab`, `scripting` and `storage`, plus
   `<all_urls>` which is required to read the page the user chooses. No `tabs`,
   `cookies`, `history`, `webRequest` or `clipboardRead`.
5. **No injection of page-controlled text.** Messages from the popup are
   validated; text is only ever spoken, never evaluated.
6. **Reversible page changes.** The extension adds at most one hidden marker and
   one overlay box, and removes both when reading stops.

## Dependencies

There are none at runtime. The scripts in `scripts/` and `tools/` use only
Node.js built-ins; the image tools use Pillow.
