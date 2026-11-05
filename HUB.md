# My Apps hub — the shared Drive contract

Every app (Citrus Maxima, Yuzu, Mephisto, Orange, Sinus, Kumquat, Embergine, and any new one) follows this.
One Google Cloud OAuth client for all of them: `753489712404-ra7ahu34gjl305b4ss1765idmqg7am5s.apps.googleusercontent.com`
(add each app's `https://<org>.github.io` origin to it).

## Folder layout

```
My Apps/                      ← the only root. Never create "Citrus Maxima/", "Apps/" or app folders at Drive root.
├── Rotas/                    ← monthly rota spreadsheets, named "YYYY-MM Unit.xlsx" (GP rota, FSED, Upper Village)
└── hub/
    ├── citrus/
    │   ├── state.json        ← Citrus's own synced state (rotas, plan, swaps, goals)
    │   └── plan.json         ← what Citrus planned for the next 10 days, per app (apps READ this)
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

## plan.json (written by Citrus)

```json
{ "app": "citrus", "updatedAt": "…", "from": "2026-11-05",
  "days": { "2026-11-05": { "shift": { "code": "D2", "label": "Day · Lower Village", "start": "08:00", "end": "20:00", "overnight": false, "mci": true },
                             "blocks": [ { "app": "yuzu", "title": "Yuzu: reviews", "start": "21:30", "end": "22:00", "minutes": 30, "status": "accepted" } ] } },
  "blocks": [ …same blocks, flat… ] }
```

Apps pick out their own blocks with `blocks.filter(b => b.app === "<id>")`. `status` is `accepted` (on the calendar) or `suggested`.
