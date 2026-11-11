# TubeRadar — YouTube Viral Radar (100% free)

Pichle 24–48 ghante mein viral hone wale **naye / chhote channels** dhoondta hai (NexLev style) aur kisi bhi channel ka **competitor map** banata hai (Makina style).

## Features
| Screen | Kya karta hai | Data |
|---|---|---|
| **Viral Radar** | Breakout channels + trending videos, filters (window, Shorts/Long, max subs, min outlier, sirf naye channels) | `data/trending.json` (GitHub collector) ya "Scan now" |
| **Live Search** | Kisi bhi niche keyword ke last 24h/48h/7d videos, views/hour aur outlier ke saath | YouTube API (browser se) |
| **Channel Analyzer** | Channel URL/@handle → median views, last 15 videos ka chart, top outliers | YouTube API |
| **Competitor Map** | Channel ke best videos ke topics par search karke mil-ne wale channels ka graph, closeness %, breakout rings, breakout titles | YouTube API |
| **Settings** | API key (sirf aapke browser mein), niches | localStorage |

## Scoring (formulas)
- **Views/hour** = views ÷ ghante since publish
- **Outlier** = video views ÷ channel ki recent 15 videos ka **median** views
- **New channel** = channel age ≤ 180 din
- **Radar score (0–100)** = log10(views/hour) × 15 + outlier (max 50) × 0.8 + 12 agar naya channel

## Setup (15 minute, sab free)

### 1. YouTube API key
1. https://console.cloud.google.com → New project
2. "APIs & Services" → Library → **YouTube Data API v3** → Enable
3. Credentials → Create credentials → **API key**
4. Do keys banayein (dono free, same project):
   - **Key A (GitHub collector ke liye):** API restrictions → sirf YouTube Data API v3. Website restriction NA lagayein (server se chalti hai).
   - **Key B (website ke liye):** API restrictions → YouTube Data API v3, aur Website restrictions → `https://USERNAME.github.io/*`.

Free quota: **10,000 units/day**. Ek search = 100 units, baqi calls ~1 unit.

### 2. GitHub par daalein
1. Naya **public** repo banayein (jaise `tuberadar`) aur is zip ki saari files upload/push karein (`.github` folder bhi).
2. Repo → Settings → **Secrets and variables → Actions** → New secret: name `YT_API_KEY`, value = **Key A**.
3. Repo → **Actions** tab → "Collect trending data" → **Run workflow** (pehli dafa manually). Is ke baad har 6 ghante khud chalega aur `data/trending.json` update karega.
4. Repo → Settings → **Pages** → Source: "Deploy from a branch" → `main` / root → Save. 1–2 minute mein site `https://USERNAME.github.io/tuberadar/` par live.

### 3. Website par
Settings → **Key B** paste → **Save** (key test hoti hai). Ab Live Search, Analyzer aur Map chalenge.

### Local chalana
`fetch` ke liye server chahiye (file:// par kaam nahi karega):
```bash
npx serve .        # ya: python3 -m http.server 8080
```
Collector local: `YT_API_KEY=AIza... node scripts/collect.mjs` (Node 20+).

## Niches badalna
`config/keywords.json` mein `keywords` edit karein. Settings screen ka "Copy as keywords.json" button list copy kar deta hai.
Quota hisaab: har run ≈ keywords × 100 + ~150 units. 18 keywords × 4 runs/day ≈ 7,800 units — 10k ke andar.
Zyada niches chahiye? cron ko `0 */12 * * *` kar dein ya doosri key/project use karein.

## Files
```
index.html            UI (light theme)
app.js                Saari front-end logic
assets/               Base CSS/JS
data/trending.json    Collector output (pehle demo data hai)
scripts/collect.mjs   Collector (Node 20, koi dependency nahi)
scripts/lib.mjs       YouTube API helpers
config/keywords.json  Niches + thresholds
.github/workflows/collect.yml   Har 6 ghante free cron
```

## Limits (imandari se)
- YouTube API ab "related / Up Next videos" nahi deti, is liye Competitor Map search-overlap se banta hai (Makina asal recommendations scrape karta hai). Natija kaafi qareeb hota hai lekin bilkul same nahi.
- Browser wali key public site mein aapke browser ke andar rehti hai, kisi server par nahi jaati. Key ko apne domain tak restrict zaroor karein.
- Hidden subscriber count wale channels "hidden" dikhte hain.
