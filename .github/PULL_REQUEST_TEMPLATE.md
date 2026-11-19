## What changed

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The user-visible reason, not the implementation detail. -->

## How it was tested

- [ ] `npm run ci` passes
- [ ] `npm run build` produces a zip
- [ ] Manually checked on `test-page.html` (say which sections)

## Checklist

- [ ] No new permissions, network calls, `eval` or remote code
- [ ] Page-facing behaviour is wrapped in `try/catch` and cannot break a page
- [ ] `CHANGELOG.md` and both `version` fields updated (release PRs only)
- [ ] `store/listing.md` updated if user-visible behaviour changed
