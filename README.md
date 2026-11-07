# Citrus Maxima

Shift rota, planner and hub for all my apps. A PWA with no backend: data lives in the browser and in my own Google Drive (`My Apps/`).

Live: https://amaerys.github.io/Citrus-Maxima/

## What it does

- **Today** — your shift with a 24-hour day dial, the next 7 days, who's on with you, FSED / Upper Village specialists, MCI 2nd-physician days, Google Calendar, today's plan, your apps, a shareable brief, notes.
- **Rota** — the month grid (cyan ring = MCI 2nd physician, purple dot = your correction), day sheets with full coverage, "who could cover?", and **Correct this day** for swaps.
- **Team** — everyone across the rotas, call / WhatsApp, shifts you share.
- **Plan** — weekly goals, your rules (sleep, commute, buffers, protected time), suggestions placed around shifts and nights; apps' own requests come first. Accepted blocks go to Google Calendar.
- **Mind** — the brain of the app. A living tree of eight life areas (each pulses when active today) around a brain score; segments: *Overview* (capture bar that understands "call bank tomorrow 20m !", focus, balance radar, 8-week trend, insights, proposals from your apps), *Tasks*, *Habits* (daily / certain days / X per week, streaks, 16-week heat, auto-counting from Yuzu/Orange/… ), *Aims* (milestones; progress can follow a live number from an app), *Reflect* (evening check-in, gratitude, stoic review, weekly review, start/stop/continue, wheel of life, pre-mortem, free write, mood & energy, a 4-in/6-out breathing exercise), *Year* (resolutions with a theme, quarterly check-ins, year in review), *Library* (anime, shows, movies, books, games: shelf with 1–10 ratings and progress, yearly goals, Discover = suggestions from AniList recommendations and Open Library based on what you rated 8+, Connect = AniList username, Goodreads/IMDb export files, Steam paste) and *Notes* (tagged, pinned, searchable; journaling lives in Reflect). Tasks and habits with a time estimate are placed in your plan around shifts; finishing the block finishes the task.
- **Apps** — a launcher for Yuzu, Mephisto, Orange, Sinus, Kumquat, Embergine with what each needs today.
- **Settings** — Google, calendars, "me", diagnostics, backup / restore, theme.

Morning brief: a daily scheduled task (05:47, Asia/Riyadh) reads `hub/citrus/plan.json`, the app statuses and your calendar from Drive and pushes a short brief to the phone.
Plan tab shows 3 days by default ("Plan my week" = 7, or 10); plan.json always covers 10 days for the other apps. From the 22nd Citrus reminds you if next month's rota isn't loaded.

Alarms: tasks and habits can carry an alarm; Citrus creates Google Calendar pop-up reminders (also before accepted plan blocks and, optionally, shifts) so the phone's Calendar app rings even when Citrus is closed. Jumping between apps: apps declare `actions` (deep links) and Citrus opens them with `?from=citrus&do=<id>`; search finds them (“yuzu reviews”).

Receiving: apps can also send metrics, progress and an inbox of proposals (HUB.md, contract v2); the phone's Share menu and `#capture=` links create tasks after a confirm tap. Settings › Receive tester checks a pasted status file.

Keyboard on desktop: `1–6` tabs, `/` search, `r` sync, `,` settings, `Esc` close.

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
  js/google.js        sign-in (tap-to-renew), Calendar, Drive: changes feed, fingerprinted writes, revision-checked
                      state, lost-answer recovery, twin healing, daily backups, Check Drive (scan & repair)
  js/mind.js          tasks, habits, objectives, reflections, resolutions, inbox: pure rules and numbers
  js/mind-ui.js       Mind screens, sheets, Today card;  js/mind-viz.js SVG tree, rings, heat, radar
  js/media.js, js/media-ui.js  Library (imports, suggestions) and Notes
  js/inbound.js       status.json contract v2 validator
  js/store.js         state, localStorage, merge between devices (tombstones for deletions)
  js/model.js         rota → who / where / when, swaps
  js/planner.js       free slots, rules, suggestions
  js/rota-parser.js   HABIB schedule workbook → rota (legend, merged leave spans, cyan MCI outlines)
  js/xlsx-lite.js     dependency-free .xlsx reader
  js/util.js          dates (dd/mm/yyyy), DOM helper, safe URLs
test/
  parse.test.mjs      parser against the real November files
  drive.mjs           Drive hardening: changes feed, two-device conflicts, lost answers, twins, deleted folders, backups
  e2e.mjs             phone + desktop walkthrough with screenshots
  beta.mjs            simulated beta: 11 scenarios against a fake Google (fake-google.mjs)
scripts-bump.sh       bump the service-worker cache name before a release
```

Run tests: `node test/parse.test.mjs`, `node test/e2e.mjs`, `node test/beta.mjs`, `node test/drive.mjs` (test/data/ holds the rota files; not committed).
