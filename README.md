# Citrus Maxima

Personal scheduler, rota viewer and hub for your apps. A PWA, no backend: data lives in your browser and your own Google Drive.

## Put it online (GitHub Pages, same as Yuzu)

1. Create a repo `Amaerys/citrus-maxima` on GitHub.
2. Upload the whole `docs/` folder (keep the name `docs`).
3. Settings → Pages → Source: *Deploy from a branch* → branch `main`, folder `/docs` → Save.
4. Open `https://amaerys.github.io/citrus-maxima/` on your phone → browser menu → *Add to Home screen*.

## Connect Google (once)

1. Google Cloud console → your project → **Clients** → open the *Citrus Maxima / Scheduler* web client.
2. Under **Authorized JavaScript origins** add `https://amaerys.github.io` (no path). Save.
3. In the app: **More → Google** → paste the **Client ID** (the long `…apps.googleusercontent.com` string from the JSON — not the secret) → *Save ID* → *Sign in with Google*.
4. First login shows "Google hasn't verified this app" → *Advanced* → *Go to My Apps*. That's your own app in Testing mode.

## Rotas

- **Drop files**: Today or Rota screen → *Import rota files* (`.xlsx`, several at once). Works offline.
- **Automatic**: put the Excel files in Google Drive → `Citrus Maxima/Rotas/`. Each sync imports new or changed files. Any month, any mix of GP / Upper Village / FSED files.
- Pick yourself once in **More → Me** (auto-picked when a row matches "Amro").

## Other apps feeding the hub

Each app writes one small JSON file to Drive → `Citrus Maxima/Apps/<App>.status.json`:

```json
{
  "title": "Yuzu", "icon": "🍋", "color": "#f2c14e",
  "summary": "120 cards due · 14-day streak",
  "due": 120, "estimatedMinutes": 25,
  "streak": 14, "nextDue": "tonight",
  "url": "https://amaerys.github.io/Yuzu/",
  "updatedAt": "2026-11-02T12:00:00Z"
}
```

Citrus shows it on **Today** and, if a goal is named after the app (e.g. "Yuzu reviews"), the planner sizes that goal's block from `estimatedMinutes` / `due`.

## Files

```
docs/
  index.html            shell + bottom nav
  css/app.css           theme (orange signature, dark/light)
  js/app.js             screens: Today · Rota · Team · Plan · More
  js/model.js           rota → "who/where/when" answers
  js/planner.js         rules, free slots, suggestions, learning
  js/google.js          sign-in, Calendar, Drive (client ID only)
  js/rota-parser.js     HABIB schedule workbook → normalized rota
  js/xlsx-lite.js       dependency-free .xlsx reader
  js/store.js           state, localStorage, Drive sync
  sw.js, manifest.webmanifest, icons/
test/
  parse.test.mjs        parser against the real November files
  e2e.mjs               headless browser walkthrough + screenshots
```

Run tests: `node test/parse.test.mjs` and `node test/e2e.mjs`.
