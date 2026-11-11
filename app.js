/* TubeRadar front-end. Vanilla JS, no build step.
   Data: the Supabase "api" function (assets/backend.js). It serves the collector's radar lists (masked by plan)
   and proxies every YouTube Data API v3 / Gemini call with the keys the admin saved, charging the user's daily credits.
   Without a backend config it falls back to data/trending.json (demo). */
(function () {
  "use strict";

  /* ================= helpers ================= */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var API = "https://www.googleapis.com/youtube/v3/";
  var GRAD = ["#4f46e5,#7c5cf0", "#d63a32,#e8604a", "#0369a1,#4f46e5", "#b45309,#d63a32", "#047857,#0369a1", "#6d28d9,#be185d", "#0f766e,#4d7c0f", "#475569,#1e293b"];
  var DEFAULT_NICHES = ["ai tools", "true crime", "stoicism", "history documentary", "personal finance", "horror stories", "minecraft", "space documentary"];
  var STOP = "a an the and or of to in on for with is are was were be this that it its my your our how why what when who i you we they he she his her them me do does did not no yes vs at by from as into about just than then so if can will would should could more most very new best top full part ep episode official video shorts short".split(" ");

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function grad(i) { var g = GRAD[Math.abs(i) % GRAD.length]; return g.split(",")[0] + ";background-image:linear-gradient(135deg," + g + ")"; }
  function hash(s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function initials(n) { var w = String(n || "?").replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter(Boolean); return (w.slice(0, 2).map(function (x) { return x[0]; }).join("") || "?").toUpperCase(); }
  function fmt(n) { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K" : String(Math.round(n)); }
  function median(a) { a = a.filter(isFinite).slice().sort(function (x, y) { return x - y; }); if (!a.length) return 0; var m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  function hoursSince(iso) { return Math.max((Date.now() - new Date(iso).getTime()) / 36e5, 0.25); }
  function daysSince(iso) { return Math.floor((Date.now() - new Date(iso).getTime()) / 864e5); }
  function ago(iso) { var h = hoursSince(iso); return h < 1 ? Math.round(h * 60) + "m ago" : h < 48 ? Math.round(h) + "h ago" : Math.round(h / 24) + "d ago"; }
  function ageText(days) { if (days == null) return ""; return days < 365 ? days + " days old" : (days / 365).toFixed(1) + " years old"; }
  function dur(iso) { var m = String(iso || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); if (!m) return 0; return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0); }
  function chunk(a, n) { var o = []; for (var i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }
  function uniq(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }
  function ytv(id) { return "https://www.youtube.com/watch?v=" + encodeURIComponent(id); }
  function ytc(id) { return "https://www.youtube.com/channel/" + encodeURIComponent(id); }
  function thumbStyle(url, seed) { return url ? "background:#e7e9ef url('" + esc(url) + "') center/cover" : "background:" + grad(seed || 0); }
  function avatar(url, name, size) {
    var st = size ? "width:" + size + "px;height:" + size + "px;font-size:" + Math.round(size * 0.38) + "px;" : "";
    return url ? '<div class="x-av" style="' + st + "background:#e7e9ef url('" + esc(url) + "') center/cover\"></div>"
      : '<div class="x-av" style="' + st + "background:" + grad(hash(name)) + '">' + esc(initials(name)) + "</div>";
  }
  var toastT;
  function toast(msg, err) { var t = $("#x-toast"); t.textContent = msg; t.className = "x-toast on" + (err ? " err" : ""); clearTimeout(toastT); toastT = setTimeout(function () { t.className = "x-toast"; }, err ? 6000 : 3000); }
  function busy(btn, on, label) { if (!btn) return; if (on) { btn.dataset.l = btn.textContent; btn.textContent = label || "Working…"; btn.disabled = true; } else { btn.textContent = btn.dataset.l || btn.textContent; btn.disabled = false; } }
  function empty(title, sub) { return '<div class="x-empty"><b>' + esc(title) + "</b>" + esc(sub || "") + "</div>"; }
  function segVal(id) { var b = $("#" + id + ' button[aria-pressed="true"]'); return b ? b.dataset.v : null; }

  /* ================= storage ================= */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("tr_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("tr_" + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };
  function today() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  var CREDITS = { used: 0, limit: 0 };
  function renderQuota() {
    var used = CREDITS.used || 0, lim = CREDITS.limit || 0, pct = lim ? Math.min(100, used / lim * 100) : 0;
    $("#x-quota-text").textContent = lim ? used.toLocaleString() + " / " + lim.toLocaleString() + " credits" : "Login to get credits";
    var bar = $("#x-quota-bar"); bar.setAttribute("aria-valuenow", Math.round(pct)); $("i", bar).style.width = pct + "%";
  }
  document.addEventListener("tr:credits", function (e) { CREDITS.used = e.detail; renderQuota(); });
  document.addEventListener("tr:me", function (e) { var m = e.detail; CREDITS.used = m ? m.usage.credits_used : 0; CREDITS.limit = m ? m.plan.daily_credits : 0; renderQuota(); });

  /* ================= YouTube API ================= */
  function key() { return window.BE && BE.user() ? "session" : ""; }
  function needKey() {
    if (key()) return false;
    document.dispatchEvent(new Event("tr:needlogin")); return true;
  }
  function apiErr(e) {
    if (e && e.limit) document.dispatchEvent(new Event("tr:limit"));
    if (e && e.status === 401) document.dispatchEvent(new Event("tr:needlogin"));
    throw e;
  }
  function yt(path, params) {
    var p = {}; Object.keys(params || {}).forEach(function (k) { if (params[k] !== undefined && params[k] !== "" && params[k] !== null) p[k] = params[k]; });
    return BE.call("yt", { path: path, params: p }).catch(apiErr);
  }
  function searchVideos(q, hours, extra) {
    var p = Object.assign({ part: "snippet", q: q, type: "video", order: "viewCount", maxResults: 50 }, extra || {});
    if (hours) p.publishedAfter = new Date(Date.now() - hours * 36e5).toISOString();
    return yt("search", p, 100).then(function (j) { return j.items || []; });
  }
  function videosById(ids) {
    return Promise.all(chunk(uniq(ids), 50).map(function (c) {
      return yt("videos", { part: "snippet,statistics,contentDetails", id: c.join(","), maxResults: 50 }).then(function (j) { return j.items || []; });
    })).then(function (a) { return [].concat.apply([], a); });
  }
  function channelsById(ids) {
    return Promise.all(chunk(uniq(ids), 50).map(function (c) {
      return yt("channels", { part: "snippet,statistics,contentDetails", id: c.join(","), maxResults: 50 }).then(function (j) { return j.items || []; });
    })).then(function (a) { return [].concat.apply([], a); });
  }
  function uploads(ch, n) {
    var pl = ch.contentDetails && ch.contentDetails.relatedPlaylists && ch.contentDetails.relatedPlaylists.uploads;
    if (!pl) return Promise.resolve([]);
    return yt("playlistItems", { part: "contentDetails", playlistId: pl, maxResults: n || 15 })
      .then(function (j) { return (j.items || []).map(function (i) { return i.contentDetails.videoId; }); })
      .catch(function () { return []; });
  }
  function uploadsPage(ch, token) {
    var pl = ch.contentDetails && ch.contentDetails.relatedPlaylists && ch.contentDetails.relatedPlaylists.uploads;
    if (!pl) return Promise.resolve({ ids: [], next: null });
    return yt("playlistItems", { part: "contentDetails", playlistId: pl, maxResults: 50, pageToken: token })
      .then(function (j) { return { ids: (j.items || []).map(function (i) { return i.contentDetails.videoId; }), next: j.nextPageToken || null }; });
  }
  // median views of each channel's latest uploads -> Map(channelId -> median)
  function baselines(channels, n) {
    return Promise.all(channels.map(function (c) { return uploads(c, n || 15).then(function (ids) { return [c.id, ids]; }); }))
      .then(function (pairs) {
        var all = [].concat.apply([], pairs.map(function (p) { return p[1]; }));
        return videosById(all).then(function (vids) {
          var views = {}; vids.forEach(function (v) { views[v.id] = +v.statistics.viewCount || 0; });
          var out = {}, lists = {};
          pairs.forEach(function (p) { lists[p[0]] = p[1].map(function (id) { return { id: id, v: views[id] }; }).filter(function (x) { return x.v !== undefined; }); out[p[0]] = median(lists[p[0]].map(function (x) { return x.v; })); });
          return { median: out, recent: lists, videos: vids };
        });
      });
  }
  // Same logic as scripts/lib.mjs profileChannel(): median of last 15, 30-day AVP, monetization ESTIMATE.
  function profiles(channels) {
    return Promise.all(channels.map(function (c) { return uploads(c, 50).then(function (ids) { return [c, ids]; }); }))
      .then(function (pairs) {
        return videosById([].concat.apply([], pairs.map(function (p) { return p[1]; }))).then(function (vids) {
          var vm = {}; vids.forEach(function (v) { vm[v.id] = v; });
          var out = {};
          pairs.forEach(function (p) {
            var c = p[0], list = p[1].map(function (id) { return vm[id]; }).filter(Boolean).map(function (v) { return { views: +v.statistics.viewCount || 0, dur: dur(v.contentDetails && v.contentDetails.duration), days: daysSince(v.snippet.publishedAt), at: v.snippet.publishedAt }; })
              .sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
            var wh = Math.round(list.filter(function (x) { return x.dur > 180 && x.days <= 365; }).reduce(function (s, x) { return s + x.views * x.dur; }, 0) * 0.35 / 3600);
            var sv = list.filter(function (x) { return x.dur > 0 && x.dur <= 180 && x.days <= 90; }).reduce(function (s, x) { return s + x.views; }, 0);
            var last = list.filter(function (x) { return x.days <= 30; }), subs = +c.statistics.subscriberCount || 0;
            out[c.id] = { median: median(list.slice(0, 15).map(function (x) { return x.views; })), avp30: last.length ? Math.round(last.reduce(function (s, x) { return s + x.views; }, 0) / last.length) : 0,
              monet: { eligible: subs >= 1000 && (wh >= 4000 || sv >= 1e7), path: wh >= 4000 ? "long" : sv >= 1e7 ? "shorts" : null, watchHours: wh, shortsViews90d: sv } };
          });
          return out;
        });
      });
  }
  function parseChannelInput(s) {
    s = String(s || "").trim();
    var m;
    if ((m = s.match(/(UC[\w-]{22})/))) return { id: m[1] };
    if ((m = s.match(/@([\w.\-]+)/))) return { forHandle: "@" + m[1] };
    if ((m = s.match(/youtube\.com\/(?:c|user)\/([\w.\-]+)/))) return { forUsername: m[1], handleGuess: "@" + m[1] };
    if (/^[\w.\-]+$/.test(s)) return { forHandle: "@" + s };
    return null;
  }
  function resolveChannel(input) {
    var p = parseChannelInput(input);
    if (!p) return Promise.reject(new Error("Could not understand the channel URL or @handle."));
    var params = { part: "snippet,statistics,contentDetails,brandingSettings" };
    if (p.id) params.id = p.id; else if (p.forHandle) params.forHandle = p.forHandle; else params.forUsername = p.forUsername;
    return yt("channels", params).then(function (j) {
      if (j.items && j.items.length) return j.items[0];
      if (p.handleGuess) return yt("channels", { part: "snippet,statistics,contentDetails", forHandle: p.handleGuess }).then(function (k) { if (k.items && k.items.length) return k.items[0]; throw new Error("Channel not found."); });
      throw new Error("Channel not found.");
    });
  }

  /* ================= navigation ================= */
  function go(view) {
    $$(".x-navbtn").forEach(function (o) { if (o.dataset.view === view) o.setAttribute("aria-current", "page"); else o.removeAttribute("aria-current"); });
    $$(".x-view").forEach(function (v) { v.hidden = v.id !== "view-" + view; });
    $("#x-viewtitle").textContent = $("#view-" + view).dataset.title;
    window.scrollTo(0, 0);
  }
  $$(".x-navbtn").forEach(function (b) { b.addEventListener("click", function () { go(b.dataset.view); }); });
  $$("[data-seg]").forEach(function (seg) {
    seg.addEventListener("click", function (e) {
      var t = e.target.closest("button"); if (!t) return;
      $$("button", seg).forEach(function (o) { o.setAttribute("aria-pressed", o === t ? "true" : "false"); });
      seg.dispatchEvent(new CustomEvent("segchange", { bubbles: true }));
    });
  });
  $("#top-q").addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var v = this.value.trim(); if (!v) return;
    if (/youtube\.com|^@|UC[\w-]{22}/.test(v)) { $("#an-q").value = v; go("analyzer"); runAnalyze(); }
    else { $("#live-q").value = v; go("live"); runLive(); }
  });

  /* ================= VIEW 1: Viral Radar ================= */
  var DATA = null, sortK = "out", sortDir = -1;

  function spark(d) {
    if (!d || d.length < 2) return "";
    var mn = Math.min.apply(0, d), mx = Math.max.apply(0, d), w = 88, h = 32;
    var pts = d.map(function (v, i) { return [(i / (d.length - 1)) * w, h - 3 - ((v - mn) / (mx - mn || 1)) * (h - 6)]; });
    var line = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join("");
    var last = pts[pts.length - 1];
    return '<svg viewBox="0 0 88 32" fill="none" aria-hidden="true"><path d="' + line + 'L88 32L0 32Z" fill="currentColor" opacity=".08"/><path d="' + line + '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.6" fill="currentColor"/></svg>';
  }
  function ring(s) {
    var c = 2 * Math.PI * 19, col = s >= 85 ? "#5b5bf6" : "#8b8bfa";
    return '<div class="x-ring" title="Radar score ' + s + '/100"><svg viewBox="0 0 46 46"><circle cx="23" cy="23" r="19" fill="none" stroke="#eeeefe" stroke-width="4"/><circle cx="23" cy="23" r="19" fill="none" stroke="' + col + '" stroke-width="4" stroke-linecap="round" stroke-dasharray="' + (c * Math.min(s, 100) / 100).toFixed(1) + " " + c.toFixed(1) + '"/></svg><b>' + s + "</b></div>";
  }
  function radarScore(vph, outlier, isNew) {
    return Math.max(1, Math.min(100, Math.round(Math.log10(vph + 10) * 15 + Math.min(outlier || 1, 50) * 0.8 + (isNew ? 12 : 0))));
  }
  function filters() {
    return { hours: (DATA && DATA.windowHours) || 24, format: segVal("f-format") || "all", maxSubs: +$("#f-subs").value, minOut: +$("#f-out").value, maxAge: +$("#f-age").value, monetOnly: $("#x-monet").getAttribute("aria-pressed") === "true", tier1Only: $("#x-tier1").getAttribute("aria-pressed") === "true" };
  }
  // Monetization (YouTube Partner Program) is an ESTIMATE: 1K subs + (4K est. watch hours in 12 months OR 10M Shorts views in 90 days)
  function monetTag(m) {
    if (!m) return '<span class="x-tag" title="Not checked">💲 ?</span>';
    if (m.eligible) return '<span class="x-tag x-tag--money" title="Estimated: ' + fmt(m.watchHours) + ' watch hours, ' + fmt(m.shortsViews90d) + ' Shorts views (90d)">💲 Monetization ✓ ' + (m.path === "shorts" ? "(Shorts)" : "(Long)") + "</span>";
    return '<span class="x-tag x-tag--warn" title="Estimated">💲 ' + fmt(m.watchHours) + "/4K hrs · " + fmt(m.shortsViews90d) + "/10M Shorts</span>";
  }
  function passVideo(v, f) {
    if (!(DATA && DATA.demo) && hoursSince(v.publishedAt) > f.hours) return false;
    if (f.format === "short" && !v.isShort) return false;
    if (f.format === "long" && v.isShort) return false;
    return true;
  }
  var PAGE = 1, PER = 12, RWIN = "24h";
  function lockedCard(c) {
    return '<article class="x-card x-ch x-locked"><div class="x-blur"><div class="x-chhead"><div class="x-av" style="background:' + grad(hash(String(c.subscribers) + c.niche)) + '"></div><div class="x-chname"><h3>Hidden channel name</h3><p class="x-meta">' + fmt(c.subscribers) + " subs · " + esc(ageText(c.ageDays)) + '</p></div></div><div class="x-tags"><span class="x-tag">' + esc(c.niche || "niche") + '</span><span class="x-tag x-tag--viral">🔥 ' + Math.round((c.topVideo || {}).outlier || 0) + 'x outlier</span></div><div class="x-vid"><p>Hidden video title for free plan users</p><div class="x-nums"><span><b>' + fmt((c.topVideo || {}).views) + '</b> views</span></div></div></div><div class="x-lockbadge"><button type="button" data-pricing>🔒 Unlock with Starter</button></div></article>';
  }
  function renderRadar() {
    var d = DATA;
    if (!d) return;
    var f = filters();
    var list = (d.channels || []).filter(function (c) {
      if (c.ageDays != null && c.ageDays > f.maxAge) return false;
      if (c.subscribers > f.maxSubs) return false;
      var t = c.topVideo || {};
      if (f.minOut && (t.outlier || 0) < f.minOut) return false;
      if (f.format === "short" && !t.isShort) return false;
      if (f.format === "long" && t.isShort) return false;
      if (f.monetOnly && !(c.monet && c.monet.eligible) && !(c.locked && !c.monet)) return false;
      if (f.tier1Only && !isTier1(c)) return false;
      return true;
    });
    // visible (unlocked) channels first, in server order; locked ones keep their place after
    var chans = list.map(function (c) { var t = c.topVideo || {}; return { ch: c, top: t, niche: c.niche, locked: !!c.locked, score: radarScore(t.viewsPerHour || 0, t.outlier, true) }; });
    var hist = d.history || [];
    var STATS = [
      ["New viral channels", chans.length, hist.map(function (h) { return h.breakout; })],
      ["Monetization complete", chans.filter(function (c) { return c.ch.monet && c.ch.monet.eligible; }).length, hist.map(function (h) { return h.monetized || 0; })],
      ["Tier-1 channels", chans.filter(function (c) { return isTier1(c.ch); }).length, []],
      ["Total channels analysed", fmt(d.totalChannels || 0), []]
    ];
    $("#x-stats").innerHTML = STATS.map(function (s) { return '<div class="x-card x-stat"><p>' + esc(s[0]) + '</p><div class="x-row"><strong>' + esc(s[1]) + "</strong>" + spark(s[2]) + "</div></div>"; }).join("");
    var lockedN = chans.filter(function (c) { return c.locked; }).length;
    $("#x-unlock").hidden = !lockedN;
    var label = { "24h": "last 24 hours", "7d": "last 7 days", "30d": "last 30 days", "90d": "last 90 days" }[RWIN];
    $("#x-chtitle").textContent = "New channels going viral, " + label;
    $("#x-chcount").textContent = chans.length + " channels" + (lockedN ? " · " + lockedN + " locked" : "");
    var pages = Math.max(1, Math.ceil(chans.length / PER)); if (PAGE > pages) PAGE = pages;
    var slice = chans.slice((PAGE - 1) * PER, PAGE * PER);
    $("#x-channels").innerHTML = slice.length ? slice.map(function (c) {
      if (c.locked) return lockedCard(c.ch);
      var ch = c.ch, t = c.top;
      return '<article class="x-card x-ch"><div class="x-chhead">' + avatar(ch.thumbnail, ch.title) + '<div class="x-chname"><button class="x-chlink" type="button" data-open-ch="' + esc(ch.id) + '" title="See all videos, outliers and strategy"><h3>' + esc(ch.title) + '</h3></button><p class="x-meta">' + (ch.hiddenSubs ? "hidden" : fmt(ch.subscribers)) + " subs · " + esc(ageText(ch.ageDays)) + (ch.country ? " · " + esc(ch.country) : "") + "</p></div>" + ring(c.score) +
        '</div><div class="x-tags"><span class="x-tag">' + esc(c.niche || "") + "</span>" + (t.outlier ? '<span class="x-tag x-tag--viral">🔥 ' + Math.round(t.outlier) + "x outlier</span>" : "") + (isTier1(ch) ? '<span class="x-tag x-tag--new">Tier-1</span>' : "") + monetTag(ch.monet) +
        '</div><a class="x-link x-vid" href="' + ytv(t.id) + '" target="_blank" rel="noopener"><p>' + esc(t.title) + '</p><div class="x-nums"><span><b>' + fmt(t.views) + "</b> views</span><span><b>" + fmt(t.viewsPerHour) + "</b> views/h</span><span><b>+" + fmt(ch.subsPerDay || 0) + "</b> subs/day</span></div></a></article>";
    }).join("") : '<div class="x-card" style="grid-column:1/-1">' + empty("No channels match this filter.", "Lower the min outlier, increase the channel age, or check the 7 Days / 30 Days tab.") + "</div>";
    var pg = ""; if (pages > 1) { pg += '<button data-p="' + Math.max(1, PAGE - 1) + '">‹</button>'; for (var i = 1; i <= pages; i++) pg += '<button data-p="' + i + '"' + (i === PAGE ? ' aria-current="page"' : "") + ">" + i + "</button>"; pg += '<button data-p="' + Math.min(pages, PAGE + 1) + '">›</button>'; }
    $("#x-pager").innerHTML = pg;

    $("#x-trendtitle").textContent = "All new growing channels (" + label + ")";
    renderAvp();
    var rows = chans.filter(function (c) { return !c.locked; }).map(function (c) { var ch = c.ch; return { c: c, title: ch.title, niche: c.niche || "", subs: ch.subscribers || 0, spd: ch.subsPerDay != null ? ch.subsPerDay : Math.round((ch.subscribers || 0) / Math.max(ch.ageDays || 1, 1)), age: ch.ageDays || 0, out: c.top.outlier || 0, views: c.top.views || 0 }; })
      .sort(function (a, b) { var x = a[sortK], y = b[sortK]; return (typeof x === "string" ? x.localeCompare(y) : x - y) * sortDir; });
    $("#x-trend tbody").innerHTML = rows.length ? rows.map(function (r) {
      var ch = r.c.ch, t = r.c.top;
      return '<tr><td><button class="x-chlink x-tv" type="button" data-open-ch="' + esc(ch.id) + '">' + avatar(ch.thumbnail, ch.title, 36) + '<div><b>' + esc(ch.title) + "</b><span>" + (ch.country ? esc(ch.country) + (isTier1(ch) ? " · Tier-1" : "") : "country n/a") + '</span></div></button></td><td><span class="x-tag">' + esc(r.niche) + '</span></td><td class="x-n">' + fmt(r.subs) + '</td><td class="x-n">+' + fmt(r.spd) + '</td><td class="x-meta">' + esc(ageText(r.age)) + "</td><td>" + (r.out ? '<a class="x-link" href="' + ytv(t.id) + '" target="_blank" rel="noopener" title="' + esc(t.title) + '"><span class="x-tag x-tag--viral">🔥 ' + (r.out >= 10 ? Math.round(r.out) : r.out.toFixed(1)) + "x</span></a>" : '<span class="x-meta">–</span>') + '</td><td class="x-n">' + fmt(r.views) + "</td><td>" + monetTag(ch.monet) + "</td></tr>";
    }).join("") : '<tr><td colspan="8">' + empty("No channels.", "Try changing the filters.") + "</td></tr>";
  }
  $("#x-pager").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; PAGE = +b.dataset.p; renderRadar(); $("#x-chtitle").scrollIntoView({ behavior: "smooth", block: "start" }); });
  $("#r-win").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; $$("#r-win button").forEach(function (o) { o.setAttribute("aria-selected", o === b ? "true" : "false"); }); RWIN = b.dataset.v; PAGE = 1; loadData(); });
  function isTier1(ch) { return ch && (ch.tier1 || TIER1.indexOf(ch.country || "") >= 0) ? 1 : 0; }
  var TIER1 = ["US", "GB", "CA", "AU", "NZ", "IE", "DE", "NL", "SE", "NO", "DK", "CH", "AT", "BE", "FI", "LU", "SG", "AE"];
  $("#x-tier1").addEventListener("click", function () { this.setAttribute("aria-pressed", this.getAttribute("aria-pressed") !== "true"); PAGE = 1; renderRadar(); });

  var ARROW = '<svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M6 2l3 3.5H3zM6 10L3 6.5h6z"/></svg>';
  $$("#x-trend th button").forEach(function (b) {
    b.insertAdjacentHTML("beforeend", ARROW);
    b.addEventListener("click", function () {
      var k = b.dataset.k;
      if (k === sortK) sortDir = -sortDir; else { sortK = k; sortDir = (k === "title" || k === "niche" || k === "hrs") ? 1 : -1; }
      $$("#x-trend th").forEach(function (th) { th.removeAttribute("aria-sort"); });
      b.parentNode.setAttribute("aria-sort", sortDir > 0 ? "ascending" : "descending");
      renderRadar();
    });
  });
  $("#f-format").addEventListener("segchange", renderRadar);
  ["#f-subs", "#f-out", "#f-age"].forEach(function (s) { $(s).addEventListener("change", renderRadar); });
  $("#x-monet").addEventListener("click", function () { this.setAttribute("aria-pressed", this.getAttribute("aria-pressed") !== "true"); renderRadar(); });

  /* ================= VIEW: AVP Finder (30 days) ================= */
  function renderAvp() {
    var d = DATA; if (!d) return;
    var f = { format: segVal("avp-format") || "all", maxSubs: +$("#avp-subs").value, ratio: +$("#avp-ratio").value, minAvp: +$("#avp-min").value, monetOnly: $("#avp-monet").getAttribute("aria-pressed") === "true" };
    var list = (d.avpChannels || []).filter(function (c) {
      if (c.subscribers > f.maxSubs || c.avp30 < f.minAvp || c.avpRatio < f.ratio) return false;
      if (f.format === "short" && !(c.topVideo && c.topVideo.isShort)) return false;
      if (f.format === "long" && c.topVideo && c.topVideo.isShort) return false;
      if (f.monetOnly && !(c.monet && c.monet.eligible)) return false;
      return true;
    }).sort(function (a, b) { return b.avpRatio - a.avpRatio; });
    var all = d.avpChannels || [];
    $("#avp-stats").innerHTML = [
      ["Channels found (30d)", list.length],
      ["Best AVP ÷ subs", list.length ? list[0].avpRatio + "x" : "–"],
      ["Monetization complete", list.filter(function (c) { return c.monet && c.monet.eligible; }).length],
      ["List updated", d.avpGeneratedAt ? ago(d.avpGeneratedAt) : "–"]
    ].map(function (s) { return '<div class="x-card x-stat"><p>' + esc(s[0]) + '</p><div class="x-row"><strong>' + esc(s[1]) + "</strong></div></div>"; }).join("");
    $("#avp-count").textContent = list.length + " of " + all.length + " channels";
    $("#avp-table tbody").innerHTML = list.length ? list.slice(0, 150).map(function (c) {
      var t = c.topVideo || {};
      if (c.locked) return '<tr class="x-locked"><td><div class="x-blur x-tv">' + avatar(null, "??", 36) + '<div><b>Hidden channel</b><span>' + esc(c.niche || "") + '</span></div></div></td><td class="x-n">' + fmt(c.subscribers) + '</td><td class="x-n"><b>' + fmt(c.avp30) + '</b></td><td><span class="x-tag x-tag--viral">' + c.avpRatio + 'x</span></td><td class="x-n">' + (c.videos30 || "") + '</td><td colspan="2"><button class="x-btn x-btn--ghost x-mini" type="button" data-pricing>🔒 Unlock</button></td></tr>';
      return '<tr><td><button class="x-chlink x-tv" type="button" data-open-ch="' + esc(c.id) + '">' + avatar(c.thumbnail, c.title, 36) + '<div><b>' + esc(c.title) + "</b><span>" + esc(c.niche || "") + " · " + esc(ageText(c.ageDays)) + '</span></div></button></td><td class="x-n">' + fmt(c.subscribers) + '</td><td class="x-n"><b>' + fmt(c.avp30) + '</b></td><td><span class="x-tag x-tag--viral">' + c.avpRatio + 'x</span></td><td class="x-n">' + c.videos30 + '</td><td><a class="x-link" href="' + ytv(t.id) + '" target="_blank" rel="noopener">' + esc(String(t.title || "").slice(0, 60)) + ' <span class="x-meta">' + fmt(t.views) + " views</span></a></td><td>" + monetTag(c.monet) + "</td></tr>";
    }).join("") : '<tr><td colspan="7">' + empty(all.length ? "No channels match this filter." : "The 30-day list has not been built yet.", all.length ? "Lower the AVP vs subs ratio or the min AVP." : "The GitHub collector builds this list once a day. Wait for the first run.") + "</td></tr>";
  }
  $("#avp-format").addEventListener("segchange", renderAvp);
  ["#avp-subs", "#avp-ratio", "#avp-min"].forEach(function (s) { $(s).addEventListener("change", renderAvp); });
  $("#avp-monet").addEventListener("click", function () { this.setAttribute("aria-pressed", this.getAttribute("aria-pressed") !== "true"); renderAvp(); });

  function setStatus(d) {
    setTimeout(function () { document.dispatchEvent(new Event("tr:data")); }, 0);
    var s = $("#x-status");
    if (!d) { s.textContent = "No data yet"; s.classList.remove("live"); $("#x-updated").textContent = "—"; return; }
    s.textContent = d.demo ? "Demo data" : d.source === "browser" ? "Live · browser scan" : "Live";
    s.classList.toggle("live", !d.demo);
    $("#x-updated").textContent = "Updated " + ago(d.generatedAt);
  }
  function loadData() {
    $("#x-updated").textContent = "Loading…";
    var p = window.BE && BE.ready ? BE.call("radar", { window: RWIN }) :
      fetch("data/trending.json?ts=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(demoShape);
    return p.catch(function (e) { console.warn(e); return null; }).then(function (d) {
      DATA = d; setStatus(d);
      if (!d) {
        $("#x-stats").innerHTML = "";
        $("#x-channels").innerHTML = '<div class="x-card" style="grid-column:1/-1">' + empty("No data yet.", "Wait for the collector's first run (GitHub → Actions → Run workflow).") + "</div>";
        $("#x-trend tbody").innerHTML = ""; $("#x-pager").innerHTML = "";
        return;
      }
      renderRadar();
    });
  }
  // demo file (no backend yet): same shape as the api's radar response
  function demoShape(d) {
    var by = {};
    (d.videos || []).forEach(function (v) { var c = v.channel || {}; if (!by[c.id] || v.outlier > by[c.id].topVideo.outlier) by[c.id] = Object.assign({}, c, { niche: v.niche, topVideo: { id: v.id, title: v.title, views: v.views, viewsPerHour: v.viewsPerHour, outlier: v.outlier, isShort: v.isShort } }); });
    var ch = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.topVideo.outlier - a.topVideo.outlier; });
    return { demo: true, generatedAt: d.generatedAt, avpGeneratedAt: d.avpGeneratedAt, totalChannels: ch.length, history: d.history, channels: ch, avpChannels: d.avpChannels || [] };
  }
  $("#x-refresh").addEventListener("click", loadData);

  /* ================= VIEW 2: Live Search ================= */
  function runLive() {
    var q = $("#live-q").value.trim();
    if (!q) { toast("Enter a niche keyword.", true); return; }
    if (needKey()) return;
    var hours = +segVal("live-win") || 24, btn = $("#live-go");
    busy(btn, true, "Searching…");
    $("#live-title").textContent = "Results for “" + q + "” · last " + (hours === 168 ? "7 days" : hours + "h");
    $("#x-live").innerHTML = empty("Searching YouTube…");
    searchVideos(q, hours)
      .then(function (items) { return videosById(items.map(function (i) { return i.id.videoId; })); })
      .then(function (vids) {
        return channelsById(vids.map(function (v) { return v.snippet.channelId; })).then(function (chs) {
          var top = vids.slice().sort(function (a, b) { return (+b.statistics.viewCount) - (+a.statistics.viewCount); }).slice(0, 25);
          var need = uniq(top.map(function (v) { return v.snippet.channelId; }));
          return baselines(chs.filter(function (c) { return need.indexOf(c.id) >= 0; }), 10).then(function (b) { return { vids: top, chs: chs, base: b.median }; });
        });
      })
      .then(function (r) {
        var cm = {}; r.chs.forEach(function (c) { cm[c.id] = c; });
        var rows = r.vids.map(function (v) {
          var views = +v.statistics.viewCount || 0, b = r.base[v.snippet.channelId] || 0, c = cm[v.snippet.channelId];
          return { v: v, views: views, vph: Math.round(views / hoursSince(v.snippet.publishedAt)), out: b ? views / b : 0, subs: c ? +c.statistics.subscriberCount || 0 : 0 };
        }).sort(function (a, b) { return b.vph - a.vph; });
        var maxV = rows.length ? rows[0].vph : 1;
        $("#live-sub").textContent = rows.length + " videos · sorted by views/hour";
        $("#x-live").innerHTML = rows.length ? rows.map(function (r) {
          var v = r.v, th = (v.snippet.thumbnails.medium || v.snippet.thumbnails.default || {}).url;
          return '<div class="x-li"><span class="x-thumb" style="' + thumbStyle(th, hash(v.id)) + '"></span><a class="x-link x-tv" style="min-width:0" href="' + ytv(v.id) + '" target="_blank" rel="noopener"><div><b>' + esc(v.snippet.title) + "</b><span>" + esc(v.snippet.channelTitle) + " · " + fmt(r.subs) + " subs · " + fmt(r.views) + " views · " + ago(v.snippet.publishedAt) + '</span></div></a><div class="x-vph"><span><b>' + fmt(r.vph) + '</b> views/hour</span><div class="x-bar"><i style="width:' + Math.max(3, r.vph / maxV * 100).toFixed(0) + '%"></i></div></div>' + (r.out >= 1.5 ? '<span class="x-tag x-tag--viral">🔥 ' + (r.out >= 10 ? Math.round(r.out) : r.out.toFixed(1)) + "x</span>" : '<span class="x-meta">' + (r.out ? r.out.toFixed(1) + "x" : "–") + "</span>") + "</div>";
        }).join("") : empty("No videos found in this window.", "Try 48h or 7d.");
      })
      .catch(function (e) { $("#x-live").innerHTML = empty("Search failed", e.message); toast(e.message, true); })
      .then(function () { busy(btn, false); });
  }
  $("#live-go").addEventListener("click", runLive);
  $("#live-q").addEventListener("keydown", function (e) { if (e.key === "Enter") runLive(); });

  /* ================= VIEW 3: Channel Analyzer ================= */
  var CURRENT = null; // { ch, vids(sorted newest first), median }

  function runAnalyze() {
    if (needKey()) return Promise.resolve();
    var input = $("#an-q").value.trim(); if (!input) { toast("Paste a channel URL or @handle.", true); return Promise.resolve(); }
    var btn = $("#an-go"); busy(btn, true, "Analyzing…");
    $("#x-outliers").innerHTML = empty("Analyzing…");
    return resolveChannel(input)
      .then(function (ch) { return uploadsPage(ch).then(function (pg) { return videosById(pg.ids).then(function (v) { return { ch: ch, vids: v, next: pg.next }; }); }); })
      .then(function (r) {
        var vids = r.vids.sort(function (a, b) { return new Date(b.snippet.publishedAt) - new Date(a.snippet.publishedAt); });
        var last15 = vids.slice(0, 15), med = median(last15.map(function (v) { return +v.statistics.viewCount || 0; }));
        CURRENT = { ch: r.ch, vids: vids, median: med, input: input, next: r.next };
        store.set("lastChannel", input);
        renderAnalyzer();
      })
      .catch(function (e) { $("#x-outliers").innerHTML = empty("Analyze failed", e.message); toast(e.message, true); })
      .then(function () { busy(btn, false); });
  }
  function renderAnalyzer() {
    var c = CURRENT, ch = c.ch, sn = ch.snippet, st = ch.statistics;
    $("#an-profile").hidden = false; $("#an-chart").hidden = false;
    $("#an-profile").innerHTML = avatar(((sn.thumbnails || {}).default || {}).url, sn.title) +
      '<div><h2><a class="x-link" href="' + ytc(ch.id) + '" target="_blank" rel="noopener">' + esc(sn.title) + '</a></h2><p class="x-meta">' + esc(sn.customUrl || ch.id) + " · joined " + new Date(sn.publishedAt).getFullYear() + (sn.country ? " · " + esc(sn.country) : "") + "</p></div>" +
      '<div class="x-kv"><div><span>Subscribers</span><b>' + (st.hiddenSubscriberCount ? "hidden" : fmt(st.subscriberCount)) + "</b></div><div><span>Videos</span><b>" + fmt(st.videoCount) + "</b></div><div><span>Total views</span><b>" + fmt(st.viewCount) + "</b></div><div><span>Median views</span><b>" + fmt(c.median) + "</b></div></div>";

    var last = c.vids.slice(0, 15).reverse(); // oldest -> newest
    var VIDS = last.map(function (v) { return +v.statistics.viewCount || 0; });
    var MED = c.median || 1, W = 800, H = 280, L = 52, B = 28, T = 18;
    var MAX = Math.max.apply(0, VIDS.concat([MED * 1.2, 10]));
    var step = Math.pow(10, Math.floor(Math.log10(MAX / 4))); var nice = Math.ceil(MAX / 4 / step) * step; MAX = nice * 4;
    var y = function (v) { return T + (H - T - B) * (1 - v / MAX); };
    var bw = (W - L) / Math.max(VIDS.length, 1), svg = "";
    [0, 1, 2, 3, 4].forEach(function (i) { var g = nice * i; svg += '<line x1="' + L + '" x2="' + W + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="#f0f1f5"/><text x="' + (L - 8) + '" y="' + (y(g) + 4) + '" text-anchor="end" font-size="12" fill="#646a7e">' + fmt(g) + "</text>"; });
    VIDS.forEach(function (v, i) {
      var o = v / MED >= 3, x = L + i * bw + bw * 0.18, w = bw * 0.64;
      svg += '<a href="' + ytv(last[i].id) + '" target="_blank"><rect x="' + x.toFixed(1) + '" y="' + y(v).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, y(0) - y(v)).toFixed(1) + '" rx="4" fill="' + (o ? "#f25c54" : "#5b5bf6") + '" opacity="' + (o ? 1 : 0.85) + '"><title>' + esc(last[i].snippet.title) + " · " + fmt(v) + " views</title></rect></a>";
      if (o) svg += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (y(v) - 6).toFixed(1) + '" text-anchor="middle" font-size="11" font-weight="600" fill="#f25c54">' + (v / MED).toFixed(1) + "x</text>";
      svg += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="12" fill="#646a7e">' + (i + 1) + "</text>";
    });
    svg += '<line x1="' + L + '" x2="' + W + '" y1="' + y(MED) + '" y2="' + y(MED) + '" stroke="#5d6278" stroke-width="1.5" stroke-dasharray="5 5"/><text x="' + (W - 4) + '" y="' + (y(MED) - 6) + '" text-anchor="end" font-size="11" font-weight="500" fill="#5d6278">Median ' + fmt(MED) + "</text>";
    $("#an-charttitle").textContent = "Views on the last " + VIDS.length + " videos";
    $("#an-medlegend").textContent = "Median " + fmt(MED);
    $("#x-bars").innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Views on recent videos against the channel median" font-family="Inter, system-ui, sans-serif">' + svg + "</svg>";

    var outs = c.vids.map(function (v) { return { v: v, x: (+v.statistics.viewCount || 0) / MED }; }).sort(function (a, b) { return b.x - a.x; }).slice(0, 5);
    $("#an-outsub").textContent = "vs. channel median of " + fmt(MED) + " (last 15 uploads)";
    renderAllVideos();
    $("#x-outliers").innerHTML = outs.map(function (o) {
      var v = o.v, th = (v.snippet.thumbnails.medium || v.snippet.thumbnails.default || {}).url;
      return '<div class="x-li" style="grid-template-columns:auto minmax(0,1fr) auto"><span class="x-thumb" style="' + thumbStyle(th, hash(v.id)) + '"></span><a class="x-link x-tv" style="min-width:0" href="' + ytv(v.id) + '" target="_blank" rel="noopener"><div><b>' + esc(v.snippet.title) + "</b><span>" + fmt(v.statistics.viewCount) + " views · " + ago(v.snippet.publishedAt) + '</span></div></a><span class="x-mult">' + o.x.toFixed(1) + "x</span></div>";
    }).join("");
  }
  function vidRow(v) {
    var views = +v.statistics.viewCount || 0, o = CURRENT.median ? views / CURRENT.median : 0, d = dur(v.contentDetails && v.contentDetails.duration), th = (v.snippet.thumbnails.medium || v.snippet.thumbnails.default || {}).url;
    return '<tr><td><a class="x-link x-tv" href="' + ytv(v.id) + '" target="_blank" rel="noopener"><span class="x-thumb" style="' + thumbStyle(th, hash(v.id)) + '"></span><div><b>' + esc(v.snippet.title) + "</b><span>" + (d > 0 && d <= 180 ? "Short" : "Long") + '</span></div></a></td><td class="x-n">' + fmt(views) + '</td><td class="x-meta">' + new Date(v.snippet.publishedAt).toISOString().slice(0, 10) + "</td><td>" + (o >= 3 ? '<span class="x-tag x-tag--viral">🔥 ' + o.toFixed(1) + "x</span>" : '<span class="x-meta">' + o.toFixed(1) + "x</span>") + '</td><td class="x-meta">' + (Math.floor(d / 60) + ":" + ("0" + (d % 60)).slice(-2)) + '</td><td><div class="x-liverow" style="gap:6px;flex-wrap:nowrap"><button class="x-btn x-btn--ghost x-mini" type="button" data-tr="' + esc(v.id) + '">Transcript</button><button class="x-btn x-btn--ghost x-mini" type="button" data-rw="' + esc(v.id) + '">Rewrite</button></div></td></tr>';
  }
  function renderAllVideos() {
    var c = CURRENT; if (!c) return;
    $("#an-allwrap").hidden = false;
    $("#an-alltitle").textContent = "All videos (" + c.vids.length + " of " + fmt(c.ch.statistics.videoCount) + ")";
    $("#an-all tbody").innerHTML = c.vids.map(vidRow).join("");
    $("#an-more").hidden = !c.next;
  }
  $("#an-more").addEventListener("click", function () {
    var c = CURRENT, b = this; if (!c || !c.next) return;
    busy(b, true, "Loading…");
    uploadsPage(c.ch, c.next).then(function (pg) { return videosById(pg.ids).then(function (v) { c.vids = c.vids.concat(v); c.next = pg.next; renderAllVideos(); }); })
      .catch(function (e) { toast(e.message, true); }).then(function () { busy(b, false); });
  });
  function openChannel(id) { $("#an-q").value = id; go("analyzer"); runAnalyze(); }
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-open-ch]");
    if (t) { e.preventDefault(); openChannel(t.getAttribute("data-open-ch")); return; }
    var tr = e.target.closest && e.target.closest("[data-tr]"); if (tr) { showTranscript(tr.getAttribute("data-tr")); return; }
    var rw = e.target.closest && e.target.closest("[data-rw]"); if (rw) { rewriteVideo(rw.getAttribute("data-rw")); }
  });
  $("#an-go").addEventListener("click", runAnalyze);
  $("#an-q").addEventListener("keydown", function (e) { if (e.key === "Enter") runAnalyze(); });

  /* ================= VIEW 4: Competitor Map =================
     YouTube's API no longer exposes "related videos", so we approximate the recommendation
     neighbourhood: search YouTube for the topics of the channel's best videos, count how often each
     other channel shows up (closeness), and link channels that appear in the same result sets. */
  function keywordsFromTitle(t) {
    return uniq(String(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(function (w) { return w.length > 2 && STOP.indexOf(w) < 0 && !/^\d+$/.test(w); })).slice(0, 5).join(" ");
  }
  function buildMap() {
    if (needKey()) return;
    var btn = $("#an-map");
    var start = (CURRENT && CURRENT.input === $("#an-q").value.trim()) ? Promise.resolve() : runAnalyze();
    start.then(function () {
      if (!CURRENT) return;
      var me = CURRENT.ch, queries = uniq(CURRENT.vids.slice().sort(function (a, b) { return (+b.statistics.viewCount) - (+a.statistics.viewCount); }).slice(0, 8).map(function (v) { return keywordsFromTitle(v.snippet.title); })).filter(Boolean).slice(0, 5);
      if (!queries.length) { toast("Could not get topics from this channel's titles.", true); return; }
      if (!confirm("The competitor map will run " + queries.length + " searches (~" + (queries.length * 100 + 40) + " quota units). Continue?")) return;
      busy(btn, true, "Mapping…"); go("map");
      $("#map-title").textContent = "Mapping " + me.snippet.title + "…";
      var score = {}, sets = [];
      return queries.reduce(function (p, q) {
        return p.then(function () {
          return searchVideos(q, 0, { order: "relevance", maxResults: 50 }).then(function (items) {
            var set = uniq(items.map(function (i) { return i.snippet.channelId; })).filter(function (id) { return id !== me.id; });
            items.forEach(function (i, rank) { var id = i.snippet.channelId; if (id === me.id) return; score[id] = (score[id] || 0) + (1 - rank / 60); });
            sets.push(set);
          });
        });
      }, Promise.resolve()).then(function () {
        var ids = Object.keys(score).sort(function (a, b) { return score[b] - score[a]; }).slice(0, 14);
        return channelsById(ids).then(function (chs) {
          return baselines(chs, 10).then(function (b) { return { chs: chs, b: b, ids: ids, score: score, sets: sets, me: me }; });
        });
      }).then(drawMap);
    }).catch(function (e) { toast("Map failed: " + e.message, true); }).then(function () { busy(btn, false); });
  }
  function drawMap(r) {
    var chm = {}; r.chs.forEach(function (c) { chm[c.id] = c; });
    var vm = {}; r.b.videos.forEach(function (v) { vm[v.id] = v; });
    var maxS = r.score[r.ids[0]] || 1;
    var comp = r.ids.filter(function (id) { return chm[id]; }).map(function (id) {
      var c = chm[id], med = r.b.median[id] || 0, recent = r.b.recent[id] || [], best = null;
      recent.forEach(function (x) { var v = vm[x.id]; if (!v || daysSince(v.snippet.publishedAt) > 60) return; if (!best || x.v > best.views) best = { views: x.v, v: v }; });
      var mult = best && med ? best.views / med : 0;
      var subs = +c.statistics.subscriberCount || 0, age = c.snippet.publishedAt ? Math.max(daysSince(c.snippet.publishedAt), 1) : 9999, spd = subs / age;
      var small = subs <= 100000, fast = small && (mult >= 3 || (age <= 365 && spd >= 20));
      return { id: id, name: c.snippet.title, subs: subs, age: age, spd: spd, small: small, fast: fast, thumb: ((c.snippet.thumbnails || {}).default || {}).url, close: Math.round(40 + 55 * r.score[id] / maxS), br: mult >= 3, mult: mult, best: best };
    });
    // priority: small + fast-growing first, then breakout multiplier, then subs gained per day
    comp.sort(function (a, b) { return (b.fast - a.fast) || (b.small - a.small) || (b.mult - a.mult) || (b.spd - a.spd); });
    var me = r.me, CX = 430, CY = 290;
    var nodes = comp.map(function (c, i) {
      var a = (((i * 5) % 14) / 14) * Math.PI * 2 - Math.PI / 2, d = 110 + (100 - c.close) * 3.1;
      return Object.assign({}, c, { x: CX + Math.cos(a) * d * 1.2, y: CY + Math.sin(a) * d * 0.78, r: Math.max(9, 8 + 4.2 * Math.log10(Math.max(c.subs, 1000) / 1000)) });
    });
    var idx = {}; nodes.forEach(function (n, i) { idx[n.id] = i; });
    var g = "", pairs = {};
    r.sets.forEach(function (s) { var inMap = s.filter(function (id) { return idx[id] !== undefined; }).slice(0, 10); for (var i = 0; i < inMap.length; i++) for (var j = i + 1; j < inMap.length; j++) { var k = [inMap[i], inMap[j]].sort().join("|"); pairs[k] = (pairs[k] || 0) + 1; } });
    Object.keys(pairs).filter(function (k) { return pairs[k] >= 2; }).forEach(function (k) {
      var p = k.split("|"), a = nodes[idx[p[0]]], b = nodes[idx[p[1]]];
      g += '<line class="x-edge" x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '" stroke="#c7cad6" stroke-width="1" stroke-dasharray="3 4"/>';
    });
    nodes.forEach(function (n) { g += '<line class="x-edge" x1="' + CX + '" y1="' + CY + '" x2="' + n.x.toFixed(1) + '" y2="' + n.y.toFixed(1) + '" stroke="#5b5bf6" stroke-opacity="' + (0.12 + (n.close - 40) / 160).toFixed(2) + '" stroke-width="' + (1 + (n.close - 40) / 12).toFixed(1) + '" stroke-linecap="round"/>'; });
    nodes.forEach(function (n) {
      var label = n.name.length > 22 ? n.name.slice(0, 21) + "…" : n.name;
      g += '<a href="' + ytc(n.id) + '" data-open-ch="' + esc(n.id) + '"><g class="x-node" tabindex="0"><title>' + esc(n.name) + " · " + fmt(n.subs) + " subs · " + n.close + "% close" + (n.br ? " · breakout " + n.mult.toFixed(1) + "x" : "") + "</title>";
      if (n.br) g += '<circle cx="' + n.x.toFixed(1) + '" cy="' + n.y.toFixed(1) + '" r="' + (n.r + 6).toFixed(1) + '" fill="none" stroke="#f25c54" stroke-width="2"/>';
      g += '<circle class="x-dot" cx="' + n.x.toFixed(1) + '" cy="' + n.y.toFixed(1) + '" r="' + n.r.toFixed(1) + '" fill="#fff" stroke="' + (n.br ? "#f25c54" : "#a5a7f9") + '" stroke-width="2"/>';
      g += '<text x="' + n.x.toFixed(1) + '" y="' + (n.y + 4).toFixed(1) + '" text-anchor="middle" style="font-size:' + (n.r > 15 ? 11 : 9) + 'px;font-weight:600;fill:#5d6278;stroke:none">' + esc(initials(n.name)) + "</text>";
      var ly = n.y + n.r + (n.br ? 20 : 15);
      g += '<text x="' + n.x.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle">' + esc(label) + '</text><text class="x-sm" x="' + n.x.toFixed(1) + '" y="' + (ly + 14).toFixed(1) + '" text-anchor="middle">' + fmt(n.subs) + "</text></g></a>";
    });
    var meName = me.snippet.title, meSubs = fmt(me.statistics.subscriberCount);
    g += '<g class="x-node" tabindex="0"><title>' + esc(meName) + " · your channel · " + meSubs + ' subs</title><circle cx="' + CX + '" cy="' + CY + '" r="52" fill="#5b5bf6" opacity=".1"/><circle class="x-dot" cx="' + CX + '" cy="' + CY + '" r="36" fill="#5b5bf6" stroke="#fff" stroke-width="3"/><text x="' + CX + '" y="' + (CY + 5) + '" text-anchor="middle" style="fill:#fff;stroke:none;font-size:15px;font-weight:700">' + esc(initials(meName)) + '</text><text x="' + CX + '" y="' + (CY + 70) + '" text-anchor="middle" style="font-weight:600;font-size:13px">' + esc(meName) + '</text><text class="x-sm" x="' + CX + '" y="' + (CY + 85) + '" text-anchor="middle">' + meSubs + " · you</text></g>";
    $("#x-net").innerHTML = '<g font-family="Inter, system-ui, sans-serif">' + g + "</g>";
    $("#map-title").textContent = meName + " and " + nodes.length + " competitors";

    $("#x-ranks").innerHTML = comp.slice(0, 14).map(function (c, i) {
      return '<div class="x-rank"><span>' + (i + 1) + '</span><button class="x-chlink" type="button" data-open-ch="' + esc(c.id) + '" style="display:flex;align-items:center;gap:8px;min-width:0">' + avatar(c.thumb, c.name, 28) + '<div style="min-width:0"><b>' + esc(c.name) + '</b> <span class="x-meta">' + fmt(c.subs) + " · +" + fmt(Math.round(c.spd)) + "/day</span>" + (c.fast ? ' <span class="x-tag x-tag--money" style="font-size:12px;padding:0 6px">Fast-growing</span>' : "") + (c.br ? ' <span class="x-tag x-tag--viral" style="font-size:12px;padding:0 6px">' + c.mult.toFixed(1) + "x</span>" : "") + '</div></button><span class="x-close">' + c.close + "%</span></div>";
    }).join("");

    var ideas = comp.filter(function (c) { return c.best; }).sort(function (a, b) { return b.mult - a.mult; }).slice(0, 5);
    var STAR = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/></svg>';
    $("#x-ideas").innerHTML = ideas.length ? ideas.map(function (c) {
      return '<a class="x-link x-idea" href="' + ytv(c.best.v.id) + '" target="_blank" rel="noopener">' + STAR + "<span>" + esc(c.best.v.snippet.title) + '<br><span class="x-meta">' + esc(c.name) + " · " + fmt(c.best.views) + " views · " + c.mult.toFixed(1) + "x</span></span></a>";
    }).join("") : '<p class="x-meta">No breakout found yet.</p>';
  }
  // #an-map is wired in pro.js (Makina-style Map)

  /* ================= AI tools (Gemini, user's own free key) =================
     Gemini reads PUBLIC YouTube videos straight from their URL (official Gemini API feature),
     so no scraping is needed. Transcript, original rewrite and strategy analysis all use it. */
  function gkey() { return key(); }
  function gmodel() { return ""; }
  function needGKey() { return needKey(); }
  // kind: transcript | rewrite | analyze | strategy | chat | topics  (server charges credits by kind)
  function gemini(parts, json, kind, extra) {
    return BE.call("gemini", Object.assign({ kind: kind || "chat", parts: parts, json: !!json }, extra || {})).catch(apiErr).then(function (r) {
      var t = r.text || "";
      if (!json) return t;
      try { return JSON.parse(t.replace(/^```json\s*|```\s*$/g, "")); } catch (e) { throw new Error("The AI did not return valid JSON. Please try again."); }
    });
  }
  function videoPart(id) { return { fileData: { fileUri: ytv(id) } }; }
  function findVid(id) { return CURRENT && CURRENT.vids.filter(function (v) { return v.id === id; })[0]; }

  var MODAL = { name: "", vid: null };
  function modal(title, sub, text, name, vid) {
    $("#x-mtitle").textContent = title; $("#x-msub").textContent = sub || ""; $("#x-mtext").value = text;
    MODAL = { name: name || "tuberadar.txt", vid: vid || null };
    $("#x-mrw").hidden = !vid; $("#x-modal").hidden = false;
  }
  $("#x-mclose").addEventListener("click", function () { $("#x-modal").hidden = true; });
  $("#x-modal").addEventListener("click", function (e) { if (e.target === this) this.hidden = true; });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") $("#x-modal").hidden = true; });
  $("#x-mcopy").addEventListener("click", function () {
    var t = $("#x-mtext").value;
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast("Copied ✓"); }, function () { $("#x-mtext").select(); document.execCommand("copy"); toast("Copied ✓"); });
  });
  function download(name, text, type) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: type || "text/plain" }));
    a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  $("#x-mdl").addEventListener("click", function () { download(MODAL.name, $("#x-mtext").value); });
  $("#x-mrw").addEventListener("click", function () { if (MODAL.vid) rewriteVideo(MODAL.vid); });

  function getTranscript(id) {
    var cache = store.get("tx_" + id, null);
    if (cache) return Promise.resolve(cache);
    return gemini([videoPart(id), { text: "Transcribe everything spoken in this video, word for word, in its original language. Put a [MM:SS] timestamp at the start of each new paragraph (about every 20-40 seconds). Do not summarise, translate or add commentary. If there is no speech, write the on-screen text instead and say so on the first line." }], false, "transcript", { videoId: id })
      .then(function (t) { store.set("tx_" + id, t); return t; });
  }
  function showTranscript(id) {
    if (needGKey()) return;
    var v = findVid(id), title = v ? v.snippet.title : id;
    modal("Transcript", title + " · Getting it from Gemini — 10-60 seconds depending on the video length…", "", "transcript-" + id + ".txt", id);
    getTranscript(id).then(function (t) { modal("Transcript", title, t, "transcript-" + id + ".txt", id); })
      .catch(function (e) { $("#x-msub").textContent = "Fail: " + e.message; toast(e.message, true); });
  }
  function rewriteVideo(id) {
    if (needGKey()) return;
    var v = findVid(id), title = v ? v.snippet.title : id, lang = store.get("lang", "English");
    modal("Original script (rewrite)", title + " · first the transcript, then the new script is being written…", "", "script-" + id + ".txt");
    getTranscript(id).then(function (tx) {
      return gemini([{ text:
        "You are a YouTube scriptwriter. Below is the transcript of a successful video titled \"" + title + "\".\n" +
        "Write a NEW, ORIGINAL script that copies only the STRATEGY, never the expression:\n" +
        "- Keep the same type of hook, the same story arc and beat order, similar pacing, open loops and cliffhanger placement, and a similar length.\n" +
        "- Use completely new wording. Never reuse any sentence or any phrase of more than 4 words from the transcript.\n" +
        "- Use a fresh angle, new examples, new analogies and a new structure of facts. Do not reuse the creator's personal stories, jokes, catchphrases, names of their characters or any copyrighted lyrics/quotes.\n" +
        "- Facts and public information may be used, but rephrased and checked; mark anything that needs fact-checking with [CHECK].\n" +
        "- Language: " + lang + ".\n" +
        "Format: first 5 title options and 2 thumbnail ideas (what is in the image + max 4 words of text), then the script with section labels [HOOK 0-15s], [SETUP], [BEAT 1..n], [CLIFFHANGER], [PAYOFF], [CTA] and approximate timestamps.\n\nTRANSCRIPT:\n" + tx.slice(0, 60000) }], false, "rewrite");
    }).then(function (t) { modal("Original script (rewrite)", title + " · new script, same strategy. Read it yourself and add a personal touch before uploading.", t, "script-" + id + ".txt"); })
      .catch(function (e) { $("#x-msub").textContent = "Fail: " + e.message; toast(e.message, true); });
  }

  /* ---------- Strategy JSON: API stats + Gemini analysis of the top outliers ---------- */
  var TITLE_STOP = STOP;
  function counts(arr, n) { var m = {}; arr.forEach(function (x) { if (x) m[x] = (m[x] || 0) + 1; }); return Object.keys(m).map(function (k) { return { term: k, count: m[k] }; }).sort(function (a, b) { return b.count - a.count; }).slice(0, n || 25); }
  function words(t) { return String(t).toLowerCase().replace(/[^\p{L}\p{N}\s#]/gu, " ").split(/\s+/).filter(function (w) { return w.length > 2 && TITLE_STOP.indexOf(w) < 0 && w[0] !== "#"; }); }
  function thumbB64(url) {
    return fetch(url).then(function (r) { return r.blob(); }).then(function (b) { return new Promise(function (ok) { var fr = new FileReader(); fr.onload = function () { ok(String(fr.result).split(",")[1]); }; fr.readAsDataURL(b); }); }).catch(function () { return null; });
  }
  function strategyStats(c) {
    var vids = c.vids, MED = c.median || 1;
    var rows = vids.map(function (v) {
      var views = +v.statistics.viewCount || 0, d = dur(v.contentDetails && v.contentDetails.duration), desc = v.snippet.description || "";
      return { id: v.id, url: ytv(v.id), title: v.snippet.title, published: v.snippet.publishedAt, views: views, likes: +v.statistics.likeCount || 0, comments: +v.statistics.commentCount || 0,
        outlier: +(views / MED).toFixed(2), durationSec: d, format: d > 0 && d <= 180 ? "short" : "long", tags: v.snippet.tags || [],
        hashtags: uniq((desc.match(/#[\p{L}\p{N}_]+/gu) || []).map(function (h) { return h.toLowerCase(); })),
        thumbnail: ((v.snippet.thumbnails.maxres || v.snippet.thumbnails.high || v.snippet.thumbnails.medium || {}).url) || null,
        titleLength: v.snippet.title.length, descriptionFirstLine: desc.split("\n")[0].slice(0, 200) };
    });
    var dates = rows.map(function (r) { return new Date(r.published).getTime(); }).sort(function (a, b) { return b - a; });
    var gaps = dates.slice(1).map(function (t, i) { return (dates[i] - t) / 864e5; });
    var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var fmtStats = function (f) { var r = rows.filter(function (x) { return x.format === f; }); return { count: r.length, medianViews: Math.round(median(r.map(function (x) { return x.views; }))), medianLengthSec: Math.round(median(r.map(function (x) { return x.durationSec; }))) }; };
    var top = rows.slice().sort(function (a, b) { return b.outlier - a.outlier; });
    var titles = rows.map(function (r) { return r.title; });
    var bigrams = []; titles.forEach(function (t) { var w = words(t); for (var i = 0; i < w.length - 1; i++) bigrams.push(w[i] + " " + w[i + 1]); });
    var pct = function (fn) { return Math.round(100 * titles.filter(fn).length / Math.max(titles.length, 1)); };
    return {
      uploadCadence: { videosAnalysed: rows.length, avgDaysBetweenUploads: gaps.length ? +(gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length).toFixed(1) : null,
        bestWeekdaysUTC: counts(top.slice(0, 10).map(function (r) { return DAYS[new Date(r.published).getUTCDay()]; }), 7), bestHoursUTC: counts(top.slice(0, 10).map(function (r) { return String(new Date(r.published).getUTCHours()); }), 5) },
      formats: { long: fmtStats("long"), short: fmtStats("short") },
      titlePatterns: { avgLength: Math.round(titles.reduce(function (a, t) { return a + t.length; }, 0) / Math.max(titles.length, 1)), pctWithNumber: pct(function (t) { return /\d/.test(t); }), pctQuestion: pct(function (t) { return /\?/.test(t); }),
        pctAllCapsWord: pct(function (t) { return /\b[A-Z]{3,}\b/.test(t); }), pctEmoji: pct(function (t) { return /\p{Extended_Pictographic}/u.test(t); }), pctBrackets: pct(function (t) { return /[\(\[\|]/.test(t); }),
        topWords: counts([].concat.apply([], titles.map(words)), 25), topPhrases: counts(bigrams, 15), outlierTitles: top.slice(0, 10).map(function (r) { return r.title + "  (" + r.outlier + "x)"; }) },
      keywords: { topTags: counts([].concat.apply([], rows.map(function (r) { return r.tags.map(function (t) { return t.toLowerCase(); }); })), 30), topHashtags: counts([].concat.apply([], rows.map(function (r) { return r.hashtags; })), 20) },
      videos: rows, topOutliers: top.slice(0, 5)
    };
  }
  var ANALYSE = 'Analyse this YouTube video (and its thumbnail image if attached) as a growth strategist. Return ONLY JSON with this shape: {"hook":{"first_15s":"what is said/shown","type":"question|shock|story|promise|contrarian|other","why_it_works":""},"story_arc":[{"beat":"","timestamp":"MM:SS","purpose":""}],"cliffhangers":[{"timestamp":"MM:SS","line_or_device":"","technique":""}],"retention_tricks":[""],"pacing":"","tone_and_voice":"","visual_style":"","cta":"","thumbnail":{"main_subject":"","text_on_thumbnail":"","colors":"","emotion":"","composition":"","why_clickable":""},"title_formula":"reusable pattern with [placeholders]","core_engine":"one sentence: the repeatable formula that makes this channel\'s videos work"}';
  $("#an-json").addEventListener("click", function () {
    if (needKey()) return;
    var b = this;
    var start = (CURRENT && CURRENT.input === $("#an-q").value.trim()) ? Promise.resolve() : runAnalyze();
    start.then(function () {
      if (!CURRENT) return;
      busy(b, true, "Building JSON…");
      var c = CURRENT, st = strategyStats(c), ch = c.ch;
      var out = { generatedAt: new Date().toISOString(), tool: "TubeRadar",
        channel: { id: ch.id, url: ytc(ch.id), title: ch.snippet.title, handle: ch.snippet.customUrl || null, created: ch.snippet.publishedAt, country: ch.snippet.country || null,
          subscribers: +ch.statistics.subscriberCount || 0, totalViews: +ch.statistics.viewCount || 0, videoCount: +ch.statistics.videoCount || 0, medianViewsLast15: Math.round(c.median), description: ch.snippet.description || "",
          channelKeywords: (ch.brandingSettings && ch.brandingSettings.channel && ch.brandingSettings.channel.keywords) || null },
        stats: st, ai: null, notes: ["Weekday/hour are UTC.", "AI fields are Gemini's analysis of the top outlier videos, not data from YouTube.", "Use this to learn the strategy; write your own scripts and make your own thumbnails."] };
      // counts 1 strategy JSON against the plan's daily limit (server-side)
      return BE.call("gemini", { kind: "strategy", start: true }).catch(apiErr).then(function () {
      var picks = st.topOutliers.slice(0, 3), analyses = [];
      toast("AI is analysing the top " + picks.length + " outlier videos… (1-3 minutes)");
      return picks.reduce(function (p, r) {
        return p.then(function () {
          return (r.thumbnail ? thumbB64(r.thumbnail) : Promise.resolve(null)).then(function (img) {
            var parts = [videoPart(r.id)]; if (img) parts.push({ inlineData: { mimeType: "image/jpeg", data: img } });
            parts.push({ text: ANALYSE + "\nVideo title: " + r.title });
            return gemini(parts, true, "analyze", { jsonFlow: true }).then(function (j) { analyses.push({ videoId: r.id, title: r.title, views: r.views, outlier: r.outlier, analysis: j }); })
              .catch(function (e) { analyses.push({ videoId: r.id, title: r.title, error: e.message }); });
          });
        });
      }, Promise.resolve()).then(function () {
        return gemini([{ text: 'You are a YouTube strategist. From these per-video analyses and channel stats, return ONLY JSON: {"core_engine":"","content_pillars":[""],"audience":"","hook_formulas":[""],"title_formulas":[""],"thumbnail_formula":"","story_template":[{"beat":"","what_happens":"","approx_share_of_video":"%"}],"cliffhanger_playbook":[""],"keywords_to_target":[""],"hashtags_to_use":[""],"upload_plan":"","video_ideas":[{"title":"","hook":"","why_it_should_work":""}]} with 10 original video_ideas (do not copy existing titles).\nANALYSES:' + JSON.stringify(analyses).slice(0, 60000) + "\nSTATS:" + JSON.stringify({ titlePatterns: st.titlePatterns, keywords: st.keywords, formats: st.formats, uploadCadence: st.uploadCadence }) }], true, "strategy", { jsonFlow: true })
          .then(function (sum) { out.ai = { strategy: sum, videoAnalyses: analyses }; }, function (e) { out.ai = { error: e.message, videoAnalyses: analyses }; })
          .then(function () { return out; });
      });
      });
    }).then(function (out) {
      if (!out) return;
      var name = "strategy-" + String(out.channel.handle || out.channel.id).replace(/[^\w-]/g, "") + ".json";
      download(name, JSON.stringify(out, null, 2), "application/json"); toast("Strategy JSON downloaded ✓");
    }).catch(function (e) { toast("Strategy failed: " + e.message, true); }).then(function () { busy(b, false); });
  });

  /* ================= VIEW 5: Settings (account only; keys live in the admin panel) ================= */
  $("#set-lang").value = store.get("lang", "English");
  $("#set-lang").addEventListener("change", function () { store.set("lang", this.value); });

  /* expose internals for pro.js (Map, Topics, Map chat, Saved, Tools, Home) */
  window.TR = { $: $, $$: $$, esc: esc, fmt: fmt, ago: ago, daysSince: daysSince, median: median, uniq: uniq, chunk: chunk, dur: dur, hash: hash, initials: initials,
    thumbStyle: thumbStyle, avatar: avatar, toast: toast, busy: busy, empty: empty, store: store, yt: yt, key: key, needKey: needKey, searchVideos: searchVideos,
    videosById: videosById, channelsById: channelsById, uploads: uploads, uploadsPage: uploadsPage, resolveChannel: resolveChannel, go: go, ytv: ytv, ytc: ytc,
    gemini: gemini, gkey: gkey, rewriteVideo: rewriteVideo, showTranscript: showTranscript, needGKey: needGKey, videoPart: videoPart, modal: modal, download: download, getTranscript: getTranscript, openChannel: openChannel,
    keywordsFromTitle: keywordsFromTitle, STOP: STOP, ANALYSE: ANALYSE,
    current: function () { return CURRENT; }, data: function () { return DATA; }, runAnalyze: runAnalyze };
  /* ================= boot ================= */
  renderQuota();
  var lc = store.get("lastChannel", ""); if (lc) $("#an-q").value = lc;
  $("#an-profile").hidden = true; $("#an-chart").hidden = true;
  $("#x-live").innerHTML = empty("Type a niche and click Search.", "Each search costs ~12 credits.");
  $("#x-outliers").innerHTML = empty("Paste a channel URL or @handle and click Analyze.");
  $("#x-ranks").innerHTML = '<p class="x-meta">Analyse a channel in the Channel Analyzer, then click "Build competitor map".</p>';
  $("#x-net").innerHTML = '<text x="430" y="300" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="15" fill="#646a7e">Your map will appear here</text>';
  loadData();
})();
