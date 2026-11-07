# Contributing

Thanks for helping. Keep changes small and testable.

## Setup

```bash
npm install
npm test
npm run doctor
```

## Rules

- No personal data in the repo: no real domains, account ids, tokens, screenshots or profile directories.
- Site-specific code goes in `src/helpers/sites/` and must load lazily, so a missing recipe never breaks the harness.
- Helpers in `src/helpers/harness.js` are the product. Add a unit test for any pure logic and a fixture when the behavior is DOM-related.
- Do not add sleeps where an event or selector wait works. The benchmark exists to keep that honest.

## Pull requests

- Describe the failing scenario and the smallest change that fixes it.
- Include the output of `npm test`.
- If you touch the driver, include before/after numbers from `bench/`.
