// TubeRadar collector: finds videos/channels breaking out in the last N hours
// and writes data/trending.json. Run: YT_API_KEY=xxx node scripts/collect.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { YouTube, median, hoursSince, daysSince, parseDuration } from './lib.mjs';

const cfg = JSON.parse(await readFile(new URL('../config/keywords.json', import.meta.url), 'utf8'));
const yt = new YouTube(process.env.YT_API_KEY);
const now = Date.now();
const publishedAfter = new Date(now - cfg.windowHours * 36e5).toISOString();

console.log(`Window: last ${cfg.windowHours}h, ${cfg.keywords.length} keywords`);

// 1) Discovery: most viewed recent videos per niche keyword
const videoNiche = new Map();
for (const kw of cfg.keywords) {
  try {
    const ids = await yt.searchRecent(kw, publishedAfter, cfg.regionCode ? { regionCode: cfg.regionCode } : {});
    ids.forEach((id) => { if (!videoNiche.has(id)) videoNiche.set(id, kw); });
    console.log(`  "${kw}": ${ids.length} videos`);
  } catch (e) {
    console.warn(`  "${kw}" failed: ${e.message}`);
    if (/quota/i.test(e.message)) break;
  }
}

// 2) Enrich videos + channels
const videos = await yt.videos([...videoNiche.keys()]);
const channels = await yt.channels(videos.map((v) => v.snippet.channelId));
const chMap = new Map(channels.map((c) => [c.id, c]));

// 3) Channel baseline: median views of recent uploads (for outlier score)
const baseline = new Map();
const recentIdsByChannel = new Map();
for (const c of channels) {
  const uploads = c.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) continue;
  try { recentIdsByChannel.set(c.id, await yt.recentUploadIds(uploads, 15)); } catch { /* skip */ }
}
const recentVideos = await yt.videos([...recentIdsByChannel.values()].flat());
const viewsById = new Map(recentVideos.map((v) => [v.id, Number(v.statistics.viewCount || 0)]));
for (const [chId, ids] of recentIdsByChannel) {
  baseline.set(chId, median(ids.map((id) => viewsById.get(id)).filter((x) => x !== undefined)));
}

// 4) Score
const rows = videos.map((v) => {
  const c = chMap.get(v.snippet.channelId);
  const views = Number(v.statistics.viewCount || 0);
  const hours = hoursSince(v.snippet.publishedAt, now);
  const base = baseline.get(v.snippet.channelId) || 0;
  const subs = Number(c?.statistics?.subscriberCount || 0);
  const duration = parseDuration(v.contentDetails?.duration);
  return {
    id: v.id,
    title: v.snippet.title,
    thumbnail: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url,
    publishedAt: v.snippet.publishedAt,
    niche: videoNiche.get(v.id),
    views,
    likes: Number(v.statistics.likeCount || 0),
    comments: Number(v.statistics.commentCount || 0),
    viewsPerHour: Math.round(views / hours),
    durationSec: duration,
    isShort: duration > 0 && duration <= 180,
    outlier: base > 0 ? +(views / base).toFixed(2) : null,
    viewsPerSub: subs > 0 ? +(views / subs).toFixed(2) : null,
    channel: {
      id: v.snippet.channelId,
      title: v.snippet.channelTitle,
      thumbnail: c?.snippet?.thumbnails?.default?.url,
      subscribers: subs,
      hiddenSubs: !!c?.statistics?.hiddenSubscriberCount,
      videoCount: Number(c?.statistics?.videoCount || 0),
      createdAt: c?.snippet?.publishedAt,
      ageDays: c?.snippet?.publishedAt ? daysSince(c.snippet.publishedAt, now) : null,
      country: c?.snippet?.country || null,
      medianViews: Math.round(base),
    },
  };
}).filter((r) => r.views >= cfg.minViews);

rows.sort((a, b) => b.viewsPerHour - a.viewsPerHour);

// 5) Breakout channels: new/small channels with a strong video in the window
const byChannel = new Map();
for (const r of rows) {
  const ch = r.channel;
  const isNew = ch.ageDays !== null && ch.ageDays <= cfg.newChannelMaxAgeDays;
  const isSmall = ch.subscribers <= cfg.smallChannelMaxSubs;
  const strong = (r.outlier ?? 0) >= cfg.minOutlier || (r.viewsPerSub ?? 0) >= 1;
  if (!(isNew || isSmall) || !strong) continue;
  const prev = byChannel.get(ch.id);
  if (!prev || r.viewsPerHour > prev.topVideo.viewsPerHour) {
    byChannel.set(ch.id, { ...ch, isNew, niche: r.niche, topVideo: { id: r.id, title: r.title, thumbnail: r.thumbnail, views: r.views, viewsPerHour: r.viewsPerHour, outlier: r.outlier } });
  }
}
// Radar score: velocity weighted by how far above normal it is, boosted for new channels
const breakoutChannels = [...byChannel.values()].map((c) => ({
  ...c,
  score: Math.round(Math.log10(c.topVideo.viewsPerHour + 10) * 20 + Math.min(c.topVideo.outlier ?? 1, 50) * 2 + (c.isNew ? 15 : 0)),
})).sort((a, b) => b.score - a.score);

// keep a short history for the dashboard sparklines
let history = [];
try {
  const prev = JSON.parse(await readFile(new URL('../data/trending.json', import.meta.url), 'utf8'));
  if (!prev.demo && Array.isArray(prev.history)) history = prev.history;
} catch { /* first run */ }
history.push({
  at: new Date(now).toISOString(),
  breakout: breakoutChannels.length,
  newChannels: breakoutChannels.filter((c) => c.isNew).length,
  topVph: rows.reduce((m, r) => Math.max(m, r.viewsPerHour), 0),
  niches: cfg.keywords.length,
});
history = history.slice(-12);

const out = {
  generatedAt: new Date(now).toISOString(),
  newChannelMaxAgeDays: cfg.newChannelMaxAgeDays,
  history,
  windowHours: cfg.windowHours,
  keywords: cfg.keywords,
  quotaUnitsUsed: yt.units,
  breakoutChannels,
  videos: rows.slice(0, cfg.maxVideos),
};
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/trending.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(`Done: ${rows.length} videos, ${breakoutChannels.length} breakout channels, ~${yt.units} quota units.`);
