# TubeRadar (by NexGen Automation)

YouTube research tool: naye viral channels (NexLev style), competitor Map + chatbot (Makina style), plans, credits, Easypaisa/bank payments aur alag Admin panel. Sab free services par: GitHub Pages + GitHub Actions + Supabase (free) + YouTube Data API + Gemini API.

## Kya kya hai

**Website (index.html)**
- **Home:** greeting, "Your channel" box, map preview, "Breaking out right now" video cards, "Recently added outlier channels" (24h / 7d / 30d tabs), "Niches with high future competition".
- **Real Time (24h):** 1-3 mahine purane naye channels jin ki video outlier hai. Tabs: Last 24 Hours / 7 / 30 / 90 Days. 12 channels per page. Filters: age, format, max subs, min outlier, monetization (estimate), Tier-1 only. Free plan par sirf 2 channels dikhte hain, baqi blur.
- **AVP Channels (30d):** jin ki average views per video subscribers se zyada hai.
- **Map:** kisi bhi channel ka competitor map, channels ki DP ke saath. Bigger circle = zyada views (30 din), bolder line = strong link, amber badge = breakout ×. Depth 1/2, filters (subs, 30-day views, length, language, breakout), zoom/pan, Export (JSON/clipboard). Channel par click → side panel: subs, views 30d, best video, Center here, Map it, **Download JSON**, Save, Learn from it, Videos (Latest/Popular, outliers, Transcript, Rewrite) aur Connections.
- **Chat (research bot):** har page par "Ask TubeRadar". Map page par "Ask about your map". Channel chips par click → map par wahi channel.
- **Topics (AI):** competitors se seekh kar naye topics, confidence /10, projected views, PROVEN/GAP/ANGLE/RISK, titles, "Check on YouTube", "Ask for more".
- **Channel Analyzer:** saari videos, outliers, transcript, rewrite, strategy JSON.
- **Saved & Tracker:** saved channels ke 48 ghante ke views/subs, Swipe File.
- **Tools:** transcript, video analysis, original rewrite, thumbnail download.
- **Account & Settings:** email, plan, expiry, aaj ke credits/JSON, payments, logout, theme. (Koi API key yahan nahi.)
- **Policies (legal.html):** Terms, Privacy, Copyright, Refund. Text Admin panel se badal sakte hain.

**Admin panel (admin.html)**: Dashboard, Payments (approve/reject, screenshot), Users (plan dena, block, usage reset), Plans & limits, Payment methods (Easypaisa/bank QR upload), API keys (YouTube, Gemini), Website settings (naam, WhatsApp, announcement, auto-activate, credit costs, niches, collector), Policies. Yahan jo badlein woh website par foran nazar aata hai.

## Plans (default, Admin se badal sakte hain)
| Plan | Price | Credits/din | Strategy JSON/din | Viral channels |
|---|---|---|---|---|
| Free | $0 | 100 | 1 | 2 per list (baqi blur) |
| Starter (Shared) | $2 / Rs 600, 30 din | 300 har user | 5 | Sab · max 5 users per group |
| Starter (Private) | $7 / Rs 2,000 | 800 | 15 | Sab |
| Max (Private) | $10 / Rs 2,900 | 2,000 | 50 | Sab |

Credits: YouTube search = 10, ek map ≈ 70 (depth 2 ≈ 180), transcript 10, rewrite 15, video analysis 10, chat 3, topics 40. Credits roz 00:00 UTC (Pakistan subah 5 baje) reset.

## Setup (pehli dafa, ~30 minute)

### 1. Supabase (free backend)
1. **supabase.com** → New project (free). Password save kar lein.
2. **SQL Editor → New query** → `supabase/schema.sql` ka poora text paste → **Run**.
3. **Authentication → URL Configuration:** Site URL = `https://USERNAME.github.io/tuberadar/` aur yahi Redirect URLs mein bhi.
4. (Optional) **Authentication → Providers → Google** on karein agar "Continue with Google" chahiye.
5. **Edge Functions → Deploy a new function → Via Editor**. Naam: `api`. `supabase/functions/api/index.ts` ka text paste → Deploy. Function settings mein **"Verify JWT" OFF** karein (function khud login check karta hai).
6. **Project Settings → API:** Project URL aur **anon / publishable** key copy karein.

