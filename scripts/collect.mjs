// TubeRadar collector. Writes data/trending.json with two lists:
//  1) breakoutChannels: NEW channels (<= newChannelMaxAgeDays) whose video from the last 24h is an outlier,
//     with an estimate of monetization (YPP) eligibility.
//  2) avpChannels (refreshed about once a day): channels whose average views per video over the last
//     30 days is higher than their subscriber count (e.g. 1.5K subs, 2K+ AVP).
// Run: YT_API_KEY=xxx node scripts/collect.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { YouTube, hoursSince, daysSince, parseDuration, profileChannel } from './lib.mjs';

const cfg = JSON.parse(await readFile(new URL('../config/keywords.json', import.meta.url), 'utf8'));

// ---- Supabase (optional but recommended): settings + keys come from the Admin panel, results go to the database ----
const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sb = SB_URL && SB_KEY ? async (path, opt = {}) => {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...opt, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal', ...(opt.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.json().catch(() => null);
} : null;
let secrets = {};
if (sb) {
  const [ss] = await sb('site_settings?id=eq.1&select=niches,collector');
  [secrets] = await sb('app_secrets?id=eq.1&select=youtube_key,youtube_collector_key');
  if (ss?.niches?.length) cfg.keywords = ss.niches;
  const c = ss?.collector || {};
  if (c.regions?.length) cfg.regions = c.regions;
  if (c.relevanceLanguage !== undefined) cfg.relevanceLanguage = c.relevanceLanguage;
  for (const k of ['minViews', 'minOutlier', 'newChannelMaxAgeDays', 'maxProfilesPerRun']) if (c[k]) cfg[k] = c[k];
  console.log(`Settings from Supabase: ${cfg.keywords.length} niches, regions ${cfg.regions?.join(',')}`);
}
const yt = new YouTube(process.env.YT_API_KEY || secrets?.youtube_collector_key || secrets?.youtube_key);
const now = Date.now();
// Tier-1 focus: every keyword is searched in one Tier-1 region (rotating each run) with English relevance.
const TIER1 = new Set(cfg.tier1Countries || ['US', 'GB', 'CA', 'AU', 'NZ', 'IE', 'DE', 'NL', 'SE', 'NO', 'DK', 'CH', 'AT', 'BE', 'FI', 'LU', 'SG', 'AE']);
const regions = cfg.regions?.length ? cfg.regions : (cfg.regionCode ? [cfg.regionCode] : []);
const runSlot = Math.floor(now / (8 * 36e5));
const regionFor = (i) => {
  const r = regions.length ? { regionCode: regions[(i + runSlot) % regions.length] } : {};
  if (cfg.relevanceLanguage) r.relevanceLanguage = cfg.relevanceLanguage;
  return r;
};

let prev = null;
if (sb) {
  const [snap] = await sb('radar_snapshot?id=eq.1&select=avp,avp_generated_at,history');
  if (snap) prev = { avpChannels: snap.avp || [], avpGeneratedAt: snap.avp_generated_at, history: snap.history || [] };
} else {
  try { prev = JSON.parse(await readFile(new URL('../data/trending.json', import.meta.url), 'utf8')); } catch { /* first run */ }
  if (prev?.demo) prev = null;
}

async function discover(hours) {
  const after = new Date(now - hours * 36e5).toISOString();
  const nicheOf = new Map();
  for (const [i, kw] of cfg.keywords.entries()) {
    try {
      const ids = await yt.searchRecent(kw, after, regionFor(i));
      ids.forEach((id) => { if (!nicheOf.has(id)) nicheOf.set(id, kw); });
      console.log(`  [${hours}h] "${kw}": ${ids.length} videos`);
    } catch (e) {
      console.warn(`  "${kw}" failed: ${e.message}`);
      if (/quota/i.test(e.message)) break;
    }
  }
  const videos = await yt.videos([...nicheOf.keys()]);
  const channels = await yt.channels(videos.map((v) => v.snippet.channelId));
  return { nicheOf, videos, chMap: new Map(channels.map((c) => [c.id, c])) };
}

