# My Apps hub — the shared Drive contract

Every app (Citrus Maxima, Yuzu, Mephisto, Orange, Sinus, Kumquat, Embergine, and any new one) follows this.
One Google Cloud OAuth client for all of them: `753489712404-ra7ahu34gjl305b4ss1765idmqg7am5s.apps.googleusercontent.com`
(add each app's `https://<org>.github.io` origin to it).

## Folder layout

```
My Apps/                      ← the only root. Never create "Citrus Maxima/", "Apps/" or app folders at Drive root.
├── Rotas/                    ← monthly rota spreadsheets, named "YYYY-MM Unit.xlsx" (GP rota, FSED, Upper Village)
├── <App>/                    ← an app's own large data (e.g. Yuzu/collection, Yuzu/media). The app owns and repairs it;
│                               Citrus only lists it. Small, shared things still go in hub/.
└── hub/
    ├── citrus/
    │   ├── state.json        ← Citrus's own synced state (rotas, plan, swaps, goals, notes)
    │   ├── plan.json         ← what Citrus planned for the next 10 days, per app (apps READ this)
    │   └── backups/          ← state-YYYY-MM-DD.json, one per day, newest 14 kept
    ├── <app>/                ← lowercase app id: yuzu, mephisto, orange, sinus, kumquat, embergine
    │   ├── status.json       ← the app's summary (Citrus READS this) — exactly one file with this name
    │   ├── state.json        ← optional: the app's own backup (single file)
    │   └── data/             ← optional: the app's own backup (several files)
```

## Rules that prevent duplicates

1. **Find before create.** Look up a folder/file by name + parent before creating it. Cache the id; if a request with a cached id returns 404, drop the cache and look up again.
2. **One lookup per path at a time.** If two parts of the app need `My Apps/hub/x` at the same moment, they must share one in-flight lookup — otherwise both create it.
3. **Update in place.** Write `status.json` / `state.json` by PATCHing the existing file id. Never POST a new file when one with that name exists.
4. **Serialize writes to the same file.** Queue them; don't fire two uploads of the same file in parallel.
5. **Download contents as bytes.** Drive returns `.json` files with a JSON content type; read the body yourself (`arrayBuffer`/`json`) rather than relying on a helper that guesses.
6. **A lost answer is not a failure to create.** If a create (POST) drops its connection, look the file up before sending it again — it may already exist.
7. **Newest wins, the rest go to the trash.** If twins exist anyway, read the newest by `modifiedTime` and trash the others (folders: keep the oldest, move the twins' contents into it).
8. **Fingerprint what you write.** Put a content hash in `appProperties.h`. Skip uploads whose hash hasn't changed; other apps can tell what changed from the changes feed without downloading.
9. **Check before overwriting shared state.** Store a revision in `appProperties.rev`; before writing, compare it with the one you read. If it moved, pull, merge, then write.
10. **Ask Drive what changed.** Use `changes/startPageToken` + `changes?pageToken=` (one request when nothing moved) instead of re-listing folders on every sync. Do a full pass every ~12 h anyway.
11. **Retry only what's safe.** GET/PATCH/DELETE retry on dropped connections; 429, 5xx and rate-limit 403s retry with jittered backoff; offline fails fast.
12. **Token renewal needs a tap on phones.** Renew the one-hour token (`prompt: ''`) from a tap, never from a timer.

All apps use the same client with the full `drive` scope (plus `calendar` where needed), so any app can tidy files another app created.

## status.json

```json
{
  "app": "yuzu",                         // lowercase id, same as the folder
  "title": "Yuzu", "icon": "🍋", "color": "#f2d34b",
  "url": "https://yuzu-cards.github.io/Yuzu/",
  "updatedAt": "2026-11-05T08:00:00Z",   // ISO time of this snapshot
  "summary": "132 cards due · 9-day streak",   // one line, plain text (no HTML)
  "today": { "date": "2026-11-05", "done": false },
  "next": { "title": "Review 132 cards", "minutes": 30 },
  "asks": [                              // time the app wants; Citrus places these around shifts
    { "date": "2026-11-05", "title": "Yuzu: reviews", "minutes": 30, "slot": "free" }   // slot: "free" | "before" (before a day shift)
  ],
  "pending": ["132 cards due"],          // short strings shown under "Waiting on you"
  "extra": { "streak": 9 }               // anything app-specific
}
```

Citrus treats every field as untrusted: strings are shown as text, only `http(s)` URLs become links, malformed fields are ignored.
Problems it found are listed in Citrus › Apps › "sending something Citrus can't fully read", and Settings › Receive tester checks a pasted file.

### Contract v2 — what apps can ALSO send (all optional; caps in brackets)

```json
{
  "today": { "date": "2026-11-07", "done": true },          // lets a habit linked to your app tick itself ("done today")
  "metrics": [                                              // [12] numbers Citrus keeps as history (sparklines, habits, objectives)
    { "key": "cards-due", "label": "Cards due", "value": 132, "goal": 0, "unit": "cards", "date": "2026-11-07" }
  ],
  "progress": [                                             // [12] 0–100 % that an objective can read live
    { "key": "step1-deck", "label": "Step 1 deck", "pct": 35, "date": "2026-11-07" }
  ],
  "inbox": [                                                // [25] proposals; the user taps Take or dismiss — never auto-added
    { "id": "stable-unique-id", "type": "task", "title": "Fix 3 leech cards", "date": "2026-11-08", "minutes": 10, "pri": 1, "url": "https://…", "expires": "2026-11-10" }
  ]
}
```
- `type`: `task` (becomes a task that remembers who sent it), `note` (joins that day's notes), `event` (needs `date` + `start`/`end` in minutes; added to the calendar).
- `id` must be stable: sending the same id again never duplicates. Citrus tells you what happened in `plan.json › mind.receipts`.
- A habit in Citrus can be linked to `yuzu` (your `today.done`) or to `yuzu:cards-due` (that metric reaching its goal). An objective can read a `progress` series.
- Phone Share menu and links: `…/Citrus/?from=<app>#capture=Buy%20milk` opens a confirm sheet (no data is written without a tap).

## plan.json (written by Citrus)

```json
{ "app": "citrus", "updatedAt": "…", "from": "2026-11-05",
  "days": { "2026-11-05": { "shift": { "code": "D2", "label": "Day · Lower Village", "start": "08:00", "end": "20:00", "overnight": false, "mci": true },
                             "blocks": [ { "app": "yuzu", "title": "Yuzu: reviews", "start": "21:30", "end": "22:00", "minutes": 30, "status": "accepted" } ] } },
  "blocks": [ …same blocks, flat… ] }
```

Citrus also writes `contract: 2` and `mind`:
```json
"mind": { "score": 62, "tasks": { "overdue": 1, "today": 3, "top": [ { "title": "…", "due": "2026-11-07", "pri": 1 } ] },
          "habits": { "due": 5, "done": 2, "pending": ["Gym"] }, "streaks": [ { "name": "Yuzu reviews", "days": 9 } ],
          "reflectedToday": false, "receipts": [ { "app": "yuzu", "id": "stable-unique-id", "status": "accepted|done|dismissed" } ] }
```
Blocks for Citrus's own tasks/habits have `app: "citrus"`.

Apps pick out their own blocks with `blocks.filter(b => b.app === "<id>")`. `status` is `accepted` (on the calendar) or `suggested`.