### 2. Website config
`assets/config.js` kholein aur dono values daalein:
```
SUPABASE_URL: "https://xxxx.supabase.co",
SUPABASE_ANON_KEY: "anon ya publishable key"
```
Yeh dono public hain. **service_role / secret key yahan kabhi na daalein.**

### 3. GitHub
1. Repo `tuberadar` mein saari files upload karein (`.github` folder samait).
2. **Settings → Pages:** Deploy from branch → `main` / root.
3. **Settings → Actions → General → Workflow permissions:** Read and write.
4. **Settings → Secrets and variables → Actions → New secret:**
   - `SUPABASE_URL` = project URL
   - `SUPABASE_SERVICE_KEY` = Supabase ki **service_role (secret)** key (sirf GitHub secret mein)
   - `YT_API_KEY` = optional (agar Admin panel mein collector key save hai to zaroorat nahi)

### 4. Admin bana-ein
1. Website kholein → Sign in → Create account.
2. Supabase **SQL Editor** mein chalayein:
   `update public.profiles set is_admin = true where email = 'aapki@email.com';`
3. `https://USERNAME.github.io/tuberadar/admin.html` kholein aur login karein.

### 5. Admin panel mein
1. **API keys:** YouTube Data API key (Google Cloud → YouTube Data API v3 → Credentials; API restriction: YouTube Data API v3; website restriction mat lagayein kyunke call server se jati hai) aur Gemini key (aistudio.google.com → Get API key). **Test** dabayein.
2. **Payment methods:** Easypaisa add karein: title, account name, number, QR image upload. Bank bhi add kar sakte hain.
3. **Plans & limits** aur **Website settings** (naam, WhatsApp 0340-9301597, announcement) check karein.
4. GitHub → **Actions → Collect trending data → Run workflow**. 2-5 minute baad Real Time page par channels aa jayenge.

## Payment ka tareeqa
User plan chunta hai → QR / account details dekhta hai → paise bhejta hai → TID aur screenshot submit karta hai. Admin panel → Payments → **Approve** → plan foran active. Agar **Auto-activate** on hai to TID submit hote hi plan chal padta hai, aur aap baad mein Reject karke wapas le sakte hain. Same TID dobara use nahi ho sakti. Personal Easypaisa QR se fully automatic verification mumkin nahi; uske liye Easypaisa merchant/business API chahiye.

## Collector
Har 8 ghante GitHub Actions chalta hai. Har niche Tier-1 regions (US, GB, CA, AU, rotate) mein English relevance ke saath search hota hai, Tier-1 channels upar aate hain. Har naya breakout channel database mein jama hota rehta hai, is liye 7/30/90 din ke lists waqt ke saath barhti hain. Niches aur regions Admin → Website settings se badlein.

## Quota (imandari se)
YouTube ki free limit 10,000 units/din per Google project hai. Collector ≈ 6,000-8,000/din leta hai. Website ke users ke liye **alag Google project ki key** behtar hai, aur zyada users ke liye Google se **quota extension** (free, YouTube API Services audit form) maangein. Ek hi app ke liye kai projects bana kar limit cross karna policy ke khilaf hai. Server 2-6 ghante ka cache rakhta hai, is liye same map dobara banane par YouTube units nahi lagte. Gemini free tier rozana ~8 ghante YouTube video dekh sakta hai; zyada users ke liye Gemini paid tier lena hoga.

## Limits (imandari se)
- **Map ek andaza hai.** YouTube API "related videos" nahi deti. Map search results mein ek saath aane wale channels se banta hai, Makina ke "Up next" scraping se nahi.
- **Monetization aur watch hours andaza hain.** API asli watch hours ya AdSense status nahi deti.
- **Transcript/Rewrite:** transcript sirf research ke liye. Rewrite bilkul naya script likhta hai, sirf strategy wahi. Doosre creator ka content dobara upload na karein.
- Saved channels, Swipe File aur map is browser mein save hote hain.

## Files
- `index.html`, `app.js`, `pro.js`: website
- `admin.html`, `admin.js`: admin panel
- `legal.html`: policies
- `assets/config.js`, `assets/backend.js`: Supabase connection
- `supabase/schema.sql`: database, plans, security rules
- `supabase/functions/api/index.ts`: server (YouTube + Gemini proxy, credits, blur, payments)
- `scripts/collect.mjs`, `scripts/lib.mjs`, `config/keywords.json`, `.github/workflows/collect.yml`: collector
- `data/trending.json`: demo data (Supabase lagne ke baad sirf ek chhota stub)
