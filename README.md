# Citrus Maxima

Shift rota, planner and hub for all my apps. A PWA with no backend: data lives in the browser and in my own Google Drive (`My Apps/`).

Live: https://amaerys.github.io/Citrus-Maxima/

## What it does

- **Today** — your shift with a 24-hour day dial, the next 7 days, who's on with you, FSED / Upper Village specialists, MCI 2nd-physician days, Google Calendar, today's plan, your apps, a shareable brief, notes.
- **Rota** — the month grid (cyan ring = MCI 2nd physician, purple dot = your correction), day sheets with full coverage, "who could cover?", and **Correct this day** for swaps.
- **Team** — everyone across the rotas, call / WhatsApp, shifts you share.
- **Plan** — weekly goals, your rules (sleep, commute, buffers, protected time), suggestions placed around shifts and nights; apps' own requests come first. Accepted blocks go to Google Calendar.
- **Apps** — a launcher for Yuzu, Mephisto, Orange, Sinus, Kumquat, Embergine with what each needs today.
- **Settings** — Google, calendars, "me", diagnostics, backup / restore, theme.

Keyboard on desktop: `1–5` tabs, `/` search, `r` sync, `,` settings, `Esc` close.

## Google

One OAuth client (built in) serves every app. Each app's origin (`https://<org>.github.io`) must be listed under the client's *Authorized JavaScript origins*. Sign in once in **Settings**; the session renews silently, and a banner asks for a tap if it can't.

## Drive layout

All apps share one structure — see **[HUB.md](HUB.md)** (also copied to Drive › My Apps › HUB.md). In short: rotas in `My Apps/Rotas/`, each app in `My Apps/hub/<app>/` with a `status.json`, Citrus's plan in `My Apps/hub/citrus/plan.json`.

Rotas imported on any device are uploaded to `Rotas/` as `YYYY-MM Unit.xlsx`, so other devices and Orange pick them up.

## Code

```
docs/                 the site (GitHub Pages serves /docs)
  index.html, sw.js, manifest.webmanifest, icons/
  css/app.css         one stylesheet; phone first, rail + two columns from 900px
  js/app.js           screens, sync orchestration, outbox
  js/google.js        sign-in, Calendar, Drive (cached folder ids, de-duplicated lookups, serialized writes, retries)
  js/store.js         state, localStorage, merge between devices (tombstones for deletions)
  js/model.js         rota → who / where / when, swaps
  js/planner.js       free slots, rules, suggestions
  js/rota-parser.js   HABIB schedule workbook → rota (legend, merged leave spans, cyan MCI outlines)
  js/xlsx-lite.js     dependency-free .xlsx reader
  js/util.js          dates (dd/mm/yyyy), DOM helper, safe URLs
test/
  parse.test.mjs      parser against the real November files
  e2e.mjs             phone + desktop walkthrough with screenshots
  beta.mjs            simulated beta: 11 scenarios against a fake Google (fake-google.mjs)
scripts-bump.sh       bump the service-worker cache name before a release
```

Run tests: `node test/parse.test.mjs`, `node test/e2e.mjs`, `node test/beta.mjs` (test/data/ holds the rota files; not committed).