function chInfo(c, id, title) {
  const subs = Number(c?.statistics?.subscriberCount || 0);
  return {
    id, title: c?.snippet?.title || title,
    thumbnail: c?.snippet?.thumbnails?.default?.url,
    subscribers: subs,
    hiddenSubs: !!c?.statistics?.hiddenSubscriberCount,
    videoCount: Number(c?.statistics?.videoCount || 0),
    totalViews: Number(c?.statistics?.viewCount || 0),
    createdAt: c?.snippet?.publishedAt,
    ageDays: c?.snippet?.publishedAt ? daysSince(c.snippet.publishedAt, now) : null,
    country: c?.snippet?.country || null,
    tier1: TIER1.has(c?.snippet?.country || ''),
    subsPerDay: c?.snippet?.publishedAt ? Math.round(subs / Math.max(daysSince(c.snippet.publishedAt, now), 1)) : null,
  };
}

/* ---------- 1) Last 24h: new channels with outlier videos ---------- */
console.log(`24h scan: ${cfg.keywords.length} keywords`);
const d24 = await discover(cfg.windowHours);

// profile only NEW channels (cheap: 2-4 units each), best candidates first
const cand = new Map();
for (const v of d24.videos) {
  const c = d24.chMap.get(v.snippet.channelId);
  const age = c?.snippet?.publishedAt ? daysSince(c.snippet.publishedAt, now) : 9999;
  const views = Number(v.statistics.viewCount || 0);
  if (age > cfg.newChannelMaxAgeDays || views < cfg.minViews) continue;
  cand.set(c.id, Math.max(cand.get(c.id) || 0, views / hoursSince(v.snippet.publishedAt, now)));
}
const profiles = new Map();
for (const id of [...cand.entries()].sort((a, b) => b[1] - a[1]).slice(0, cfg.maxProfilesPerRun).map((x) => x[0])) {
  try { profiles.set(id, await profileChannel(yt, d24.chMap.get(id), cfg, now)); } catch { /* skip */ }
}

const rows = d24.videos.map((v) => {
  const c = d24.chMap.get(v.snippet.channelId);
  const p = profiles.get(v.snippet.channelId);
  const views = Number(v.statistics.viewCount || 0);
  const subs = Number(c?.statistics?.subscriberCount || 0);
  const duration = parseDuration(v.contentDetails?.duration);
  return {
    id: v.id,
    title: v.snippet.title,
    thumbnail: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url,
    publishedAt: v.snippet.publishedAt,
    niche: d24.nicheOf.get(v.id),
    views,
    likes: Number(v.statistics.likeCount || 0),
    comments: Number(v.statistics.commentCount || 0),
    viewsPerHour: Math.round(views / hoursSince(v.snippet.publishedAt, now)),
    durationSec: duration,
    isShort: duration > 0 && duration <= 180,
    outlier: p?.median > 0 ? +(views / p.median).toFixed(2) : null,
    viewsPerSub: subs > 0 ? +(views / subs).toFixed(2) : null,
    channel: { ...chInfo(c, v.snippet.channelId, v.snippet.channelTitle), medianViews: Math.round(p?.median || 0), monet: p?.monet || null, avp30: p?.avp30 ?? null },
  };
}).filter((r) => r.views >= cfg.minViews).sort((a, b) => b.viewsPerHour - a.viewsPerHour);

const byChannel = new Map();
for (const r of rows) {
  const ch = r.channel;
  if (ch.ageDays === null || ch.ageDays > cfg.newChannelMaxAgeDays) continue;
  if ((r.outlier ?? 0) < cfg.minOutlier) continue;
  const prevBest = byChannel.get(ch.id);
  if (!prevBest || r.outlier > prevBest.topVideo.outlier) {
    byChannel.set(ch.id, { ...ch, niche: r.niche, topVideo: { id: r.id, title: r.title, thumbnail: r.thumbnail, views: r.views, viewsPerHour: r.viewsPerHour, outlier: r.outlier, isShort: r.isShort, durationSec: r.durationSec, publishedAt: r.publishedAt } });
  }
}
// Tier-1 channels first (country set on the channel), then by outlier
const breakoutChannels = [...byChannel.values()].sort((a, b) => (b.tier1 - a.tier1) || (b.topVideo.outlier - a.topVideo.outlier));

