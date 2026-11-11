/* TubeRadar front-end. Vanilla JS, no build step.
   Data sources:
   1) data/trending.json  – written every 6h by the GitHub Actions collector (scripts/collect.mjs)
   2) YouTube Data API v3 – called straight from the browser with the user's own key (Live Search,
      Channel Analyzer, Competitor Map, "Scan now"). The key is stored only in this browser (localStorage). */
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
  function addQuota(u) { var q = store.get("quota", {}); if (q.day !== today()) q = { day: today(), used: 0 }; q.used += u; store.set("quota", q); renderQuota(); }
  function renderQuota() {
    var q = store.get("quota", {}); var used = q.day === today() ? q.used : 0;
    $("#x-quota-text").textContent = used.toLocaleString() + " / 10,000 units";
    var bar = $("#x-quota-bar"); bar.setAttribute("aria-valuenow", Math.min(100, used / 100)); $("i", bar).style.width = Math.min(100, used / 100) + "%";
  }

  /* ================= YouTube API ================= */
  function key() { return store.get("key", ""); }
  function needKey() {
    if (key()) return false;
    toast("Pehle Settings mein apni YouTube API key save karein.", true); go("settings"); return true;
  }
  function yt(path, params, cost) {
    var u = new URL(API + path);
    Object.keys(params).forEach(function (k) { if (params[k] !== undefined && params[k] !== "") u.searchParams.set(k, params[k]); });
    u.searchParams.set("key", key());
    addQuota(cost || 1);
    return fetch(u).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) { var m = (j && j.error && j.error.message) || ("HTTP " + r.status); throw new Error(m.replace(/<[^>]+>/g, "")); }
        return j;
      });
    });
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
    if (!p) return Promise.reject(new Error("Channel URL ya @handle samajh nahi aaya."));
    var params = { part: "snippet,statistics,contentDetails" };
    if (p.id) params.id = p.id; else if (p.forHandle) params.forHandle = p.forHandle; else params.forUsername = p.forUsername;
    return yt("channels", params).then(function (j) {
      if (j.items && j.items.length) return j.items[0];
      if (p.handleGuess) return yt("channels", { part: "snippet,statistics,contentDetails", forHandle: p.handleGuess }).then(function (k) { if (k.items && k.items.length) return k.items[0]; throw new Error("Channel nahi mila."); });
      throw new Error("Channel nahi mila.");
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
  var DATA = null, sortK = "vph", sortDir = -1;

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
    return { hours: +segVal("f-window") || 24, format: segVal("f-format") || "all", maxSubs: +$("#f-subs").value, minOut: +$("#f-out").value, newOnly: $("#x-newonly").getAttribute("aria-pressed") === "true" };
  }
  function passVideo(v, f) {
    if (!(DATA && DATA.demo) && hoursSince(v.publishedAt) > f.hours) return false;
    if (f.format === "short" && !v.isShort) return false;
    if (f.format === "long" && v.isShort) return false;
    return true;
  }
  function renderRadar() {
    var d = DATA;
    if (!d) return;
    var f = filters();
    var vids = (d.videos || []).filter(function (v) { return passVideo(v, f); });
    // breakout channels derived from filtered videos (so every filter works on both lists)
    var by = {};
    vids.forEach(function (v) {
      var ch = v.channel || {}; var isNew = ch.ageDays != null && ch.ageDays <= (d.newChannelMaxAgeDays || 180);
      if (ch.subscribers > f.maxSubs) return;
      if ((v.outlier || 0) < f.minOut && !(f.minOut === 0)) return;
      if (f.newOnly && !isNew) return;
      if (!by[ch.id] || v.viewsPerHour > by[ch.id].top.viewsPerHour) by[ch.id] = { ch: ch, isNew: isNew, niche: v.niche, top: v };
    });
    var chans = Object.keys(by).map(function (k) { var c = by[k]; c.score = radarScore(c.top.viewsPerHour, c.top.outlier, c.isNew); return c; })
      .sort(function (a, b) { return b.score - a.score; });

    var hist = d.history || [];
    var STATS = [
      ["Breakout channels (" + (f.hours === 168 ? "7d" : f.hours + "h") + ")", chans.length, hist.map(function (h) { return h.breakout; })],
      ["New channels (<6 months)", chans.filter(function (c) { return c.isNew; }).length, hist.map(function (h) { return h.newChannels; })],
      ["Top views/hour", fmt(vids.reduce(function (m, v) { return Math.max(m, v.viewsPerHour); }, 0)), hist.map(function (h) { return h.topVph; })],
      ["Niches tracked", (d.keywords || []).length, hist.map(function (h) { return h.niches; })]
    ];
    $("#x-stats").innerHTML = STATS.map(function (s) { return '<div class="x-card x-stat"><p>' + esc(s[0]) + '</p><div class="x-row"><strong>' + esc(s[1]) + "</strong>" + spark(s[2]) + "</div></div>"; }).join("");

    $("#x-chcount").textContent = chans.length + " channels";
    $("#x-channels").innerHTML = chans.length ? chans.slice(0, 24).map(function (c) {
      var ch = c.ch, t = c.top;
      return '<article class="x-card x-ch"><div class="x-chhead">' + avatar(ch.thumbnail, ch.title) + '<div class="x-chname"><a class="x-link" href="' + ytc(ch.id) + '" target="_blank" rel="noopener"><h3>' + esc(ch.title) + '</h3></a><p class="x-meta">' + (ch.hiddenSubs ? "hidden" : fmt(ch.subscribers)) + " subs · " + esc(ageText(ch.ageDays)) + "</p></div>" + ring(c.score) +
        '</div><div class="x-tags"><span class="x-tag">' + esc(c.niche || "") + "</span>" + (t.outlier ? '<span class="x-tag x-tag--viral">🔥 ' + Math.round(t.outlier) + "x outlier</span>" : "") + (c.isNew ? '<span class="x-tag x-tag--new">NEW</span>' : "") +
        '</div><a class="x-link x-vid" href="' + ytv(t.id) + '" target="_blank" rel="noopener"><p>' + esc(t.title) + '</p><div class="x-nums"><span><b>' + fmt(t.views) + "</b> views</span><span><b>" + fmt(t.viewsPerHour) + "</b> views/h</span></div></a></article>";
    }).join("") : '<div class="x-card" style="grid-column:1/-1">' + empty("Is filter par koi breakout channel nahi.", "Max subscribers barhayein ya Min outlier kam karein.") + "</div>";

    $("#x-trendtitle").textContent = "Trending videos (last " + (f.hours === 168 ? "7 days" : f.hours + "h") + ")";
    var rows = vids.map(function (v) { return { v: v, title: v.title, niche: v.niche || "", views: v.views, vph: v.viewsPerHour, out: v.outlier || 0, subs: (v.channel || {}).subscribers || 0, hrs: hoursSince(v.publishedAt) }; })
      .sort(function (a, b) { var x = a[sortK], y = b[sortK]; return (typeof x === "string" ? x.localeCompare(y) : x - y) * sortDir; })
      .slice(0, 100);
    $("#x-trend tbody").innerHTML = rows.length ? rows.map(function (r) {
      var v = r.v;
      return '<tr><td><a class="x-link x-tv" href="' + ytv(v.id) + '" target="_blank" rel="noopener"><span class="x-thumb" style="' + thumbStyle(v.thumbnail, hash(v.id)) + '"></span><div><b>' + esc(v.title) + "</b><span>" + esc((v.channel || {}).title) + '</span></div></a></td><td><span class="x-tag">' + esc(r.niche) + '</span></td><td class="x-n">' + fmt(r.views) + '</td><td class="x-n">' + fmt(r.vph) + "</td><td>" + (r.out ? '<span class="x-tag x-tag--viral">🔥 ' + (r.out >= 10 ? Math.round(r.out) : r.out.toFixed(1)) + "x</span>" : '<span class="x-meta">–</span>') + '</td><td class="x-n">' + fmt(r.subs) + '</td><td class="x-meta">' + ago(v.publishedAt) + "</td></tr>";
    }).join("") : '<tr><td colspan="7">' + empty("Koi video nahi.", "Window ya format filter badal kar dekhein.") + "</td></tr>";
  }

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
  ["#f-window", "#f-format"].forEach(function (s) { $(s).addEventListener("segchange", renderRadar); });
  ["#f-subs", "#f-out"].forEach(function (s) { $(s).addEventListener("change", renderRadar); });
  $("#x-newonly").addEventListener("click", function () { this.setAttribute("aria-pressed", this.getAttribute("aria-pressed") !== "true"); renderRadar(); });

  function setStatus(d) {
    var s = $("#x-status");
    if (!d) { s.textContent = "No data yet"; s.classList.remove("live"); $("#x-updated").textContent = "—"; return; }
    s.textContent = d.demo ? "Demo data" : d.source === "browser" ? "Live · browser scan" : "Live";
    s.classList.toggle("live", !d.demo);
    $("#x-updated").textContent = "Updated " + ago(d.generatedAt);
  }
  function loadData() {
    $("#x-updated").textContent = "Loading…";
    var local = store.get("scan", null);
    return fetch("data/trending.json?ts=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(function () { return null; })
      .then(function (remote) {
        // prefer the newest of: collector file vs. last in-browser scan
        var d = remote;
        if (local && (!d || d.demo || new Date(local.generatedAt) > new Date(d.generatedAt))) d = local;
        DATA = d; setStatus(d);
        if (!d) {
          $("#x-stats").innerHTML = "";
          $("#x-channels").innerHTML = '<div class="x-card" style="grid-column:1/-1">' + empty("Abhi data nahi hai.", "Settings mein API key save karke \"Scan now\" dabayein, ya GitHub collector chalayein.") + "</div>";
          $("#x-trend tbody").innerHTML = "";
          return;
        }
        renderRadar();
      });
  }
  $("#x-refresh").addEventListener("click", loadData);

  // In-browser collector (same logic as scripts/collect.mjs). ~100 units per niche + ~2 per channel.
  $("#x-scan").addEventListener("click", function () {
    if (needKey()) return;
    var niches = store.get("niches", DEFAULT_NICHES), btn = this, hours = 24;
    if (!niches.length) { toast("Settings mein kam az kam ek niche add karein.", true); return; }
    if (!confirm("Scan " + niches.length + " niches? Lagbhag " + (niches.length * 100 + 150) + " quota units lagenge (daily free limit 10,000).")) return;
    busy(btn, true, "Scanning…");
    var nicheOf = {};
    niches.reduce(function (p, kw) {
      return p.then(function () {
        return searchVideos(kw, hours).then(function (items) { items.forEach(function (i) { if (i.id.videoId && !nicheOf[i.id.videoId]) nicheOf[i.id.videoId] = kw; }); });
      });
    }, Promise.resolve())
      .then(function () { return videosById(Object.keys(nicheOf)); })
      .then(function (vids) {
        return channelsById(vids.map(function (v) { return v.snippet.channelId; })).then(function (chs) {
          // baseline only for channels that could qualify (keeps quota low)
          var small = chs.filter(function (c) { return (+c.statistics.subscriberCount || 0) <= 500000; });
          return baselines(small, 15).then(function (b) { return build(vids, chs, b.median); });
        });
      })
      .then(function (d) { d.keywords = niches; d.source = "browser"; store.set("scan", d); DATA = d; setStatus(d); renderRadar(); toast("Scan complete: " + d.videos.length + " videos."); })
      .catch(function (e) { toast("Scan failed: " + e.message, true); })
      .then(function () { busy(btn, false); });

    function build(vids, chs, base) {
      var cm = {}; chs.forEach(function (c) { cm[c.id] = c; });
      var videos = vids.map(function (v) {
        var c = cm[v.snippet.channelId] || { snippet: {}, statistics: {} }, views = +v.statistics.viewCount || 0, b = base[v.snippet.channelId] || 0, d = dur(v.contentDetails && v.contentDetails.duration);
        return {
          id: v.id, title: v.snippet.title, thumbnail: (v.snippet.thumbnails.medium || v.snippet.thumbnails.default || {}).url, publishedAt: v.snippet.publishedAt, niche: nicheOf[v.id],
          views: views, viewsPerHour: Math.round(views / hoursSince(v.snippet.publishedAt)), durationSec: d, isShort: d > 0 && d <= 180,
          outlier: b > 0 ? +(views / b).toFixed(2) : null,
          channel: { id: c.id || v.snippet.channelId, title: v.snippet.channelTitle, thumbnail: ((c.snippet.thumbnails || {}).default || {}).url, subscribers: +c.statistics.subscriberCount || 0, hiddenSubs: !!c.statistics.hiddenSubscriberCount, ageDays: c.snippet.publishedAt ? daysSince(c.snippet.publishedAt) : null, medianViews: Math.round(b) }
        };
      }).filter(function (v) { return v.views >= 1000; }).sort(function (a, b) { return b.viewsPerHour - a.viewsPerHour; });
      return { generatedAt: new Date().toISOString(), windowHours: hours, newChannelMaxAgeDays: 180, videos: videos, history: (DATA && DATA.history) || [] };
    }
  });

  /* ================= VIEW 2: Live Search ================= */
  function runLive() {
    var q = $("#live-q").value.trim();
    if (!q) { toast("Koi niche keyword likhein.", true); return; }
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
        }).join("") : empty("Is window mein koi video nahi mila.", "48h ya 7d try karein.");
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
    var input = $("#an-q").value.trim(); if (!input) { toast("Channel URL ya @handle paste karein.", true); return Promise.resolve(); }
    var btn = $("#an-go"); busy(btn, true, "Analyzing…");
    $("#x-outliers").innerHTML = empty("Analyzing…");
    return resolveChannel(input)
      .then(function (ch) { return uploads(ch, 30).then(function (ids) { return videosById(ids).then(function (v) { return { ch: ch, vids: v }; }); }); })
      .then(function (r) {
        var vids = r.vids.sort(function (a, b) { return new Date(b.snippet.publishedAt) - new Date(a.snippet.publishedAt); });
        var last15 = vids.slice(0, 15), med = median(last15.map(function (v) { return +v.statistics.viewCount || 0; }));
        CURRENT = { ch: r.ch, vids: vids, median: med, input: input };
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
    $("#an-outsub").textContent = "vs. channel median of " + fmt(MED) + " (last 30 uploads)";
    $("#x-outliers").innerHTML = outs.map(function (o) {
      var v = o.v, th = (v.snippet.thumbnails.medium || v.snippet.thumbnails.default || {}).url;
      return '<div class="x-li" style="grid-template-columns:auto minmax(0,1fr) auto"><span class="x-thumb" style="' + thumbStyle(th, hash(v.id)) + '"></span><a class="x-link x-tv" style="min-width:0" href="' + ytv(v.id) + '" target="_blank" rel="noopener"><div><b>' + esc(v.snippet.title) + "</b><span>" + fmt(v.statistics.viewCount) + " views · " + ago(v.snippet.publishedAt) + '</span></div></a><span class="x-mult">' + o.x.toFixed(1) + "x</span></div>";
    }).join("");
  }
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
      if (!queries.length) { toast("Is channel ke titles se topics nahi nikle.", true); return; }
      if (!confirm("Competitor map ke liye " + queries.length + " searches chalengi (~" + (queries.length * 100 + 40) + " quota units). Continue?")) return;
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
      return { id: id, name: c.snippet.title, subs: +c.statistics.subscriberCount || 0, thumb: ((c.snippet.thumbnails || {}).default || {}).url, close: Math.round(40 + 55 * r.score[id] / maxS), br: mult >= 3, mult: mult, best: best };
    });
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
      g += '<a href="' + ytc(n.id) + '" target="_blank"><g class="x-node" tabindex="0"><title>' + esc(n.name) + " · " + fmt(n.subs) + " subs · " + n.close + "% close" + (n.br ? " · breakout " + n.mult.toFixed(1) + "x" : "") + "</title>";
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

    $("#x-ranks").innerHTML = comp.slice(0, 8).map(function (c, i) {
      return '<div class="x-rank"><span>' + (i + 1) + '</span><a class="x-link" href="' + ytc(c.id) + '" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:8px;min-width:0">' + avatar(c.thumb, c.name, 28) + '<div style="min-width:0"><b>' + esc(c.name) + '</b> <span class="x-meta">' + fmt(c.subs) + "</span>" + (c.br ? ' <span class="x-tag x-tag--viral" style="font-size:12px;padding:0 6px">Breakout</span>' : "") + '</div></a><span class="x-close">' + c.close + "%</span></div>";
    }).join("");

    var ideas = comp.filter(function (c) { return c.best; }).sort(function (a, b) { return b.mult - a.mult; }).slice(0, 5);
    var STAR = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/></svg>';
    $("#x-ideas").innerHTML = ideas.length ? ideas.map(function (c) {
      return '<a class="x-link x-idea" href="' + ytv(c.best.v.id) + '" target="_blank" rel="noopener">' + STAR + "<span>" + esc(c.best.v.snippet.title) + '<br><span class="x-meta">' + esc(c.name) + " · " + fmt(c.best.views) + " views · " + c.mult.toFixed(1) + "x</span></span></a>";
    }).join("") : '<p class="x-meta">Abhi koi breakout nahi mila.</p>';
  }
  $("#an-map").addEventListener("click", buildMap);

  /* ================= VIEW 5: Settings ================= */
  $("#set-key").value = key();
  $("#x-save").addEventListener("click", function () {
    var v = $("#set-key").value.trim(), b = this;
    if (!/^AIza[\w-]{30,}$/.test(v)) { toast("Yeh YouTube API key jaisi nahi lagti (AIza… se shuru hoti hai).", true); return; }
    store.set("key", v); busy(b, true, "Checking…");
    yt("videos", { part: "id", id: "dQw4w9WgXcQ" })
      .then(function () { toast("Key saved aur kaam kar rahi hai ✓"); })
      .catch(function (e) { toast("Key saved, lekin test fail hua: " + e.message, true); })
      .then(function () { busy(b, false); });
  });
  $("#x-clearkey").addEventListener("click", function () { store.set("key", ""); $("#set-key").value = ""; toast("Key is browser se hata di gayi."); });

  var NICHES = store.get("niches", DEFAULT_NICHES);
  function renderNiches() {
    store.set("niches", NICHES);
    $("#x-niches").innerHTML = NICHES.map(function (n, i) { return '<span class="x-kchip">' + esc(n) + '<button type="button" data-i="' + i + '" aria-label="Remove ' + esc(n) + '">×</button></span>'; }).join("");
  }
  $("#x-niches").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; NICHES.splice(+b.dataset.i, 1); renderNiches(); });
  $("#x-addniche").addEventListener("submit", function (e) {
    e.preventDefault(); var inp = $("input", this), v = inp.value.trim().toLowerCase();
    if (v && NICHES.indexOf(v) < 0) { NICHES.push(v); renderNiches(); } inp.value = "";
  });
  $("#x-copycfg").addEventListener("click", function () {
    var txt = JSON.stringify(NICHES, null, 2);
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast("Copied. config/keywords.json ke \"keywords\" mein paste karein."); }, function () { prompt("Copy this:", txt); });
  });

  /* ================= boot ================= */
  renderNiches(); renderQuota();
  var lc = store.get("lastChannel", ""); if (lc) $("#an-q").value = lc;
  $("#an-profile").hidden = true; $("#an-chart").hidden = true;
  $("#x-live").innerHTML = empty("Koi niche likh kar Search dabayein.", "Har search ~105 quota units leti hai.");
  $("#x-outliers").innerHTML = empty("Channel URL ya @handle paste karke Analyze dabayein.");
  $("#x-ranks").innerHTML = '<p class="x-meta">Channel Analyzer mein channel analyze karke "Build competitor map" dabayein.</p>';
  $("#x-net").innerHTML = '<text x="430" y="300" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="15" fill="#646a7e">Map yahan banega</text>';
  loadData();
})();
