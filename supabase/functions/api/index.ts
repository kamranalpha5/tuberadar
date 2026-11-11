// TubeRadar API (Supabase Edge Function). Deploy: supabase functions deploy api --no-verify-jwt
// All YouTube + Gemini calls go through here, so API keys never reach the browser and plan limits are enforced.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (msg: string, s = 400, extra: Record<string, unknown> = {}) => json({ error: msg, ...extra }, s);

// YouTube Data API: allowed endpoints and their quota cost
const YT_COST: Record<string, number> = { search: 100, videos: 1, channels: 1, playlistItems: 1, channelSections: 1 };
const DAY = () => new Date().toISOString().slice(0, 10);

let cache: { at: number; secrets: any; settings: any; plans: Record<string, any> } | null = null;
async function conf() {
  if (cache && Date.now() - cache.at < 60_000) return cache;
  const [s, ss, pl] = await Promise.all([
    db.from("app_secrets").select("*").eq("id", 1).single(),
    db.from("site_settings").select("*").eq("id", 1).single(),
    db.from("plans").select("*"),
  ]);
  const plans: Record<string, any> = {}; (pl.data || []).forEach((p: any) => (plans[p.id] = p));
  cache = { at: Date.now(), secrets: s.data || {}, settings: ss.data || {}, plans };
  return cache;
}

async function userFrom(req: Request) {
  const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) return null;
  const { data } = await db.auth.getUser(tok);
  if (!data?.user) return null;
  const { data: prof } = await db.from("profiles").select("*").eq("id", data.user.id).single();
  return prof;
}
function effectivePlan(prof: any, plans: Record<string, any>) {
  if (!prof) return plans["free"];
  if (prof.plan_id !== "free" && prof.plan_expires_at && new Date(prof.plan_expires_at) < new Date()) return plans["free"];
  return plans[prof.plan_id] || plans["free"];
}
async function charge(prof: any, plan: any, credits: number, jsonCount = 0) {
  const { data, error } = await db.rpc("use_credits", { p_user: prof.id, p_credits: credits, p_limit: plan.daily_credits, p_json: jsonCount, p_json_limit: plan.daily_json });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; credits_used: number; json_used: number };
}

async function ytFetch(key: string, path: string, params: Record<string, string>) {
  const u = new URL("https://www.googleapis.com/youtube/v3/" + path);
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "" && k !== "key") u.searchParams.set(k, String(v)); });
  const ck = path + "?" + [...u.searchParams.entries()].sort().map(([a, b]) => a + "=" + b).join("&");
  const ttl = path === "search" ? 6 * 3600e3 : 2 * 3600e3;
  const { data: hit } = await db.from("yt_cache").select("v,at").eq("k", ck).maybeSingle();
  if (hit && Date.now() - new Date(hit.at).getTime() < ttl) return { body: hit.v, cached: true };
  u.searchParams.set("key", key);
  const r = await fetch(u);
  const body = await r.json();
  if (!r.ok) throw new Error(body?.error?.message?.replace(/<[^>]+>/g, "") || "YouTube HTTP " + r.status);
  await db.from("yt_cache").upsert({ k: ck, v: body, at: new Date().toISOString() });
  return { body, cached: false };
}

async function geminiCall(secrets: any, parts: unknown[], wantJson: boolean) {
  const model = secrets.gemini_model || "gemini-3.8-flash";
  const cfg: Record<string, unknown> = { temperature: wantJson ? 0.4 : 0.8, mediaResolution: "MEDIA_RESOLUTION_LOW" };
  if (wantJson) cfg.responseMimeType = "application/json";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": secrets.gemini_key },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: cfg }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "Gemini HTTP " + r.status);
  const c = j.candidates?.[0];
  const t = (c?.content?.parts || []).map((p: any) => p.text || "").join("");
  if (!t) throw new Error("Gemini returned nothing" + (c?.finishReason ? " (" + c.finishReason + ")" : ""));
  return t;
}