/* ---------- 2) Last 30 days: AVP higher than subscribers (about once a day) ---------- */
let avpChannels = prev?.avpChannels || [];
let avpGeneratedAt = prev?.avpGeneratedAt || null;
const avpDue = !avpGeneratedAt || (now - new Date(avpGeneratedAt).getTime()) / 36e5 >= cfg.avp.everyHours || process.env.FORCE_AVP;
if (avpDue) {
  console.log(`30-day AVP scan`);
  const d30 = await discover(cfg.avp.days * 24);
  const best = new Map(); // channel -> its best video in the window
  for (const v of d30.videos) {
    const c = d30.chMap.get(v.snippet.channelId);
    if (!c || c.statistics?.hiddenSubscriberCount) continue;
    const subs = Number(c.statistics?.subscriberCount || 0);
    const views = Number(v.statistics.viewCount || 0);
    if (subs > cfg.avp.maxSubs || views < cfg.avp.minAvp || views < subs * cfg.avp.minRatio) continue;
    const b = best.get(c.id);
    if (!b || views > b.views) best.set(c.id, { v, views, ratio: views / Math.max(subs, 1), niche: d30.nicheOf.get(v.id) });
  }
  const picks = [...best.entries()].sort((a, b) => b[1].ratio - a[1].ratio).slice(0, cfg.avp.maxProfiles);
  const out = [];
  for (const [id, b] of picks) {
    const c = d30.chMap.get(id);
    let p;
    try { p = await profileChannel(yt, c, cfg, now, 1); } catch { continue; }
    if (!p) continue;
    const info = chInfo(c, id);
    if (p.videos30 < cfg.avp.minVideos || p.avp30 < cfg.avp.minAvp || p.avp30 < info.subscribers * cfg.avp.minRatio) continue;
    out.push({
      ...info, niche: b.niche, avp30: p.avp30, videos30: p.videos30,
      avpRatio: +(p.avp30 / Math.max(info.subscribers, 1)).toFixed(2),
      monet: p.monet, partial: p.partial,
      topVideo: { id: b.v.id, title: b.v.snippet.title, thumbnail: b.v.snippet.thumbnails?.medium?.url || b.v.snippet.thumbnails?.default?.url, views: b.views, isShort: parseDuration(b.v.contentDetails?.duration) <= 180 },
    });
  }
  avpChannels = out.sort((a, b) => (b.tier1 - a.tier1) || (b.avpRatio - a.avpRatio));
  avpGeneratedAt = new Date(now).toISOString();
}

/* ---------- write ---------- */
let history = Array.isArray(prev?.history) ? prev.history : [];
history.push({
  at: new Date(now).toISOString(),
  breakout: breakoutChannels.length,
  monetized: breakoutChannels.filter((c) => c.monet?.eligible).length,
  topVph: rows.reduce((m, r) => Math.max(m, r.viewsPerHour), 0),
  avp: avpChannels.length,
  niches: cfg.keywords.length,
});
history = history.slice(-12);

const out = {
  generatedAt: new Date(now).toISOString(),
  windowHours: cfg.windowHours,
  newChannelMaxAgeDays: cfg.newChannelMaxAgeDays,
  minOutlier: cfg.minOutlier,
  avpDays: cfg.avp.days,
  avpGeneratedAt,
  keywords: cfg.keywords,
  quotaUnitsUsed: yt.units,
  history,
  breakoutChannels,
  avpChannels,
  videos: rows.slice(0, cfg.maxVideos),
};
if (sb) {
  // accumulate: every breakout channel is kept, so the site can show 24h / 7d / 30d / 90d lists
  const nowIso = new Date(now).toISOString();
  const recs = breakoutChannels.map((c) => ({ id: c.id, data: c, niche: c.niche, tier1: !!c.tier1, best_outlier: c.topVideo?.outlier || 0, breakout_at: c.topVideo?.publishedAt || nowIso, last_seen: nowIso }));
  for (let i = 0; i < recs.length; i += 200) await sb('radar_channels?on_conflict=id', { method: 'POST', body: JSON.stringify(recs.slice(i, i + 200)) });
  const head = await fetch(`${SB_URL}/rest/v1/radar_channels?select=id`, { method: 'HEAD', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact' } });
  const total = Number((head.headers.get('content-range') || '').split('/')[1]) || recs.length;
  await sb('radar_snapshot?on_conflict=id', { method: 'POST', body: JSON.stringify({ id: 1, generated_at: nowIso, avp: avpChannels, avp_generated_at: avpGeneratedAt, history, total_channels: total }) });
  // the public repo must not carry the full lists (free users would see everything), so keep only a stub
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(new URL('../data/trending.json', import.meta.url), JSON.stringify({ servedBy: 'supabase', generatedAt: nowIso }, null, 2));
  console.log(`Saved to Supabase: ${recs.length} breakout channels (total ${total}).`);
} else {
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(new URL('../data/trending.json', import.meta.url), JSON.stringify(out, null, 2));
}
console.log(`Done: ${rows.length} videos, ${breakoutChannels.length} new breakout channels, ${avpChannels.length} AVP channels, ~${yt.units} quota units.`);
