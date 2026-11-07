# Citrus Maxima — debug, houseclean & simulated beta (05/11/2026)

## How it was tested

- **Independent code audit** by a separate reviewer with no knowledge of my assumptions: 20 issues, verified against the code before fixing.
- **Simulated beta**: 11 scripted sessions in real Chromium on phone (390 px and 320 px) and desktop (1366 px), against an in-memory fake Google (Drive, Calendar and sign-in) seeded with the real November rotas and the app statuses. The fake also injects server errors, expired sessions and offline periods.
- **Real Drive** inspected and cleaned through the Drive connector.

| Scenario | Result |
|---|---|
| First run, nothing set up | Each screen explains the next step |
| Signed-in first sync from Drive | 3 rotas, you auto-picked, calendar, apps, plan.json written — 20 API calls |
| Accept / move / skip / reload | Calendar event created, moved, persisted |
| Offline accept, back online | Queued, then sent once on reconnect |
| Server 500s, 401, expired session | Absorbed by retries; silent renewal; "Sign in" banner when renewal fails |
| Swap 21/11 with Hibat | Your day off, Hibat on D1, stable across re-renders |
| Second device (desktop) | Sees accepted blocks, swaps, "me"; deleting a swap on one removes it on the other |
| Night 17/11, post-night 18/11, 01/12 with no December rota | Nothing planned in the pre-night evening or before 15:00 after a night; the night ending on the 1st is still shown |
| 320 px phone, light theme, keyboard, accessibility | Fits, all controls named, `1–5`, `/21/11` + Enter |
| Corrupt storage, bad file, speed | Starts anyway; clear rejection; renders take 3–16 ms |
| Import on the phone, then sync to Drive | Uploaded as `2026-11 GP rota.xlsx`; re-importing does not duplicate |

**Final run: 0 findings.**

## What was broken (now fixed)

**Serious**
1. **Drive JSON was never read back.** Google serves `.json` with a JSON content type and the download helper turned it into an object, so `status.json` and `state.json` silently read as empty. Cross-device sync and the app tiles never really worked; writes did, so Drive looked fine.
2. **Duplicate Drive folders.** Parallel sync steps each created `My Apps`/`Citrus Maxima` (two folders 0.1 s apart). Lookups are now shared per path and writes per file are queued.
3. **Two specs for one hub.** Orange 8.5.2 followed the old `Citrus Maxima/Apps` layout while everything else used `My Apps/hub`. Orange is patched to 8.5.3 and HUB.md is now the single spec, in the repo, in Drive and in this project.
4. **Swaps were inverted.** The colleague kept their own shift, so both of you showed the same code.
5. **Sleep window bug.** Before a shift starting after about 09:00, the whole previous day was marked as sleep.
6. **320 px phones.** The header and the 7-column grids forced the page wider, so the phone zoomed out and the tab bar fell off-screen.
7. **Colours never applied.** CSS variables passed as styles were dropped, so goal colours, app tiles and the night tint were missing.

**Robustness**
- Deletions came back after a merge; they're now recorded as tombstones.
- The outbox could be wiped by a merge.
- Local bookkeeping made one device look "newer" than the other.
- Two syncs could run at once.
- A lost POST could be retried and create a duplicate event.
- "Not found" was matched on message text instead of the status code.
- An unknown `#hash` blanked the app.
- The service worker cached error pages.
- An app could put a `javascript:` URL in its status, and a malformed status crashed screens. Statuses are now treated as untrusted.

**Planner**: limits now apply after boosts, so a post-night day can't get a 90-minute block. Skipped asks aren't re-offered in the same slot, done blocks count as busy, deadlines use local time, and "Accept all" asks first.

**Houseclean**: removed dead code and CSS, stale copy ("More", old folder names), the duplicate `fmtMin`, and an empty `vendor/xlsx.full.min.js` that was actually a GitHub error page deployed publicly. README rewritten.

## Drive, before → after

Before: `My Apps/` and **two** `Citrus Maxima/` folders. Orange's backup and status sat in `Citrus Maxima`, there was an old Kumquat copy, Embergine had a duplicate `status.json`, and both `Citrus Maxima/Rotas` folders were empty.

After:
```
My Apps/  (starred, orange)          HUB.md — the contract
├── Rotas/        2026-11 FSED.xlsx · 2026-11 Upper Village.xlsx   (+ GP rota on next import)
└── hub/
    ├── citrus/     state.json · plan.json
    ├── mephisto/   status.json · state.json
    ├── orange/     status.json · data/ (lifts, sessions, routines, entries, manifest)
    ├── sinus/      status.json
    ├── kumquat/    status.json · state.json
    └── embergine/  status.json · state.json
```
Files were **moved**, not copied, so every ID the apps cached still works. Removed items are in Drive's trash for 30 days. Each folder has a colour and a one-line description.

## Honest feedback on the app

**Strong**
- Rota parsing is the best part: legend-driven, handles merged leave spans, and reads the cyan MCI outline straight from cell styles. It survives a new code appearing.
- Day dial + week strip answer "what's my day / week" at a glance; the desktop layout uses the space well.
- Offline-first with an outbox, and you own all the data.
- The hub idea (status in, plan out) scales to any new app with one small file.

**Weak / risks**
1. **Not yet proven against your real Google account.** The fake covers the API contract, not every Google quirk. Watch Settings › Diagnostics for the first week.
2. **The planner is too eager.** About 30 suggestions over 10 days is a wall. I'd show 3 days by default, with a weekly "plan my week" moment.
3. **It's not an assistant until it can reach you.** A PWA can't wake itself, so there's no morning brief or "leave in 20 min" nudge. This is the biggest gap. Fix: a tiny scheduled job that pushes the brief (GitHub Action + ntfy, or email).
4. **The hub is only as fresh as the apps you open.** Yuzu has never signed in (no `hub/yuzu` yet); a status goes grey after 36 h.
5. **Orange was patched in its built files.** If Orange is rebuilt from its source in another session, it may revert to the old folders. Point that session at HUB.md.
6. **Embergine's own writer created a duplicate `status.json`** (same race as Citrus had). Its repo needs the HUB.md rules 2–4.
7. **Swaps cover one-for-one exchanges.** Chains (A covers B, who covers you) and partial shifts aren't modelled.
8. **"Me" is guessed by matching "Amro"** — fine for you, not for anyone else.

## Suggested next steps (in order)

1. Morning brief push (scheduled job → phone notification).
2. Planner horizon of 3 days by default, plus a weekly planning ritual.
3. Sign Yuzu into the hub; apply HUB.md rules in Embergine and Kumquat.
4. Monthly rota reminder: when the next month's files aren't in `Rotas/` by the 25th, say so.