// free plans see the first N channels of each list; the rest keep their numbers but lose name, picture and links
function mask(list: any[], visible: number | null) {
  if (visible === null || visible === undefined) return list;
  return list.map((c, i) => i < visible ? c : {
    locked: true, subscribers: c.subscribers, ageDays: c.ageDays, niche: c.niche, country: c.country, tier1: c.tier1,
    avp30: c.avp30, avpRatio: c.avpRatio, videos30: c.videos30, subsPerDay: c.subsPerDay,
    topVideo: c.topVideo ? { outlier: c.topVideo.outlier, views: c.topVideo.views, isShort: c.topVideo.isShort } : null,
    monet: c.monet ? { eligible: c.monet.eligible } : null,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const { secrets, settings, plans } = await conf();
    const prof = await userFrom(req);
    const plan = effectivePlan(prof, plans);
    const costs = settings.credit_costs || {};
    if (prof?.banned) return fail("Account blocked. Contact support.", 403);

    switch (body.action) {
      case "me": {
        if (!prof) return fail("login required", 401);
        const { data: u } = await db.from("usage").select("*").eq("user_id", prof.id).eq("day", DAY()).maybeSingle();
        const { data: pays } = await db.from("payments").select("id,plan_id,status,tid,created_at,note").eq("user_id", prof.id).order("created_at", { ascending: false }).limit(5);
        return json({ profile: { email: prof.email, full_name: prof.full_name, plan_id: prof.plan_id, plan_expires_at: prof.plan_expires_at, shared_group: prof.shared_group, is_admin: prof.is_admin },
          plan, usage: { credits_used: u?.credits_used || 0, json_used: u?.json_used || 0 }, costs, payments: pays || [] });
      }

      case "radar": {
        const win = ({ "24h": 1, "7d": 7, "30d": 30, "90d": 90 } as Record<string, number>)[body.window || "24h"] || 1;
        const since = new Date(Date.now() - win * 864e5).toISOString();
        const [{ data: rows }, { data: snap }] = await Promise.all([
          db.from("radar_channels").select("data,breakout_at,first_seen").gte("breakout_at", since).order("tier1", { ascending: false }).order("best_outlier", { ascending: false }).limit(500),
          db.from("radar_snapshot").select("*").eq("id", 1).single(),
        ]);
        const channels = (rows || []).map((r: any) => ({ ...r.data, breakoutAt: r.breakout_at, firstSeen: r.first_seen }));
        return json({
          generatedAt: snap?.generated_at, avpGeneratedAt: snap?.avp_generated_at, totalChannels: snap?.total_channels || 0, history: snap?.history || [],
          window: body.window || "24h", plan: { id: plan.id, radar_visible: plan.radar_visible, avp_visible: plan.avp_visible },
          channels: mask(channels, plan.radar_visible), avpChannels: mask(snap?.avp || [], plan.avp_visible),
        });
      }

      case "yt": {
        if (!prof) return fail("login required", 401);
        const path = String(body.path || "");
        if (!(path in YT_COST)) return fail("endpoint not allowed");
        if (!secrets.youtube_key) return fail("Admin ne abhi YouTube key add nahi ki.", 503);
        const credits = Math.max(1, Math.ceil(YT_COST[path] / 10) * (costs.yt_per_10_units ?? 1));
        const c = await charge(prof, plan, credits);
        if (!c.ok) return fail("Aaj ke credits khatam. Upgrade karein ya kal try karein.", 402, { limit: true });
        const r = await ytFetch(secrets.youtube_key, path, body.params || {});
        return json({ ...r.body, _credits: c.credits_used, _cached: r.cached });
      }

      case "gemini": {
        if (!prof) return fail("login required", 401);
        if (!secrets.gemini_key) return fail("Admin ne abhi Gemini key add nahi ki.", 503);
        const kind = String(body.kind || "chat");
        const vid = body.videoId ? String(body.videoId).replace(/[^\w-]/g, "") : "";
        if (kind === "transcript" && vid) {
          const { data: t } = await db.from("transcripts").select("text").eq("video_id", vid).maybeSingle();
          if (t) { const c = await charge(prof, plan, 1); if (!c.ok) return fail("Aaj ke credits khatam.", 402, { limit: true }); return json({ text: t.text, cached: true, _credits: c.credits_used }); }
        }
        const isStrategyStart = kind === "strategy" && body.start;
        let credits = Number(costs[kind] ?? 5);
        // AI calls inside an open strategy-JSON run (max 5 in 15 minutes) are included in that JSON
        if (body.jsonFlow && !isStrategyStart) {
          const { data: u } = await db.from("usage").select("json_open_until,json_calls").eq("user_id", prof.id).eq("day", DAY()).maybeSingle();
          if (u?.json_open_until && new Date(u.json_open_until) > new Date() && (u.json_calls || 0) < 5) {
            await db.from("usage").update({ json_calls: (u.json_calls || 0) + 1 }).eq("user_id", prof.id).eq("day", DAY());
            credits = 0;
          }
        }
        if (isStrategyStart) credits = Number(costs.strategy ?? 0);
        const c = await charge(prof, plan, credits, isStrategyStart ? 1 : 0);
        if (!c.ok) return fail(isStrategyStart ? "Aaj ki strategy JSON limit poori ho gayi (" + plan.daily_json + "/day)." : "Aaj ke credits khatam. Upgrade karein ya kal try karein.", 402, { limit: true });
        if (isStrategyStart) {
          await db.from("usage").update({ json_open_until: new Date(Date.now() + 15 * 60e3).toISOString(), json_calls: 0 }).eq("user_id", prof.id).eq("day", DAY());
          return json({ ok: true, _credits: c.credits_used, json_used: c.json_used });
        }
        const parts = Array.isArray(body.parts) ? body.parts.slice(0, 6) : [];
        // only public YouTube URLs are allowed as video input
        for (const p of parts) if (p?.fileData && !/^https:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]{6,}$/.test(p.fileData.fileUri || "")) return fail("only YouTube video links allowed");
        const text = await geminiCall(secrets, parts, !!body.json);
        if (kind === "transcript" && vid) await db.from("transcripts").upsert({ video_id: vid, text });
        return json({ text, _credits: c.credits_used });
      }

      case "pay": {
        if (!prof) return fail("login required", 401);
        const p = plans[body.plan_id];
        if (!p || !p.active || p.id === "free") return fail("plan not available");
        const tid = String(body.tid || "").trim();
        if (tid.length < 6) return fail("Sahi Transaction ID (TID) likhein.");
        const { data: m } = await db.from("payment_methods").select("id,title").eq("id", body.method_id).eq("active", true).maybeSingle();
        if (!m) return fail("payment method not found");
        const { data: row, error } = await db.from("payments").insert({
          user_id: prof.id, email: prof.email, plan_id: p.id, method_id: m.id, tid,
          amount_text: `$${p.price_usd} / Rs ${p.price_pkr}`, screenshot_url: body.screenshot_url || null,
          status: settings.auto_activate ? "approved" : "pending", reviewed_at: settings.auto_activate ? new Date().toISOString() : null,
        }).select().single();
        if (error) return fail(/duplicate|unique/i.test(error.message) ? "Yeh TID pehle use ho chuki hai." : error.message);
        if (settings.auto_activate) await db.rpc("activate_plan", { p_user: prof.id, p_plan: p.id });
        return json({ ok: true, status: row.status });
      }

      default: return fail("unknown action");
    }
  } catch (e) {
    return fail(String((e as Error).message || e), 500);
  }
});
