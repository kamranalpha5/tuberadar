// Shared helpers for the TubeRadar collector (Node 20+, no dependencies).
const API = 'https://www.googleapis.com/youtube/v3';

export function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function hoursSince(iso, now = Date.now()) {
  return Math.max((now - new Date(iso).getTime()) / 36e5, 0.25);
}

export function daysSince(iso, now = Date.now()) {
  return Math.floor((now - new Date(iso).getTime()) / 864e5);
}

// ISO 8601 duration (PT1H2M3S) -> seconds
export function parseDuration(iso = '') {
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const [, d = 0, h = 0, mi = 0, s = 0] = m.map((x) => Number(x || 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export class YouTube {
  constructor(key) {
    if (!key) throw new Error('Missing YouTube API key (set YT_API_KEY).');
    this.key = key;
    this.units = 0; // quota units spent this run
  }

  async get(path, params, cost = 1) {
    const url = new URL(`${API}/${path}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
    url.searchParams.set('key', this.key);
    const res = await fetch(url);
    this.units += cost;
    const json = await res.json();
    if (!res.ok) throw new Error(`${path}: ${json?.error?.message || res.status}`);
    return json;
  }

  // 100 units
  async searchRecent(q, publishedAfter, extra = {}) {
    const r = await this.get('search', {
      part: 'snippet', q, type: 'video', order: 'viewCount', maxResults: 50,
      publishedAfter, ...extra,
    }, 100);
    return r.items.map((i) => i.id.videoId).filter(Boolean);
  }

  // 1 unit per 50 ids
  async videos(ids) {
    const out = [];
    for (const c of chunk([...new Set(ids)], 50)) {
      const r = await this.get('videos', { part: 'snippet,statistics,contentDetails', id: c.join(','), maxResults: 50 });
      out.push(...r.items);
    }
    return out;
  }

  // 1 unit per 50 ids
  async channels(ids) {
    const out = [];
    for (const c of chunk([...new Set(ids)], 50)) {
      const r = await this.get('channels', { part: 'snippet,statistics,contentDetails', id: c.join(','), maxResults: 50 });
      out.push(...r.items);
    }
    return out;
  }

  // 1 unit: latest uploads of a channel
  async recentUploadIds(uploadsPlaylistId, n = 15) {
    const r = await this.get('playlistItems', { part: 'contentDetails', playlistId: uploadsPlaylistId, maxResults: n });
    return r.items.map((i) => i.contentDetails.videoId);
  }
}

// Channel profile from its latest uploads (2-4 quota units):
// baseline median, last-N-days AVP, and an *estimate* of YouTube Partner Program eligibility.
export async function profileChannel(yt, c, cfg, now = Date.now(), pages = 2) {
  const pl = c.contentDetails?.relatedPlaylists?.uploads;
  if (!pl) return null;
  const ids = [];
  let token;
  for (let i = 0; i < pages; i++) {
    const r = await yt.get('playlistItems', { part: 'contentDetails', playlistId: pl, maxResults: 50, pageToken: token });
    ids.push(...r.items.map((x) => x.contentDetails.videoId));
    token = r.nextPageToken;
    if (!token) break;
  }
  const vids = (await yt.videos(ids)).sort((a, b) => new Date(b.snippet.publishedAt) - new Date(a.snippet.publishedAt));
  const list = vids.map((v) => ({
    views: Number(v.statistics.viewCount || 0),
    dur: parseDuration(v.contentDetails?.duration),
    days: (now - new Date(v.snippet.publishedAt).getTime()) / 864e5,
  }));
  const m = cfg.monetization;
  const subs = Number(c.statistics?.subscriberCount || 0);
  const longViewsSecs = list.filter((x) => x.dur > 180 && x.days <= 365).reduce((s, x) => s + x.views * x.dur, 0);
  const watchHours = Math.round((longViewsSecs * m.assumedRetention) / 3600);
  const shortsViews90d = list.filter((x) => x.dur > 0 && x.dur <= 180 && x.days <= 90).reduce((s, x) => s + x.views, 0);
  const last = list.filter((x) => x.days <= cfg.avp.days);
  const avp = last.length ? Math.round(last.reduce((s, x) => s + x.views, 0) / last.length) : 0;
  return {
    median: median(list.slice(0, 15).map((x) => x.views)),
    uploadsChecked: list.length,
    partial: !!token, // channel has more uploads than we checked -> totals are a lower bound
    avp30: avp,
    videos30: last.length,
    monet: {
      eligible: subs >= m.minSubs && (watchHours >= m.minWatchHours || shortsViews90d >= m.minShortsViews90d),
      path: watchHours >= m.minWatchHours ? 'long' : shortsViews90d >= m.minShortsViews90d ? 'shorts' : null,
      watchHours,
      shortsViews90d,
    },
  };
}
