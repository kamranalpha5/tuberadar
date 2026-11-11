/* TubeRadar "pro" layer: Makina-style Home, Map (with channel panel + export), Topics, research chat,
   Saved & Channel Tracker, Tools, and the account / plans / payment UI. Uses window.TR (app.js) and window.BE (backend.js). */
(function () {
  "use strict";
  var T = window.TR; if (!T) return;
  var $ = T.$, $$ = T.$$, esc = T.esc, fmt = T.fmt, store = T.store, toast = T.toast;
  var SITE = { site_name: "TubeRadar", whatsapp: "0340-9301597", business_name: "NexGen Automation" };
  var ME = null, PLANS = [], METHODS = [];

  /* ---------- small helpers ---------- */
  function img(url, name, size, cls) {
    return url ? '<img class="' + (cls || "") + '" src="' + esc(url) + '" alt="" width="' + size + '" height="' + size + '" loading="lazy" referrerpolicy="no-referrer" style="width:' + size + "px;height:" + size + 'px;border-radius:50%;object-fit:cover">' : T.avatar(null, name, size);
  }
  function thumbOf(v) { var t = (v.snippet || {}).thumbnails || {}; return (t.medium || t.high || t.default || {}).url || ("https://i.ytimg.com/vi/" + v.id + "/mqdefault.jpg"); }
  function chThumb(c) { var t = (c.snippet || {}).thumbnails || {}; return (t.medium || t.default || {}).url || null; }
  function durTxt(sec) { sec = sec || 0; var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ":" + ("0" + m).slice(-2) : m) + ":" + ("0" + s).slice(-2); }
  function waLink() { var n = String(SITE.whatsapp || "").replace(/\D/g, ""); if (n[0] === "0") n = "92" + n.slice(1); return "https://wa.me/" + n; }
  function guessLang(titles) {
    var t = titles.join(" ");
    if (/[\uac00-\ud7af]/.test(t)) return "Korean"; if (/[\u3040-\u30ff]/.test(t)) return "Japanese"; if (/[\u0900-\u097f]/.test(t)) return "Hindi";
    if (/[\u0600-\u06ff]/.test(t)) return "Urdu/Arabic"; if (/[\u0400-\u04ff]/.test(t)) return "Russian"; if (/[\u0e00-\u0e7f]/.test(t)) return "Thai";
    if (/[\u4e00-\u9fff]/.test(t)) return "Chinese"; if (/[ñáéíóú¿¡]/i.test(t)) return "Spanish/Portuguese"; return "English/Latin";
  }
  function openModal(id) { $(id).hidden = false; }
  function closeModal(el) { var m = el.closest(".x-modal"); if (m) m.hidden = true; }
  document.addEventListener("click", function (e) {
    var c = e.target.closest("[data-close]"); if (c) { closeModal(c); return; }
    var p = e.target.closest("[data-pricing]"); if (p) { e.preventDefault(); openPricing(); return; }
    var g = e.target.closest("[data-go]"); if (g) { T.go(g.dataset.go); return; }
  });
  $$(".x-modal").forEach(function (m) { m.addEventListener("click", function (e) { if (e.target === m) m.hidden = true; }); });
  document.addEventListener("tr:needlogin", function () { openAuth("in"); });
  document.addEventListener("tr:limit", function () { toast("Aaj ki limit poori ho gayi. Upgrade karein ya kal try karein.", true); setTimeout(openPricing, 900); });

  /* ================= site settings + auth ================= */
  function applySite() {
    $$(".x-logo span").forEach(function (e) { e.textContent = SITE.site_name; });
    document.title = SITE.site_name + " · YouTube Viral Radar";
    if (SITE.announcement) { $("#hm-ann").hidden = false; $("#hm-ann").textContent = SITE.announcement; }
    $("#pr-wa").href = waLink();
  }
  if (BE.ready) {
    BE.settings().then(function (s) { SITE = Object.assign(SITE, s || {}); applySite(); }).catch(function () { applySite(); });
    BE.plans().then(function (p) { PLANS = p; }).catch(function () {});
  } else {
    applySite();
    setTimeout(function () { toast("Demo mode: assets/config.js mein Supabase URL aur anon key daalein.", true); }, 800);
  }
  function refreshMe() {
    if (!BE.ready || !BE.user()) { ME = null; renderMe(); return Promise.resolve(); }
    return BE.call("me").then(function (m) { ME = m; renderMe(); }).catch(function (e) { console.warn(e); ME = null; renderMe(); });
  }
  BE.onAuth(function () { refreshMe(); });
  document.addEventListener("tr:credits", function (e) { if (ME) { ME.usage.credits_used = e.detail; renderMe(true); } });

  function renderMe(light) {
    document.dispatchEvent(new CustomEvent("tr:me", { detail: ME }));
    var u = ME && ME.profile, plan = ME && ME.plan;
    $("#x-mename").textContent = u ? (u.full_name || u.email) : "Sign in";
    $("#x-meplan").textContent = plan ? plan.name : "Free · not signed in";
    $("#x-meav").textContent = u ? (u.full_name || u.email || "?")[0].toUpperCase() : "?";
    $("#x-credleft").textContent = ME ? fmt(Math.max(0, plan.daily_credits - ME.usage.credits_used)) : "–";
    renderGreeting();
    if (light) return;
    // account page
    if (!u) {
      $("#acc-body").innerHTML = '<p class="x-meta">Aap signed in nahi hain.</p><div class="x-liverow"><button class="x-btn" type="button" id="acc-login">Sign in / Create account</button></div>';
      $("#acc-usage").innerHTML = '<p class="x-meta">Login ke baad yahan credits aur limits dikhengi.</p>';
      $("#acc-pays").innerHTML = '<p class="x-meta">–</p>';
      $("#acc-login").onclick = function () { openAuth("in"); };
      return;
    }
    var exp = u.plan_expires_at ? new Date(u.plan_expires_at) : null;
    var active = plan.id !== "free";
    $("#acc-body").innerHTML = [
      ["Email", esc(u.email)], ["Name", esc(u.full_name || "–")], ["Plan", '<b>' + esc(plan.name) + "</b>" + (u.shared_group && active ? " · group #" + u.shared_group : "")],
      ["Valid till", active && exp ? exp.toLocaleDateString() + " (" + Math.max(0, Math.ceil((exp - Date.now()) / 864e5)) + " days left)" : "–"]
    ].map(function (r) { return '<div class="x-acc-row"><span>' + r[0] + "</span><div>" + r[1] + "</div></div>"; }).join("") +
      '<div class="x-liverow"><button class="x-btn" type="button" data-pricing>' + (active ? "Renew / change plan" : "Upgrade plan") + '</button><button class="x-btn x-btn--ghost" type="button" id="acc-logout">Log out</button>' + (u.is_admin ? '<a class="x-btn x-btn--ghost" href="admin.html">Admin panel</a>' : "") + "</div>";
    $("#acc-logout").onclick = function () { BE.signOut().then(function () { toast("Logged out."); }); };
    var cu = ME.usage.credits_used, cl = plan.daily_credits, ju = ME.usage.json_used, jl = plan.daily_json;
    function meter(lbl, a, b) { var pc = b ? Math.min(100, a / b * 100) : 0; return '<div class="x-meter"><div><span>' + lbl + "</span><b>" + fmt(a) + " / " + fmt(b) + '</b></div><div class="x-bar"><i style="width:' + pc + '%"></i></div></div>'; }
    var costs = ME.costs || {};
    $("#acc-usage").innerHTML = meter("Credits", cu, cl) + meter("Strategy JSON", ju, jl) +
      '<p class="x-meta">Viral channels visible: <b>' + (plan.radar_visible == null ? "All" : plan.radar_visible + " per list") + "</b></p>" +
      '<p class="x-help">Credit cost: YouTube search ~' + (10 * (costs.yt_per_10_units || 1)) + " · map ~70 · transcript " + (costs.transcript || 10) + " · rewrite " + (costs.rewrite || 15) + " · chat " + (costs.chat || 3) + " · topics " + (costs.topics || 40) + "</p>";
    $("#acc-pays").innerHTML = (ME.payments || []).length ? ME.payments.map(function (p) {
      var col = p.status === "approved" ? "x-tag--money" : p.status === "rejected" ? "x-tag--viral" : "x-tag--warn";
      return '<div class="x-acc-row"><span>' + new Date(p.created_at).toLocaleString() + " · " + esc(p.plan_id) + " · TID " + esc(p.tid) + '</span><span class="x-tag ' + col + '">' + esc(p.status) + (p.note ? " · " + esc(p.note) : "") + "</span></div>";
    }).join("") : '<p class="x-meta">Abhi koi payment nahi.</p>';
  }
  $("#x-me").addEventListener("click", function () { if (ME) T.go("settings"); else openAuth("in"); });

  /* login modal */
  var AUMODE = "in";
  function openAuth(mode) {
    if (!BE.ready) { toast("Backend set nahi hua (assets/config.js).", true); return; }
    AUMODE = mode || "in"; setAuthMode(); $("#au-msg").textContent = ""; openModal("#x-auth"); setTimeout(function () { $("#au-email").focus(); }, 50);
  }
  function setAuthMode() {
    $$("#au-tabs button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.v === AUMODE ? "true" : "false"); });
    $("#au-namewrap").hidden = AUMODE !== "up"; $("#au-title").textContent = AUMODE === "up" ? "Create your account" : "Sign in";
    $("#au-submit").textContent = AUMODE === "up" ? "Create account" : "Sign in";
    $("#au-pw").autocomplete = AUMODE === "up" ? "new-password" : "current-password";
  }
  $("#au-tabs").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; AUMODE = b.dataset.v; setAuthMode(); });
  $("#au-form").addEventListener("submit", function (e) {
    e.preventDefault(); var em = $("#au-email").value.trim(), pw = $("#au-pw").value, b = $("#au-submit");
    T.busy(b, true, "Please wait…"); $("#au-msg").textContent = "";
    (AUMODE === "up" ? BE.signUp(em, pw, $("#au-name").value.trim()) : BE.signIn(em, pw)).then(function (r) {
      if (AUMODE === "up" && !(r.data && r.data.session)) { $("#au-msg").textContent = "Account ban gaya. Email mein confirm link par click karein, phir sign in karein."; return; }
      $("#x-auth").hidden = true; toast("Welcome! ✓");
    }).catch(function (er) { $("#au-msg").textContent = er.message; }).then(function () { T.busy(b, false); });
  });
  $("#au-google").addEventListener("click", function () { BE.google().catch(function (er) { $("#au-msg").textContent = er.message; }); });
  $("#au-forgot").addEventListener("click", function () {
    var em = $("#au-email").value.trim(); if (!em) { $("#au-msg").textContent = "Pehle email likhein."; return; }
    BE.reset(em).then(function () { $("#au-msg").textContent = "Password reset link email kar diya."; }).catch(function (er) { $("#au-msg").textContent = er.message; });
  });

  /* pricing + payment */
  var PAYPLAN = null, PAYMETHOD = null;
  function openPricing() {
    if (!BE.ready) { toast("Backend set nahi hua.", true); return; }
    $("#pr-step1").hidden = false; $("#pr-step2").hidden = true; openModal("#x-pricing");
    Promise.all([BE.plans(), BE.methods()]).then(function (r) { PLANS = r[0]; METHODS = r[1]; drawPlans(); }).catch(function (e) { $("#pr-plans").innerHTML = T.empty("Plans load nahi hue", e.message); });
  }
  function drawPlans() {
    var cur = ME && ME.plan ? ME.plan.id : "free";
    $("#pr-plans").innerHTML = PLANS.map(function (p) {
      var free = +p.price_usd === 0;
      return '<div class="x-plan' + (p.highlight ? " hl" : "") + '"><h3>' + esc(p.name) + "</h3>" + (p.shared ? '<span class="x-tag">Shared · max ' + (p.max_seats || 5) + " users</span>" : '<span class="x-tag">Private</span>') +
        '<div class="x-price">$' + esc(p.price_usd) + ' <small>/ ' + (p.period_days || 30) + ' days</small></div><p class="x-meta">Rs ' + fmt(p.price_pkr) + " via Easypaisa / bank</p><ul>" + (p.features || []).map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul>" +
        (free ? '<button class="x-btn x-btn--ghost" type="button" disabled>' + (cur === "free" ? "Current plan" : "Free") + "</button>" : '<button class="x-btn" type="button" data-plan="' + esc(p.id) + '">' + (cur === p.id ? "Renew" : "Choose") + "</button>") + "</div>";
    }).join("");
  }
  $("#pr-plans").addEventListener("click", function (e) {
    var b = e.target.closest("[data-plan]"); if (!b) return;
    if (!BE.user()) { $("#x-pricing").hidden = true; openAuth("up"); return; }
    PAYPLAN = PLANS.filter(function (p) { return p.id === b.dataset.plan; })[0];
    if (!METHODS.length) { toast("Admin ne abhi payment method add nahi kiya. WhatsApp karein.", true); window.open(waLink(), "_blank"); return; }
    $("#pr-step1").hidden = true; $("#pr-step2").hidden = false;
    $("#pr-plan").textContent = PAYPLAN.name; $("#pr-amount").textContent = "Rs " + fmt(PAYPLAN.price_pkr) + "  ($" + PAYPLAN.price_usd + ")";
    $("#pr-step3txt").textContent = SITE.auto_activate ? "Submit karte hi plan active ho jayega (admin baad mein check karega)." : "Admin approve karte hi plan active (aam taur par kuch ghante).";
    $("#pr-methods").innerHTML = METHODS.map(function (m, i) { return '<button type="button" data-m="' + m.id + '" aria-selected="' + (i ? "false" : "true") + '">' + esc(m.title) + "</button>"; }).join("");
    showMethod(METHODS[0]);
  });
  $("#pr-methods").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; $$("#pr-methods button").forEach(function (o) { o.setAttribute("aria-selected", o === b ? "true" : "false"); }); showMethod(METHODS.filter(function (m) { return String(m.id) === b.dataset.m; })[0]); });
  function showMethod(m) {
    PAYMETHOD = m; if (!m) return;
    var rows = [["Account name", m.account_name], ["Account / mobile no.", m.account_number], ["Bank", m.bank_name], ["IBAN", m.iban]].filter(function (r) { return r[1]; });
    $("#pr-method").innerHTML = (m.qr_url ? '<img class="x-qr" src="' + esc(m.qr_url) + '" alt="' + esc(m.title) + ' QR code">' : "") +
      rows.map(function (r) { return '<div class="x-acc-row"><span>' + r[0] + "</span><b>" + esc(r[1]) + "</b></div>"; }).join("") + (m.instructions ? '<p class="x-help">' + esc(m.instructions) + "</p>" : "");
  }
  $("#pr-back").addEventListener("click", function () { $("#pr-step1").hidden = false; $("#pr-step2").hidden = true; });
  $("#pr-form").addEventListener("submit", function (e) {
    e.preventDefault(); var b = $("button[type=submit]", this), tid = $("#pr-tid").value.trim(), f = $("#pr-shot").files[0];
    T.busy(b, true, "Submitting…"); $("#pr-msg").textContent = "";
    var up = f ? BE.upload("payment-proofs", BE.user().id + "/" + Date.now() + "-" + f.name.replace(/[^\w.]/g, "_"), f) : Promise.resolve(null);
    up.then(function (path) { return BE.call("pay", { plan_id: PAYPLAN.id, method_id: PAYMETHOD.id, tid: tid, screenshot_url: path }); })
      .then(function (r) {
        $("#pr-msg").textContent = r.status === "approved" ? "Plan active ho gaya ✓" : "Payment submit ho gayi. Admin approve karte hi plan active hoga.";
        $("#pr-tid").value = ""; refreshMe(); if (r.status === "approved") loadDataSoon();
      }).catch(function (er) { $("#pr-msg").textContent = er.message; }).then(function () { T.busy(b, false); });
  });
  function loadDataSoon() { var r = $("#x-refresh"); if (r) r.click(); }
  BE.onAuth(function () { setTimeout(loadDataSoon, 300); });

  /* ================= theme ================= */
  function setTheme(t) { document.body.classList.toggle("x-dark", t === "dark"); store.set("theme", t); $$("#set-theme button").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.v === t ? "true" : "false"); }); }
  setTheme(store.get("theme", "light"));
  $("#set-theme").addEventListener("segchange", function () { setTheme(T.$('#set-theme button[aria-pressed="true"]').dataset.v); });

  /* ================= HOME ================= */
  function renderGreeting() {
    var d = new Date(), h = d.getHours();
    $("#hm-date").textContent = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    var nm = ME && ME.profile ? (ME.profile.full_name || ME.profile.email.split("@")[0]).split(" ")[0] : "";
    $("#hm-greet").textContent = (h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening") + (nm ? ", " + nm : "");
  }
  renderGreeting();
  function renderHome() {
    var d = T.data();
    if (d) { $("#hm-total").textContent = fmt(d.totalChannels || (d.channels || []).length); var n24 = (d.channels || []).length; $("#hm-new").textContent = n24 ? "+" + fmt(n24) : ""; }
    // my channel block
    var mine = store.get("mych", null);
    if (mine) {
      $("#hm-mine").hidden = true; $("#hm-chan").hidden = false;
      $("#hm-chan").innerHTML = '<p class="x-eyebrow">Your channel</p><div class="x-myhead">' + img(mine.thumb, mine.title, 64) + '<div><h3>' + esc(mine.title) + '</h3><p class="x-meta">' + esc(mine.handle || "") + '</p></div></div><div class="x-mystats"><div><b>' + fmt(mine.subs) + '</b><span>Subscribers</span></div><div><b>' + fmt(mine.views30) + '</b><span>Views, 30 days</span></div><div><b>' + (MAP && MAP.center === mine.id ? Object.keys(MAP.nodes).length - 1 : "–") + '</b><span>Competitors</span></div></div><div class="x-liverow"><button class="x-btn" type="button" data-go="map">Open the map</button><button class="x-btn x-btn--ghost" type="button" data-go="topics">Topics</button><button class="x-linkbtn" type="button" id="hm-change">Change channel</button></div>';
      $("#hm-change").onclick = function () { store.set("mych", null); renderHome(); };
    } else { $("#hm-mine").hidden = false; $("#hm-chan").hidden = true; }
    // preview of the map + around text
    if (MAP) { drawMini(); var br = Object.keys(MAP.nodes).filter(function (k) { return MAP.nodes[k].breakout >= 3; }).length; $("#hm-around").innerHTML = '<p class="x-eyebrow">Around ' + esc(MAP.nodes[MAP.center].title) + "</p><p><b>" + (Object.keys(MAP.nodes).length - 1) + "</b> channels · <b style=\"color:#d97706\">" + br + '</b> breaking out</p><button class="x-btn x-btn--ghost" type="button" data-go="map">🗺 Open the map</button>'; }
    else { $("#hm-net").innerHTML = demoMini(); }
    // breaking out: from my map if any, else from the radar
    var cards = [];
    if (MAP) {
      Object.keys(MAP.nodes).forEach(function (k) { var n = MAP.nodes[k]; (n.videos || []).forEach(function (v) { if (v.out >= 3 && v.days <= 30) cards.push({ v: v, n: n }); }); });
      cards.sort(function (a, b) { return b.v.out - a.v.out; });
      $("#hm-btitle").textContent = "Breaking out around " + MAP.nodes[MAP.center].title; $("#hm-bsub").textContent = "Recent videos far above their channel's usual views, biggest first.";
    } else if (d) {
      (d.channels || []).filter(function (c) { return !c.locked && c.topVideo && c.topVideo.id; }).forEach(function (c) { var t = c.topVideo; cards.push({ v: { id: t.id, title: t.title, views: t.views, out: t.outlier || 0, at: c.breakoutAt, dur: t.durationSec || 0 }, n: { title: c.title, thumb: c.thumbnail, subs: c.subscribers, id: c.id } }); });
    }
    $("#hm-break").innerHTML = cards.length ? cards.slice(0, 16).map(function (c) {
      var v = c.v, n = c.n;
      return '<a class="x-vcard" href="' + T.ytv(v.id) + '" target="_blank" rel="noopener"><div class="x-vthumb" style="background-image:url(\'https://i.ytimg.com/vi/' + esc(v.id) + '/mqdefault.jpg\')">' + (v.dur ? '<span class="x-dur">' + durTxt(v.dur) + "</span>" : "") + '</div><div class="x-vmeta"><span class="x-xb">' + (v.out >= 10 ? Math.round(v.out) : v.out.toFixed(1)) + "×</span>" + fmt(v.views) + " views" + (v.at ? " · " + T.ago(v.at) : "") + "</div><p>" + esc(v.title) + '</p><div class="x-vch">' + (n.thumb ? '<img src="' + esc(n.thumb) + '" alt="" referrerpolicy="no-referrer">' : "") + esc(n.title) + " · " + fmt(n.subs) + " subscribers</div></a>";
    }).join("") : '<div class="x-card" style="grid-column:1/-1">' + T.empty("Abhi koi breakout nahi.", "Apna channel daal kar Find competitors dabayein.") + "</div>";
    renderOutl(); renderNiches(d);
  }
  var HMWIN = "24h", HMCACHE = {};
  function renderOutl() {
    var d = HMWIN === "24h" ? T.data() : HMCACHE[HMWIN];
    if (!d && HMWIN !== "24h") {
      $("#hm-outl").innerHTML = T.empty("Loading…");
      (BE.ready ? BE.call("radar", { window: HMWIN }) : Promise.resolve(T.data())).then(function (r) { HMCACHE[HMWIN] = r; renderOutl(); }).catch(function () {});
      return;
    }
    var list = ((d && d.channels) || []).slice(0, 8);
    $("#hm-outl").innerHTML = list.length ? list.map(function (c) {
      var o = (c.topVideo || {}).outlier || 0, bars = Math.min(4, Math.ceil(Math.log10(o + 1) * 2));
      var barhtml = '<span style="display:inline-flex;gap:3px;margin-top:4px">' + [0, 1, 2, 3].map(function (i) { return '<i style="width:18px;height:3px;border-radius:2px;background:' + (i < bars ? (o >= 10 ? "#5b5bf6" : "#22c55e") : "#e5e7eb") + '"></i>'; }).join("") + "</span>";
      if (c.locked) return '<div class="x-orow x-locked"><div class="x-oth x-blur" style="background:' + T.thumbStyle(null, T.hash(String(c.subscribers))).replace("background:", "") + '"></div><div class="x-blur"><b>Hidden channel</b><span class="x-meta">' + fmt(c.subscribers) + ' subscribers</span></div><div class="x-oval">' + o.toFixed(1) + "×" + barhtml + "</div></div>";
      return '<button class="x-orow x-chlink" type="button" data-open-ch="' + esc(c.id) + '" style="width:100%"><div class="x-oth" style="background-image:url(\'' + esc(c.thumbnail || "") + '\')"></div><div style="min-width:0"><b>' + esc(c.title) + '</b><span class="x-meta">' + fmt(c.subscribers) + ' subscribers</span></div><div class="x-oval">' + o.toFixed(1) + "×" + barhtml + "</div></button>";
    }).join("") + (list.some(function (c) { return c.locked; }) ? '<div class="x-unlock" style="margin:10px 0 0"><b>Unlock Niche Finder</b><span>Saare channels dekhne ke liye plan lein.</span><button class="x-btn x-btn--light" type="button" data-pricing>Get Access Now</button></div>' : "") : T.empty("Is window mein abhi koi channel nahi.");
  }
  $("#hm-win").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; $$("#hm-win button").forEach(function (o) { o.setAttribute("aria-selected", o === b ? "true" : "false"); }); HMWIN = b.dataset.v; renderOutl(); });
  function renderNiches(d) {
    var by = {};
    ((d && d.channels) || []).forEach(function (c) { var k = c.niche || "other"; var x = by[k] || (by[k] = { n: 0, views: 0, age: 0, out: 0 }); x.n++; x.views += (c.topVideo || {}).views || 0; x.age += c.ageDays || 0; x.out = Math.max(x.out, (c.topVideo || {}).outlier || 0); });
    var rows = Object.keys(by).map(function (k) { var x = by[k]; return { k: k, n: x.n, avg: x.views / x.n, age: x.age / x.n, out: x.out }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 8);
    $("#hm-niches").innerHTML = rows.length ? rows.map(function (r) {
      return '<div class="x-nrow"><div><b>' + esc(r.k) + '</b><span>' + r.n + ' new channels</span></div><div><span>Avg views</span><b>' + fmt(r.avg) + '</b></div><div><span>Avg age</span><b>' + Math.round(r.age) + 'd</b></div><div><span>Top outlier</span><b>' + Math.round(r.out) + "×</b></div></div>";
    }).join("") : T.empty("Collector ke run ke baad yahan niches aayenge.");
  }
  document.addEventListener("tr:data", renderHome);
  $("#hm-go").addEventListener("click", function () { var v = $("#hm-q").value.trim(); if (!v) { toast("Apne channel ka link ya @handle likhein.", true); return; } $("#mp-q").value = v; store.set("mychq", v); buildMapFor(v, true); });
  $("#hm-q").addEventListener("keydown", function (e) { if (e.key === "Enter") $("#hm-go").click(); });
  function demoMini() {
    var g = "", cx = 260, cy = 190;
    for (var i = 0; i < 22; i++) { var a = i * 2.4, d = 60 + (i * 37) % 120; var x = cx + Math.cos(a) * d * 1.5, y = cy + Math.sin(a) * d * 0.8; g += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x.toFixed(0) + '" y2="' + y.toFixed(0) + '" stroke="#a5b4fc" stroke-opacity=".5"/><circle cx="' + x.toFixed(0) + '" cy="' + y.toFixed(0) + '" r="' + (8 + (i * 7) % 12) + '" fill="#eef0ff" stroke="#a5a7f9" stroke-width="2"/>'; }
    return g + '<circle cx="' + cx + '" cy="' + cy + '" r="26" fill="#5b5bf6"/>';
  }

  /* ================= MAP ================= */
  var MAP = store.get("map", null), VIEW = { x: 0, y: 0, w: 1000, h: 700 }, FOCUS = null, SEL = null;
  var MF = { smin: 0, smax: 0, v30: 0, lmin: 0, lmax: 0, lang: "", br: 3, mode: "dim" };

  // read N latest uploads of channels and compute map stats (median, 30-day views, breakout, avg length, language)
  function profileChannels(chs, n) {
    return Promise.all(chs.map(function (c) { return T.uploads(c, n).then(function (ids) { return [c, ids]; }); })).then(function (pairs) {
      return T.videosById([].concat.apply([], pairs.map(function (p) { return p[1]; }))).then(function (vids) {
        var vm = {}; vids.forEach(function (v) { vm[v.id] = v; });
        return pairs.map(function (p) {
          var c = p[0], list = p[1].map(function (id) { return vm[id]; }).filter(Boolean).map(function (v) {
            return { id: v.id, title: v.snippet.title, views: +v.statistics.viewCount || 0, at: v.snippet.publishedAt, days: T.daysSince(v.snippet.publishedAt), dur: T.dur(v.contentDetails && v.contentDetails.duration) };
          });
          var longs = list.filter(function (x) { return x.dur > 180; }), base = longs.length >= 3 ? longs : list;
          var med = T.median(base.slice(0, 15).map(function (x) { return x.views; })) || 1;
          list.forEach(function (x) { x.out = x.days >= 1 ? +(x.views / med).toFixed(1) : 0; });
          var recent = list.filter(function (x) { return x.days <= 30; });
          var best = recent.slice().sort(function (a, b) { return b.out - a.out; })[0] || null;
          return {
            id: c.id, title: c.snippet.title, handle: c.snippet.customUrl || "", thumb: chThumb(c), subs: +c.statistics.subscriberCount || 0, totalViews: +c.statistics.viewCount || 0,
            videoCount: +c.statistics.videoCount || 0, created: c.snippet.publishedAt, country: c.snippet.country || "",
            views30: recent.filter(function (x) { return x.dur > 180 || longs.length < 3; }).reduce(function (s, x) { return s + x.views; }, 0),
            median: Math.round(med), breakout: best ? best.out : 0, best: best, avgLen: Math.round((longs.length ? longs : list).reduce(function (s, x) { return s + x.dur; }, 0) / Math.max((longs.length ? longs : list).length, 1)),
            lang: c.snippet.defaultLanguage || guessLang(list.slice(0, 10).map(function (x) { return x.title; })), videos: list, step: 0
          };
        });
      });
    });
  }
  function topicQueries(videos, k) {
    return T.uniq(videos.slice().sort(function (a, b) { return b.views - a.views; }).slice(0, 8).map(function (v) { return T.keywordsFromTitle(v.title); })).filter(Boolean).slice(0, k);
  }
  // one "step": search the topics of a channel's best videos, score the channels that come up, link co-occurring ones
  function neighbours(node, k, nq) {
    var qs = topicQueries(node.videos || [], nq), score = {}, sets = [];
    return qs.reduce(function (p, q) {
      return p.then(function () {
        return T.searchVideos(q, 0, { order: "relevance", maxResults: 50 }).then(function (items) {
          var set = T.uniq(items.map(function (i) { return i.snippet.channelId; })).filter(function (id) { return id !== node.id; });
          items.forEach(function (i, r) { var id = i.snippet.channelId; if (id !== node.id) score[id] = (score[id] || 0) + (1 - r / 60); });
          sets.push(set);
        });
      });
    }, Promise.resolve()).then(function () {
      return { ids: Object.keys(score).sort(function (a, b) { return score[b] - score[a]; }), score: score, sets: sets, found: Object.keys(score).length };
    });
  }
  function buildMapFor(input, mine) {
    if (T.needKey()) return;
    var depth = +$("#mp-depth").value || 1, btn = $("#mp-go");
    var est = depth === 1 ? 70 : 180;
    if (!confirm("Map banane mein lagbhag " + est + " credits lagenge (depth " + depth + "). Continue?")) return;
    T.busy(btn, true, "Mapping…"); T.go("map"); $("#map-title").textContent = "Mapping…"; $("#mp-sub").textContent = "YouTube par is channel ke topics search ho rahe hain. 20-60 second.";
    var M = { center: null, nodes: {}, edges: {}, found: 0, depth: depth, at: new Date().toISOString() };
    function edge(a, b, w) { if (a === b) return; var k = [a, b].sort().join("|"); M.edges[k] = (M.edges[k] || 0) + w; }
    T.resolveChannel(input).then(function (ch) { return profileChannels([ch], 30); }).then(function (r) {
      var c = r[0]; c.step = 0; M.center = c.id; M.nodes[c.id] = c;
      if (mine) store.set("mych", { id: c.id, title: c.title, thumb: c.thumb, subs: c.subs, views30: c.views30, handle: c.handle });
      return neighbours(c, 14, 5).then(function (nb) {
        M.found += nb.found;
        var ids = nb.ids.slice(0, 14), mx = nb.score[ids[0]] || 1;
        ids.forEach(function (id) { edge(c.id, id, nb.score[id] / mx); });
        linkSets(nb.sets, ids);
        return T.channelsById(ids).then(function (chs) { return profileChannels(chs, 15); }).then(function (ps) { ps.forEach(function (p) { p.step = 1; M.nodes[p.id] = p; }); });
      });
    }).then(function () {
      if (depth < 2) return;
      var ring1 = Object.keys(M.nodes).filter(function (k) { return M.nodes[k].step === 1; }).sort(function (a, b) { return (M.edges[[M.center, b].sort().join("|")] || 0) - (M.edges[[M.center, a].sort().join("|")] || 0); }).slice(0, 4);
      return ring1.reduce(function (p, id) {
        return p.then(function () {
          return neighbours(M.nodes[id], 6, 2).then(function (nb) {
            M.found += nb.found;
            var add = nb.ids.filter(function (x) { return !M.nodes[x]; }).slice(0, 6), mx = nb.score[nb.ids[0]] || 1;
            nb.ids.slice(0, 10).forEach(function (x) { if (M.nodes[x] || add.indexOf(x) >= 0) edge(id, x, nb.score[x] / mx * 0.8); });
            return T.channelsById(add).then(function (chs) { return profileChannels(chs, 12); }).then(function (ps) { ps.forEach(function (q) { q.step = 2; M.nodes[q.id] = q; }); });
          });
        });
      }, Promise.resolve());
    }).then(function () {
      M.hidden = Math.max(0, M.found - Object.keys(M.nodes).length + 1);
      MAP = M; layout(MAP); saveMap(); SEL = null; fit(); drawMap(); renderHome(); fillLangs();
      toast("Map ready: " + (Object.keys(M.nodes).length - 1) + " channels ✓");
    }).catch(function (e) { toast("Map failed: " + e.message, true); $("#map-title").textContent = "Map a channel's niche"; $("#mp-sub").textContent = ""; })
      .then(function () { T.busy(btn, false); });
    function linkSets(sets, ids) {
      var pairs = {};
      sets.forEach(function (s) { var inm = s.filter(function (x) { return ids.indexOf(x) >= 0; }).slice(0, 10); for (var i = 0; i < inm.length; i++) for (var j = i + 1; j < inm.length; j++) { var k = [inm[i], inm[j]].sort().join("|"); pairs[k] = (pairs[k] || 0) + 1; } });
      Object.keys(pairs).forEach(function (k) { if (pairs[k] >= 2) { var p = k.split("|"); edge(p[0], p[1], 0.25 * pairs[k]); } });
    }
  }
  function saveMap() {
    // keep localStorage small: only 15 videos per node
    var slim = JSON.parse(JSON.stringify(MAP)); Object.keys(slim.nodes).forEach(function (k) { slim.nodes[k].videos = (slim.nodes[k].videos || []).slice(0, 15); });
    store.set("map", slim);
  }
  // force-directed layout, deterministic
  function layout(M) {
    var ids = Object.keys(M.nodes), N = ids.length, P = {};
    ids.forEach(function (id, i) { var n = M.nodes[id]; var a = i * 2.39996, r = n.step * 170 + 20; P[id] = { x: 500 + Math.cos(a) * r, y: 350 + Math.sin(a) * r * 0.8, vx: 0, vy: 0 }; });
    P[M.center].x = 500; P[M.center].y = 350;
    var E = Object.keys(M.edges).map(function (k) { var p = k.split("|"); return [p[0], p[1], M.edges[k]]; }).filter(function (e) { return P[e[0]] && P[e[1]]; });
    for (var it = 0; it < 320; it++) {
      for (var i = 0; i < N; i++) for (var j = i + 1; j < N; j++) {
        var a = P[ids[i]], b = P[ids[j]], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 0.01, f = 2600 / d2;
        var d = Math.sqrt(d2); a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
      }
      E.forEach(function (e) { var a = P[e[0]], b = P[e[1]], dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1, want = 150 - Math.min(e[2], 1.5) * 50, f = (d - want) * 0.02; a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f; });
      ids.forEach(function (id) { var p = P[id]; p.vx += (500 - p.x) * 0.004; p.vy += (350 - p.y) * 0.004; if (id === M.center) { p.vx = 0; p.vy = 0; } p.x += Math.max(-20, Math.min(20, p.vx)); p.y += Math.max(-20, Math.min(20, p.vy)); p.vx *= 0.6; p.vy *= 0.6; });
    }
    ids.forEach(function (id) { M.nodes[id].x = Math.round(P[id].x); M.nodes[id].y = Math.round(P[id].y); });
  }
  function radius(n, mx) { return n.step === 0 ? 34 : 14 + 22 * Math.sqrt((n.views30 || 0) / (mx || 1)); }
  function passes(n) {
    if (n.step === 0) return true;
    if (MF.smin && n.subs < MF.smin) return false; if (MF.smax && n.subs > MF.smax) return false;
    if (MF.v30 && n.views30 < MF.v30) return false;
    if (MF.lmin && n.avgLen < MF.lmin * 60) return false; if (MF.lmax && n.avgLen > MF.lmax * 60) return false;
    if (MF.lang && n.lang !== MF.lang) return false;
    return true;
  }
  function drawMap() {
    var svg = $("#x-net");
    if (!MAP) {
      svg.innerHTML = '<text x="500" y="350" text-anchor="middle" font-size="18" fill="#646a7e" font-family="Inter, system-ui">Kisi bhi channel ka naam, link ya @handle likh kar “Map it” dabayein</text>';
      svg.setAttribute("viewBox", "0 0 1000 700"); return;
    }
    var ids = Object.keys(MAP.nodes), mx = Math.max.apply(0, ids.map(function (k) { return MAP.nodes[k].step ? MAP.nodes[k].views30 || 0 : 0; }).concat([1]));
    var ok = {}; ids.forEach(function (k) { ok[k] = passes(MAP.nodes[k]); });
    var g = '<defs>' + ids.map(function (k, i) { var n = MAP.nodes[k]; return '<clipPath id="cp' + i + '"><circle cx="' + n.x + '" cy="' + n.y + '" r="' + radius(n, mx).toFixed(1) + '"/></clipPath>'; }).join("") + "</defs>";
    var mxE = Math.max.apply(0, Object.keys(MAP.edges).map(function (k) { return MAP.edges[k]; }).concat([1]));
    Object.keys(MAP.edges).forEach(function (k) {
      var p = k.split("|"), a = MAP.nodes[p[0]], b = MAP.nodes[p[1]]; if (!a || !b) return;
      var hide = (!ok[p[0]] || !ok[p[1]]), w = MAP.edges[k] / mxE, sel = SEL && (p[0] === SEL || p[1] === SEL);
      if (hide && MF.mode === "hide") return;
      g += '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="' + (sel ? "#5b5bf6" : "#5b8fd6") + '" stroke-opacity="' + (hide ? 0.06 : SEL && !sel ? 0.1 : (0.25 + w * 0.55)).toFixed(2) + '" stroke-width="' + (1 + w * 6).toFixed(1) + '" stroke-linecap="round"/>';
    });
    ids.forEach(function (k, i) {
      var n = MAP.nodes[k], r = radius(n, mx), hide = !ok[k]; if (hide && MF.mode === "hide") return;
      var dim = hide || (SEL && SEL !== k && !MAP.edges[[SEL, k].sort().join("|")]);
      var ring = n.step === 0 ? "#38bdf8" : SEL === k ? "#5b5bf6" : "#ffffff";
      g += '<g class="x-node' + (dim ? " x-dim" : "") + '" data-id="' + esc(k) + '" tabindex="0"><title>' + esc(n.title) + " · " + fmt(n.subs) + " subs · " + fmt(n.views30) + " views/30d" + (n.breakout >= MF.br ? " · " + n.breakout + "×" : "") + "</title>";
      g += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + (r + 2.5).toFixed(1) + '" fill="' + ring + '" stroke="' + (n.step === 0 ? "#38bdf8" : "#d6d9e4") + '" stroke-width="1.5"/>';
      if (n.thumb) g += '<image href="' + esc(n.thumb) + '" x="' + (n.x - r).toFixed(1) + '" y="' + (n.y - r).toFixed(1) + '" width="' + (2 * r).toFixed(1) + '" height="' + (2 * r).toFixed(1) + '" clip-path="url(#cp' + i + ')" preserveAspectRatio="xMidYMid slice"/>';
      else g += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + r.toFixed(1) + '" fill="#eef0ff"/><text x="' + n.x + '" y="' + (n.y + 4) + '" text-anchor="middle" font-size="11" font-weight="700" fill="#4141d4">' + esc(T.initials(n.title)) + "</text>";
      if (n.breakout >= MF.br && n.step) g += '<g><rect x="' + (n.x + r * 0.35).toFixed(1) + '" y="' + (n.y - r - 8).toFixed(1) + '" rx="8" width="' + (12 + String(Math.round(n.breakout)).length * 7 + 8) + '" height="17" fill="#fef3c7" stroke="#f59e0b"/><text x="' + (n.x + r * 0.35 + 6).toFixed(1) + '" y="' + (n.y - r + 4).toFixed(1) + '" font-size="11" font-weight="700" fill="#b45309">' + Math.round(n.breakout) + "×</text></g>";
      if (n.step === 0 || SEL === k || r > 26) g += '<text x="' + n.x + '" y="' + (n.y + r + 16).toFixed(1) + '" text-anchor="middle" font-size="12" font-weight="600" fill="#2b2f45" paint-order="stroke" stroke="#fff" stroke-width="3">' + esc(n.title.length > 26 ? n.title.slice(0, 25) + "…" : n.title) + "</text>";
      g += "</g>";
    });
    svg.innerHTML = '<g font-family="Inter, system-ui, sans-serif">' + g + "</g>";
    setVB();
    var c = MAP.nodes[MAP.center], n = ids.length - 1, br = ids.filter(function (k) { return MAP.nodes[k].step && MAP.nodes[k].breakout >= MF.br; }).length;
    $("#map-title").textContent = "Around " + c.title; $("#mp-sub").textContent = n + " channels · " + br + " breaking out · depth " + MAP.depth + " · " + T.ago(MAP.at);
    $("#mp-hidden").innerHTML = MAP.hidden ? '<b class="x-tag x-tag--money">+' + fmt(MAP.hidden) + "</b> channels it found, not shown" : "";
    drawRanks();
  }
  function drawRanks() {
    var ids = Object.keys(MAP.nodes).filter(function (k) { return MAP.nodes[k].step; });
    var list = ids.map(function (k) { var n = MAP.nodes[k], age = Math.max(T.daysSince(n.created || new Date().toISOString()), 1); return { n: n, small: n.subs <= 100000, spd: n.subs / age, fast: n.subs <= 100000 && (n.breakout >= 3 || (age <= 365 && n.subs / age >= 20)) }; })
      .sort(function (a, b) { return (b.fast - a.fast) || (b.small - a.small) || (b.n.breakout - a.n.breakout) || (b.spd - a.spd); });
    $("#x-ranks").innerHTML = list.slice(0, 12).map(function (x, i) {
      var n = x.n;
      return '<div class="x-rank"><span>' + (i + 1) + '</span><button class="x-chlink" type="button" data-node="' + esc(n.id) + '" style="display:flex;align-items:center;gap:8px;min-width:0">' + img(n.thumb, n.title, 28) + '<div style="min-width:0"><b>' + esc(n.title) + '</b> <span class="x-meta">' + fmt(n.subs) + " · +" + fmt(Math.round(x.spd)) + "/day</span>" + (x.fast ? ' <span class="x-tag x-tag--money" style="font-size:12px;padding:0 6px">Fast-growing</span>' : "") + '</div></button><span class="x-close">' + (n.breakout ? n.breakout + "×" : "–") + "</span></div>";
    }).join("");
    var ideas = []; ids.forEach(function (k) { var n = MAP.nodes[k]; if (n.best && n.best.out >= 3) ideas.push(n); });
    ideas.sort(function (a, b) { return b.best.out - a.best.out; });
    $("#x-ideas").innerHTML = ideas.length ? ideas.slice(0, 6).map(function (n) {
      return '<a class="x-link x-idea" href="' + T.ytv(n.best.id) + '" target="_blank" rel="noopener">✦<span>' + esc(n.best.title) + '<br><span class="x-meta">' + esc(n.title) + " · " + fmt(n.best.views) + " views · " + n.best.out + "×</span></span></a>";
    }).join("") : '<p class="x-meta">Abhi koi breakout nahi mila.</p>';
  }
  function drawMini() {
    var ids = Object.keys(MAP.nodes), g = "", c = MAP.nodes[MAP.center], sx = 520 / 1000, sy = 380 / 700;
    Object.keys(MAP.edges).forEach(function (k) { var p = k.split("|"), a = MAP.nodes[p[0]], b = MAP.nodes[p[1]]; if (a && b) g += '<line x1="' + a.x * sx + '" y1="' + a.y * sy + '" x2="' + b.x * sx + '" y2="' + b.y * sy + '" stroke="#5b8fd6" stroke-opacity=".45" stroke-width="2"/>'; });
    ids.forEach(function (k, i) { var n = MAP.nodes[k], r = n.step === 0 ? 20 : 13; g += '<clipPath id="mc' + i + '"><circle cx="' + n.x * sx + '" cy="' + n.y * sy + '" r="' + r + '"/></clipPath><circle cx="' + n.x * sx + '" cy="' + n.y * sy + '" r="' + (r + 2) + '" fill="#fff" stroke="' + (n.step ? "#d6d9e4" : "#38bdf8") + '"/>' + (n.thumb ? '<image href="' + esc(n.thumb) + '" x="' + (n.x * sx - r) + '" y="' + (n.y * sy - r) + '" width="' + 2 * r + '" height="' + 2 * r + '" clip-path="url(#mc' + i + ')"/>' : ""); if (n.step && n.breakout >= 3) g += '<text x="' + (n.x * sx + 8) + '" y="' + (n.y * sy - 12) + '" font-size="10" font-weight="700" fill="#b45309">' + Math.round(n.breakout) + "×</text>"; });
    $("#hm-net").innerHTML = '<g font-family="Inter, system-ui">' + g + "</g>";
  }
  /* pan & zoom */
  function setVB() { $("#x-net").setAttribute("viewBox", VIEW.x.toFixed(0) + " " + VIEW.y.toFixed(0) + " " + VIEW.w.toFixed(0) + " " + VIEW.h.toFixed(0)); }
  function fit() {
    if (!MAP) return; var ids = Object.keys(MAP.nodes), xs = ids.map(function (k) { return MAP.nodes[k].x; }), ys = ids.map(function (k) { return MAP.nodes[k].y; });
    var x0 = Math.min.apply(0, xs) - 80, x1 = Math.max.apply(0, xs) + 80, y0 = Math.min.apply(0, ys) - 80, y1 = Math.max.apply(0, ys) + 80;
    var w = Math.max(x1 - x0, (y1 - y0) * 1.5), h = w / 1.5; VIEW = { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w: w, h: h }; setVB();
  }
  function zoom(f, cx, cy) { cx = cx == null ? VIEW.x + VIEW.w / 2 : cx; cy = cy == null ? VIEW.y + VIEW.h / 2 : cy; VIEW = { x: cx - (cx - VIEW.x) * f, y: cy - (cy - VIEW.y) * f, w: VIEW.w * f, h: VIEW.h * f }; setVB(); }
  $("#mp-zin").addEventListener("click", function () { zoom(0.8); });
  $("#mp-zout").addEventListener("click", function () { zoom(1.25); });
  $("#mp-zfit").addEventListener("click", fit);
  (function () {
    var svg = $("#x-net"), drag = null, moved = false;
    svg.addEventListener("wheel", function (e) { if (!MAP) return; e.preventDefault(); var r = svg.getBoundingClientRect(); zoom(e.deltaY > 0 ? 1.12 : 0.89, VIEW.x + (e.clientX - r.left) / r.width * VIEW.w, VIEW.y + (e.clientY - r.top) / r.height * VIEW.h); }, { passive: false });
    svg.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY, vx: VIEW.x, vy: VIEW.y }; moved = false; });
    window.addEventListener("pointermove", function (e) { if (!drag) return; var r = svg.getBoundingClientRect(), dx = (e.clientX - drag.x) / r.width * VIEW.w, dy = (e.clientY - drag.y) / r.height * VIEW.h; if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) moved = true; VIEW.x = drag.vx - dx; VIEW.y = drag.vy - dy; setVB(); });
    window.addEventListener("pointerup", function () { drag = null; });
    svg.addEventListener("click", function (e) { if (moved) return; var g = e.target.closest(".x-node"); if (g) selectNode(g.dataset.id); else if (SEL) { SEL = null; $("#mp-panel").hidden = true; drawMap(); } });
    svg.addEventListener("keydown", function (e) { if (e.key === "Enter") { var g = e.target.closest(".x-node"); if (g) selectNode(g.dataset.id); } });
  })();
  $("#x-ranks").addEventListener("click", function (e) { var b = e.target.closest("[data-node]"); if (b) selectNode(b.dataset.node); });

  /* channel panel (like Makina's) */
  var PTAB = "videos", PSORT = "latest";
  function selectNode(id) {
    if (!MAP || !MAP.nodes[id]) { T.openChannel(id); return; }
    SEL = id; drawMap(); drawPanel();
  }
  function drawPanel() {
    var n = MAP.nodes[SEL], p = $("#mp-panel"); p.hidden = false;
    var conns = Object.keys(MAP.edges).filter(function (k) { return k.split("|").indexOf(SEL) >= 0; }).map(function (k) { var o = k.split("|").filter(function (x) { return x !== SEL; })[0]; return { n: MAP.nodes[o], w: MAP.edges[k] }; }).filter(function (x) { return x.n; }).sort(function (a, b) { return b.w - a.w; });
    var started = n.created ? T.ago(n.created).replace(/d ago$/, " days ago") : "";
    var saved = savedCh().some(function (c) { return c.id === n.id; });
    var vids = (n.videos || []).slice();
    if (PSORT === "popular") vids.sort(function (a, b) { return b.views - a.views; });
    var best = n.best;
    p.innerHTML = '<div class="x-chtop">' + img(n.thumb, n.title, 56) + '<div style="min-width:0"><h3 title="' + esc(n.title) + '">' + esc(n.title) + '</h3><p class="x-meta">' + (n.step === 0 ? "Center of the map" : n.step + (n.step === 1 ? " step" : " steps") + " from " + esc(MAP.nodes[MAP.center].title)) + (started ? " · started " + esc(started) : "") + (n.country ? " · " + esc(n.country) : "") + '</p></div><div class="x-liverow" style="margin:0;gap:4px"><a class="x-btn x-btn--ghost x-mini" href="' + T.ytc(n.id) + '" target="_blank" rel="noopener" title="Open on YouTube">↗</a><button class="x-btn x-btn--ghost x-mini" type="button" id="pn-close" aria-label="Close">✕</button></div></div>' +
      '<div class="x-statbox"><div><b>' + fmt(n.subs) + '</b><span>Subscribers</span></div><div><b>' + fmt(n.views30) + '</b><span>Views, 30 days</span></div><div><b>' + fmt(n.median) + '</b><span>Usual views (median)</span></div><div><b>' + durTxt(n.avgLen) + '</b><span>Average length</span></div></div>' +
      (best ? '<a class="x-best" href="' + T.ytv(best.id) + '" target="_blank" rel="noopener"><div class="x-vthumb" style="background-image:url(\'https://i.ytimg.com/vi/' + esc(best.id) + '/mqdefault.jpg\')"></div><div><span class="x-meta">Best video lately</span><br><big>' + best.out + '×</big> <span class="x-meta">its usual</span><br><b style="font-size:13px">' + esc(best.title.slice(0, 80)) + "</b></div></a>" : "") +
      '<div class="x-btnrow"><button class="x-btn x-btn--ghost" type="button" id="pn-center">⌖ Center here</button><button class="x-btn" type="button" id="pn-mesh">Map it</button><button class="x-btn" type="button" id="pn-json">⬇ Download JSON</button><button class="x-btn x-btn--ghost" type="button" id="pn-save">' + (saved ? "★ Saved" : "☆ Save") + '</button><button class="x-btn x-btn--ghost" type="button" id="pn-learn">+ Learn from it</button><button class="x-btn x-btn--ghost" type="button" id="pn-all">All videos</button></div>' +
      '<div class="x-seg" style="width:100%;display:grid;grid-template-columns:1fr 1fr" id="pn-tabs"><button data-v="videos" aria-pressed="' + (PTAB === "videos") + '">Videos</button><button data-v="conn" aria-pressed="' + (PTAB === "conn") + '">Connections · ' + conns.length + "</button></div>" +
      (PTAB === "videos" ? '<div class="x-seg" id="pn-sort"><button data-v="latest" aria-pressed="' + (PSORT === "latest") + '">Latest</button><button data-v="popular" aria-pressed="' + (PSORT === "popular") + '">Popular</button></div><div>' + vids.map(function (v) {
        return '<div class="x-pv"><a class="x-vthumb" href="' + T.ytv(v.id) + '" target="_blank" rel="noopener" style="background-image:url(\'https://i.ytimg.com/vi/' + esc(v.id) + '/mqdefault.jpg\')"><span class="x-dur">' + durTxt(v.dur) + '</span></a><div style="min-width:0"><p>' + esc(v.title) + '</p><span class="x-meta">' + (v.out >= 2 ? '<span class="x-xb">' + v.out + "×</span> " : v.out ? v.out + "× · " : "") + fmt(v.views) + " views · " + T.ago(v.at) + '</span><div class="x-liverow"><button class="x-btn x-btn--ghost x-mini" type="button" data-tr="' + esc(v.id) + '">Transcript</button><button class="x-btn x-btn--ghost x-mini" type="button" data-rw="' + esc(v.id) + '">Rewrite</button><button class="x-btn x-btn--ghost x-mini" type="button" data-swipe="' + esc(v.id) + '" data-t="' + esc(v.title) + '" data-ch="' + esc(n.title) + '" data-views="' + v.views + '" data-out="' + v.out + '">☆</button></div></div></div>';
      }).join("") + "</div>" : "<div>" + conns.map(function (c) { return '<div class="x-rank"><span></span><button class="x-chlink" type="button" data-node="' + esc(c.n.id) + '" style="display:flex;align-items:center;gap:8px">' + img(c.n.thumb, c.n.title, 28) + "<div><b>" + esc(c.n.title) + '</b> <span class="x-meta">' + fmt(c.n.subs) + '</span></div></button><span class="x-close">' + (c.n.breakout ? c.n.breakout + "×" : "") + "</span></div>"; }).join("") + "</div>");
    $("#pn-close").onclick = function () { SEL = null; p.hidden = true; drawMap(); };
    $("#pn-center").onclick = function () { VIEW.x = n.x - VIEW.w / 2; VIEW.y = n.y - VIEW.h / 2; setVB(); };
    $("#pn-mesh").onclick = function () { $("#mp-q").value = n.id; buildMapFor(n.id, false); };
    $("#pn-json").onclick = function () { strategyFor(n.id, this); };
    $("#pn-all").onclick = function () { T.openChannel(n.id); };
    $("#pn-save").onclick = function () { toggleSave(n); drawPanel(); };
    $("#pn-learn").onclick = function () { addLearn({ id: n.id, title: n.title, thumb: n.thumb }); toast("Topics mein add ho gaya ✓"); };
    $("#pn-tabs").onclick = function (e) { var b = e.target.closest("button"); if (b) { PTAB = b.dataset.v; drawPanel(); } };
    var so = $("#pn-sort"); if (so) so.onclick = function (e) { var b = e.target.closest("button"); if (b) { PSORT = b.dataset.v; drawPanel(); } };
    p.onclick = function (e) { var b = e.target.closest("[data-node]"); if (b) selectNode(b.dataset.node); var s = e.target.closest("[data-swipe]"); if (s) { addSwipe({ id: s.dataset.swipe, title: s.dataset.t, channel: s.dataset.ch, views: +s.dataset.views, out: +s.dataset.out }); s.textContent = "★"; } };
  }
  // reuse the analyzer's strategy-JSON flow for any channel, without leaving the page
  function strategyFor(id, btn) {
    if (T.needKey()) return;
    T.busy(btn, true, "Building…");
    $("#an-q").value = id;
    T.runAnalyze().then(function () { if (T.current() && T.current().ch.id === id) $("#an-json").click(); }).then(function () { T.busy(btn, false); }, function () { T.busy(btn, false); });
  }
  $("#mp-go").addEventListener("click", function () { var v = $("#mp-q").value.trim(); if (!v) { toast("Channel ka naam, link ya @handle likhein.", true); return; } buildMapFor(v, false); });
  $("#mp-q").addEventListener("keydown", function (e) { if (e.key === "Enter") $("#mp-go").click(); });
  $("#mp-depth").addEventListener("input", function () { $("#mp-depthv").textContent = this.value; $("#mp-depthtext").textContent = this.value === "1" ? "One step out: the channels YouTube shows for the same topics as this channel. ~70 credits." : "Two steps out: also the channels next to its 4 closest competitors. ~180 credits."; });
  $("#mp-filt").addEventListener("click", function () { $("#mp-filters").hidden = !$("#mp-filters").hidden; });
  function fillLangs() { if (!MAP) return; var l = T.uniq(Object.keys(MAP.nodes).map(function (k) { return MAP.nodes[k].lang; })); $("#mf-lang").innerHTML = '<option value="">Any</option>' + l.map(function (x) { return "<option>" + esc(x) + "</option>"; }).join(""); }
  ["#mf-smin", "#mf-smax", "#mf-v30", "#mf-lmin", "#mf-lmax", "#mf-lang", "#mf-br"].forEach(function (s) { $(s).addEventListener("change", readMF); });
  $("#mf-mode").addEventListener("segchange", readMF);
  $("#mf-reset").addEventListener("click", function () { ["#mf-smin", "#mf-smax", "#mf-v30", "#mf-lmin", "#mf-lmax"].forEach(function (s) { $(s).value = ""; }); $("#mf-lang").value = ""; $("#mf-br").value = "3"; readMF(); });
  function readMF() { MF = { smin: +$("#mf-smin").value || 0, smax: +$("#mf-smax").value || 0, v30: +$("#mf-v30").value || 0, lmin: +$("#mf-lmin").value || 0, lmax: +$("#mf-lmax").value || 0, lang: $("#mf-lang").value, br: +$("#mf-br").value || 3, mode: (T.$('#mf-mode button[aria-pressed="true"]') || {}).dataset ? $('#mf-mode button[aria-pressed="true"]').dataset.v : "dim" }; drawMap(); }
  $("#mp-export").addEventListener("click", function () {
    if (!MAP) { toast("Pehle map banayein.", true); return; }
    var out = { tool: SITE.site_name, generatedAt: MAP.at, center: MAP.nodes[MAP.center].title, depth: MAP.depth, channels: Object.keys(MAP.nodes).map(function (k) { var n = MAP.nodes[k]; return { name: n.title, link: T.ytc(n.id), stepsFromCenter: n.step, subscribers: n.subs, viewsLast30Days: n.views30, usualViews: n.median, averageLengthSec: n.avgLen, language: n.lang, breakout: n.breakout, videos: (n.videos || []).slice(0, 15).map(function (v) { return { title: v.title, url: T.ytv(v.id), views: v.views, date: v.at, lengthSec: v.dur, outlier: v.out }; }) }; }),
      links: Object.keys(MAP.edges).map(function (k) { var p = k.split("|"); return { a: (MAP.nodes[p[0]] || {}).title, b: (MAP.nodes[p[1]] || {}).title, strength: +MAP.edges[k].toFixed(2) }; }) };
    var txt = JSON.stringify(out, null, 2);
    if (confirm("JSON download karein? (Cancel = clipboard par copy, ChatGPT/Claude mein paste karne ke liye)")) T.download("map-" + MAP.center + ".json", txt, "application/json");
    else (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast("Map copied ✓"); }, function () { T.download("map-" + MAP.center + ".json", txt, "application/json"); });
  });
  $("#mp-chatbtn").addEventListener("click", function () { openBot("map"); });
  $("#an-map").addEventListener("click", function () { var v = $("#an-q").value.trim(); if (!v) { toast("Channel URL ya @handle paste karein.", true); return; } $("#mp-q").value = v; buildMapFor(v, false); });

  /* ================= research chat (Map chat + general) ================= */
  var BOT = { mode: "general", hist: [] };
  var SUGG = {
    map: ["Which channels on my map are doing best lately?", "Which small channels are blowing up right now?", "What is the closest competitor uploading lately?", "Give me 5 video ideas from these breakouts"],
    general: ["Aaj kaun se naye channels sab se tez grow kar rahe hain?", "Tier-1 mein kaun sa niche abhi khaali hai?", "Monetized new channels ki list do", "AVP list mein best 5 channels kaun se hain?"]
  };
  function openBot(mode) {
    BOT.mode = mode || (T.$(".x-view:not([hidden])").id === "view-map" && MAP ? "map" : "general");
    $("#x-bot").hidden = false; $("#x-botfab").hidden = true;
    $("#bot-title").textContent = BOT.mode === "map" ? "Ask about your map" : "Ask " + SITE.site_name;
    $("#bot-ctx").textContent = BOT.mode === "map" ? (MAP ? "Reads every channel and video on your map (" + (Object.keys(MAP.nodes).length) + " channels)." : "Pehle map banayein.") : "Reads the viral radar, AVP list and the channel you analysed.";
    $("#bot-sugg").innerHTML = BOT.hist.length ? "" : SUGG[BOT.mode].map(function (s) { return '<button class="x-preset" type="button">' + esc(s) + "</button>"; }).join("");
    $("#bot-in").focus();
  }
  $("#x-botfab").addEventListener("click", function () { openBot(); });
  $("#bot-close").addEventListener("click", function () { $("#x-bot").hidden = true; $("#x-botfab").hidden = false; });
  $("#bot-new").addEventListener("click", function () { BOT.hist = []; $("#bot-log").innerHTML = ""; openBot(BOT.mode); });
  $("#bot-sugg").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { $("#bot-in").value = b.textContent; $("#bot-form").requestSubmit(); } });
  $("#bot-form").addEventListener("submit", function (e) {
    e.preventDefault(); var q = $("#bot-in").value.trim(); if (!q) return; if (T.needKey()) return;
    $("#bot-in").value = ""; $("#bot-sugg").innerHTML = "";
    addMsg("me", esc(q)); var wait = addMsg("ai", '<span class="x-meta">Thinking… ' + (BOT.mode === "map" ? SITE.site_name + " is looking through your map" : "reading the data") + "</span>");
    lookups(q).then(function (extra) {
      var ctx = context(); if (extra.length) ctx.lookedUp = extra;
      var prompt = "You are " + SITE.site_name + "'s YouTube research assistant (like Makina's Map chat). Answer the user's question using ONLY the JSON data below; never invent numbers. " +
        "Reply in the same language and script the user writes in (Roman Urdu if they write Roman Urdu). Be concise: a short answer, then a ranked list when useful. " +
        "Whenever you mention a channel that is in the data, write it exactly as [[ch:CHANNEL_ID]] (the chip shows its name), followed by the key numbers. " +
        "Outlier/breakout = a video's views divided by the channel's usual (median) views. If the data cannot answer, say what is missing and suggest which page of the tool to use.\n\nDATA:\n" + JSON.stringify(ctx).slice(0, 90000) +
        "\n\nCONVERSATION SO FAR:\n" + BOT.hist.slice(-6).map(function (h) { return h.r + ": " + h.t; }).join("\n") + "\nuser: " + q;
      return T.gemini([{ text: prompt }], false, "chat");
    }).then(function (ans) {
      BOT.hist.push({ r: "user", t: q }); BOT.hist.push({ r: "assistant", t: ans.slice(0, 2000) });
      wait.innerHTML = chips(ans);
    }).catch(function (er) { wait.innerHTML = '<span class="x-meta">Error: ' + esc(er.message) + "</span>"; });
  });
  function addMsg(who, html) { var d = document.createElement("div"); d.className = "x-msg x-msg--" + who; d.innerHTML = html; $("#bot-log").appendChild(d); d.scrollIntoView({ block: "end" }); return d; }
  var CHIPS = {};
  function chips(t) {
    var h = esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    return h.replace(/\[\[ch:([\w-]+)\]\]/g, function (_, id) {
      var c = CHIPS[id] || {}; return '<button class="x-chchip" type="button" data-chip="' + esc(id) + '">' + (c.thumb ? '<img src="' + esc(c.thumb) + '" alt="" referrerpolicy="no-referrer">' : "") + esc(c.title || id) + (c.subs != null ? ' <span class="x-meta">' + fmt(c.subs) + "</span>" : "") + (c.br >= 3 ? ' <span class="x-xb">' + Math.round(c.br) + "×</span>" : "") + "</button>";
    });
  }
  $("#bot-log").addEventListener("click", function (e) { var b = e.target.closest("[data-chip]"); if (!b) return; var id = b.dataset.chip; if (MAP && MAP.nodes[id]) { T.go("map"); selectNode(id); var n = MAP.nodes[id]; VIEW.x = n.x - VIEW.w / 2; VIEW.y = n.y - VIEW.h / 2; setVB(); } else T.openChannel(id); });
  function reg(id, title, thumb, subs, br) { CHIPS[id] = { title: title, thumb: thumb, subs: subs, br: br }; }
  function context() {
    var ctx = { today: new Date().toISOString().slice(0, 10) };
    if (MAP && (BOT.mode === "map" || true)) {
      ctx.map = { center: MAP.center, depth: MAP.depth, channels: Object.keys(MAP.nodes).map(function (k) { var n = MAP.nodes[k]; reg(n.id, n.title, n.thumb, n.subs, n.breakout); return { id: n.id, name: n.title, steps: n.step, subs: n.subs, views30d: n.views30, usualViews: n.median, breakout: n.breakout, avgLenSec: n.avgLen, lang: n.lang, created: (n.created || "").slice(0, 10), recent: (n.videos || []).slice(0, 8).map(function (v) { return { t: v.title, views: v.views, out: v.out, days: v.days }; }) }; }) };
    }
    var d = T.data();
    if (d && BOT.mode !== "map") {
      ctx.viralRadar24h = (d.channels || []).filter(function (c) { return !c.locked; }).slice(0, 60).map(function (c) { reg(c.id, c.title, c.thumbnail, c.subscribers, (c.topVideo || {}).outlier); return { id: c.id, name: c.title, niche: c.niche, subs: c.subscribers, ageDays: c.ageDays, country: c.country, subsPerDay: c.subsPerDay, monetizationEstimate: c.monet && c.monet.eligible, bestVideo: c.topVideo && { t: c.topVideo.title, views: c.topVideo.views, outlier: c.topVideo.outlier } }; });
      ctx.avp30d = (d.avpChannels || []).filter(function (c) { return !c.locked; }).slice(0, 40).map(function (c) { reg(c.id, c.title, c.thumbnail, c.subscribers); return { id: c.id, name: c.title, niche: c.niche, subs: c.subscribers, avp30: c.avp30, ratio: c.avpRatio }; });
      var lk = (d.channels || []).filter(function (c) { return c.locked; }).length; if (lk) ctx.note = lk + " more channels are hidden on the user's free plan.";
    }
    var cur = T.current();
    if (cur) { reg(cur.ch.id, cur.ch.snippet.title, chThumb(cur.ch), +cur.ch.statistics.subscriberCount); ctx.analysedChannel = { id: cur.ch.id, name: cur.ch.snippet.title, subs: +cur.ch.statistics.subscriberCount, median: cur.median, videos: cur.vids.slice(0, 25).map(function (v) { return { t: v.snippet.title, views: +v.statistics.viewCount, at: v.snippet.publishedAt.slice(0, 10) }; }) }; }
    return ctx;
  }
  // "@handle" in the question -> look the channel up on YouTube (~3 credits each, max 2)
  function lookups(q) {
    var hs = T.uniq((q.match(/@[\w.\-]{3,}/g) || [])).slice(0, 2);
    return Promise.all(hs.map(function (h) {
      return T.resolveChannel(h).then(function (ch) { return profileChannels([ch], 15); }).then(function (r) { var n = r[0]; reg(n.id, n.title, n.thumb, n.subs, n.breakout); return { id: n.id, name: n.title, subs: n.subs, views30d: n.views30, usualViews: n.median, breakout: n.breakout, recent: n.videos.slice(0, 12).map(function (v) { return { t: v.title, views: v.views, out: v.out, days: v.days }; }) }; }).catch(function () { return { handle: h, error: "not found" }; });
    }));
  }

  /* ================= TOPICS ================= */
  function learnList() { return store.get("learn", []); }
  function addLearn(c) { var l = learnList(); if (!l.some(function (x) { return x.id === c.id; })) { l.push(c); store.set("learn", l.slice(0, 25)); } drawLearn(); }
  function drawLearn() {
    var l = learnList();
    $("#tp-learn").innerHTML = l.length ? l.map(function (c, i) { return '<span class="x-kchip">' + esc(c.title) + '<button type="button" data-i="' + i + '" aria-label="Leave out ' + esc(c.title) + '">×</button></span>'; }).join("") : '<span class="x-meta">None yet: Find competitors dabayein, ya Map se channels "Learn from it" karein.</span>';
  }
  $("#tp-learn").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; var l = learnList(); l.splice(+b.dataset.i, 1); store.set("learn", l); drawLearn(); });
  $("#tp-add").addEventListener("submit", function (e) { e.preventDefault(); var inp = $("input", this), v = inp.value.trim(); if (!v || T.needKey()) return; T.resolveChannel(v).then(function (c) { addLearn({ id: c.id, title: c.snippet.title, thumb: chThumb(c) }); inp.value = ""; }).catch(function (er) { toast(er.message, true); }); });
  $("#tp-find").addEventListener("click", function () {
    var v = $("#tp-q").value.trim() || store.get("mychq", ""); if (!v) { toast("Apna channel likhein.", true); return; }
    store.set("mychq", v);
    if (MAP && store.get("mych", {}) && MAP.center === (store.get("mych", {}) || {}).id) { pickFromMap(); return; }
    toast("Pehle aapke channel ka map banega, phir competitors yahan aa jayenge.");
    buildMapFor(v, true);
    var iv = setInterval(function () { if (MAP && MAP.center === (store.get("mych", {}) || {}).id) { clearInterval(iv); pickFromMap(); T.go("topics"); } }, 2000);
    setTimeout(function () { clearInterval(iv); }, 180000);
  });
  function pickFromMap() { Object.keys(MAP.nodes).filter(function (k) { return MAP.nodes[k].step === 1; }).sort(function (a, b) { return MAP.nodes[b].breakout - MAP.nodes[a].breakout; }).slice(0, 8).forEach(function (k) { var n = MAP.nodes[k]; addLearn({ id: n.id, title: n.title, thumb: n.thumb }); }); toast("Competitors add ho gaye ✓"); }
  var TOP = { list: [], hist: [] };
  $("#tp-check").addEventListener("click", function () { this.setAttribute("aria-pressed", this.getAttribute("aria-pressed") !== "true"); });
  $("#tp-go").addEventListener("click", function () { genTopics(""); });
  $("#tp-more").addEventListener("submit", function (e) { e.preventDefault(); var v = $("#tp-morein").value.trim(); if (v) { $("#tp-morein").value = ""; genTopics(v); } });
  $("#tp-ask").addEventListener("click", function () { openBot("general"); });
  function genTopics(follow) {
    if (T.needKey()) return;
    var mine = $("#tp-q").value.trim() || store.get("mychq", ""), learn = learnList();
    if (!mine) { toast("Apna channel likhein.", true); return; }
    if (!learn.length) { toast("Pehle kam az kam ek competitor add karein (Find competitors).", true); return; }
    var btn = $("#tp-go"); T.busy(btn, true, "Studying…");
    $("#tp-title").textContent = SITE.site_name + " is studying your competitors…"; $("#tp-sub").textContent = "Learning from: " + learn.map(function (c) { return c.title; }).join(", ") + ". 30-90 second.";
    var nTop = Math.max(1, Math.min(20, +$("#tp-n").value || 8)), nTit = Math.max(1, Math.min(10, +$("#tp-t").value || 5));
    var mineP = T.resolveChannel(mine).then(function (c) { return profileChannels([c], 30); });
    var compP = T.channelsById(learn.map(function (c) { return c.id; }).slice(0, 12)).then(function (chs) { return profileChannels(chs, 20); });
    Promise.all([mineP, compP]).then(function (r) {
      var me = r[0][0], comps = r[1];
      var data = { myChannel: { name: me.title, subs: me.subs, usualViews: me.median, videos: me.videos.slice(0, 30).map(function (v) { return { t: v.title, views: v.views, out: v.out }; }) },
        competitors: comps.map(function (c) { return { name: c.title, subs: c.subs, usualViews: c.median, videos: c.videos.slice(0, 20).map(function (v) { return { t: v.title, views: v.views, out: v.out, days: v.days }; }) }; }) };
      var prompt = "You are a YouTube strategist. Using the data, suggest " + nTop + " NEW video topics for MY channel, in my channel's style and language, learning from what is breaking out for my competitors (high 'out' = views / channel median). " +
        "Do not copy titles. Return ONLY JSON: {\"topics\":[{\"topic_short\":\"\",\"why\":[{\"tag\":\"PROVEN|GAP|ANGLE|RISK\",\"text\":\"cite real videos with their views\"}],\"confidence\":0-10,\"projected_views\":\"e.g. 20K-60K in a month\",\"titles\":[" + nTit + " titles]}]}. " +
        ($("#tp-about").value ? "About my channel: " + $("#tp-about").value + ". " : "") + (follow ? "\nPREVIOUS TOPICS: " + JSON.stringify(TOP.list.map(function (t) { return { topic: t.topic_short, titles: t.titles }; })).slice(0, 8000) + "\nUSER REQUEST (apply it; return the full updated list): " + follow : "") + "\nDATA:" + JSON.stringify(data).slice(0, 80000);
      return T.gemini([{ text: prompt }], true, "topics");
    }).then(function (j) {
      TOP.list = (j && j.topics) || [];
      drawTopics();
      if ($("#tp-check").getAttribute("aria-pressed") === "true") return checkTopics();
    }).catch(function (er) { toast("Topics failed: " + er.message, true); $("#tp-title").textContent = "Topics"; })
      .then(function () { T.busy(btn, false); });
  }
  function checkTopics() {
    return TOP.list.slice(0, 8).reduce(function (p, t) {
      return p.then(function () { t.yt = "checking"; drawTopics(); return T.searchVideos(t.topic_short, 24 * 180, { order: "relevance", maxResults: 10 }).then(function (items) { t.yt = items.length >= 8 ? "already" : "not"; t.ytMatch = items[0] ? items[0].snippet.title : ""; drawTopics(); }).catch(function () { t.yt = "unchecked"; drawTopics(); }); });
    }, Promise.resolve());
  }
  function drawTopics() {
    $("#tp-title").textContent = "Topics · " + new Date().toLocaleString(); $("#tp-sub").textContent = TOP.list.length + " topics · from " + learnList().length + " competitors";
    $("#tp-more").hidden = !TOP.list.length;
    $("#tp-list").innerHTML = TOP.list.map(function (t, i) {
      var c = +t.confidence || 0, cc = c >= 8 ? "g" : c >= 5 ? "a" : "r";
      var yt = t.yt === "already" ? '<span class="x-badge r">YouTube already has this' + (t.ytMatch ? ": " + esc(t.ytMatch.slice(0, 50)) : "") + "</span>" : t.yt === "not" ? '<span class="x-badge g">Not on YouTube yet</span>' : t.yt === "checking" ? '<span class="x-badge">Checking YouTube…</span>' : "";
      return '<article class="x-card x-topic"><div class="x-sechead" style="margin:0"><h3>#' + (i + 1) + " " + esc(t.topic_short) + '</h3><button class="x-btn x-btn--ghost x-mini" type="button" data-copy="' + i + '">Copy</button></div><div class="x-badges"><span class="x-badge ' + cc + '">Confidence ' + c + '/10</span><span class="x-badge">Projected: ' + esc(t.projected_views || "–") + "</span>" + yt + '</div><ul class="x-why">' + (t.why || []).map(function (w) { return "<li><b>" + esc(w.tag) + "</b>" + esc(w.text) + "</li>"; }).join("") + "</ul><ol>" + (t.titles || []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol></article>";
    }).join("");
  }
  $("#tp-list").addEventListener("click", function (e) { var b = e.target.closest("[data-copy]"); if (!b) return; var t = TOP.list[+b.dataset.copy]; var txt = t.topic_short + "\n" + (t.titles || []).map(function (x, i) { return i + 1 + ". " + x; }).join("\n"); (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast("Copied ✓"); }, function () { prompt("Copy:", txt); }); });

  /* ================= SAVED & CHANNEL TRACKER ================= */
  function savedCh() { return store.get("saved", []); }
  function toggleSave(n) { var l = savedCh(), i = l.findIndex(function (c) { return c.id === n.id; }); if (i >= 0) l.splice(i, 1); else l.push({ id: n.id, title: n.title, thumb: n.thumb, hist: [{ at: Date.now(), subs: n.subs, views: n.totalViews || 0 }] }); store.set("saved", l); drawSaved(); toast(i >= 0 ? "Removed" : "Saved ✓ (Tracker mein)"); }
  function swipes() { return store.get("swipe", []); }
  function addSwipe(v) { var l = swipes(); if (!l.some(function (x) { return x.id === v.id; })) { l.unshift(Object.assign({ folder: "All", at: Date.now() }, v)); store.set("swipe", l.slice(0, 300)); } toast("Swipe File mein save ✓"); drawSaved(); }
  function delta(h, key) { var now = h[h.length - 1], cut = Date.now() - 48 * 3600e3, old = null; for (var i = h.length - 1; i >= 0; i--) if (h[i].at <= cut) { old = h[i]; break; } if (!old) old = h[0]; return old === now ? null : now[key] - old[key]; }
  function drawSaved() {
    var l = savedCh();
    $("#sv-ch tbody").innerHTML = l.length ? l.map(function (c, i) {
      var h = c.hist || [], last = h[h.length - 1] || {}, dv = delta(h, "views"), ds = delta(h, "subs");
      return '<tr><td><button class="x-chlink x-tv" type="button" data-open-ch="' + esc(c.id) + '">' + img(c.thumb, c.title, 36) + "<div><b>" + esc(c.title) + '</b><span>tracked since ' + new Date((h[0] || {}).at || Date.now()).toLocaleDateString() + '</span></div></button></td><td class="x-n">' + fmt(last.subs) + '</td><td class="x-n">' + (dv == null ? '<span class="x-meta">next update</span>' : "+" + fmt(dv)) + '</td><td class="x-n">' + (ds == null ? "–" : (ds >= 0 ? "+" : "") + fmt(ds)) + '</td><td class="x-n">' + fmt(last.views) + '</td><td><button class="x-btn x-btn--ghost x-mini" type="button" data-unsave="' + i + '">Remove</button></td></tr>';
    }).join("") : '<tr><td colspan="6">' + T.empty("Koi channel save nahi.", "Map ke channel panel mein ☆ Save dabayein.") + "</td></tr>";
    var sw = swipes(), folders = T.uniq(["All"].concat(sw.map(function (x) { return x.folder; })));
    var cur = $("#sv-folder").value || "All";
    $("#sv-folder").innerHTML = folders.map(function (f) { return "<option" + (f === cur ? " selected" : "") + ">" + esc(f) + "</option>"; }).join("");
    var vis = sw.filter(function (x) { return cur === "All" || x.folder === cur; });
    $("#sv-vids").innerHTML = vis.length ? vis.map(function (v, i) { return '<div class="x-vcard"><a class="x-vthumb" href="' + T.ytv(v.id) + '" target="_blank" rel="noopener" style="background-image:url(\'https://i.ytimg.com/vi/' + esc(v.id) + '/mqdefault.jpg\')"></a><div class="x-vmeta">' + (v.out ? '<span class="x-xb">' + v.out + "×</span>" : "") + fmt(v.views) + " views</div><p>" + esc(v.title) + '</p><div class="x-vch">' + esc(v.channel || "") + '</div><div class="x-liverow"><button class="x-btn x-btn--ghost x-mini" type="button" data-tr="' + esc(v.id) + '">Transcript</button><button class="x-btn x-btn--ghost x-mini" type="button" data-rw="' + esc(v.id) + '">Rewrite</button><button class="x-btn x-btn--ghost x-mini" type="button" data-unswipe="' + esc(v.id) + '">Remove</button></div></div>'; }).join("") : '<div class="x-card" style="grid-column:1/-1">' + T.empty("Swipe File khaali hai.", "Map ke channel panel mein kisi video ke ☆ par click karein.") + "</div>";
  }
  $("#sv-folder").addEventListener("change", drawSaved);
  $("#view-saved").addEventListener("click", function (e) {
    var u = e.target.closest("[data-unsave]"); if (u) { var l = savedCh(); l.splice(+u.dataset.unsave, 1); store.set("saved", l); drawSaved(); }
    var w = e.target.closest("[data-unswipe]"); if (w) { store.set("swipe", swipes().filter(function (x) { return x.id !== w.dataset.unswipe; })); drawSaved(); }
  });
  $("#sv-refresh").addEventListener("click", function () {
    var l = savedCh(); if (!l.length || T.needKey()) return; var b = this; T.busy(b, true, "Updating…");
    T.channelsById(l.map(function (c) { return c.id; })).then(function (chs) {
      var m = {}; chs.forEach(function (c) { m[c.id] = c; });
      l.forEach(function (c) { var x = m[c.id]; if (!x) return; c.thumb = chThumb(x) || c.thumb; c.hist = (c.hist || []).concat([{ at: Date.now(), subs: +x.statistics.subscriberCount || 0, views: +x.statistics.viewCount || 0 }]).slice(-60); });
      store.set("saved", l); store.set("svupd", Date.now()); drawSaved(); toast("Updated ✓");
    }).catch(function (er) { toast(er.message, true); }).then(function () { T.busy(b, false); });
  });

  /* ================= TOOLS ================= */
  function vidFrom(s) { var m = String(s).match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/) || String(s).match(/^([\w-]{11})$/); return m ? m[1] : null; }
  function toolVid() { var id = vidFrom($("#tl-q").value.trim()); if (!id) toast("Sahi YouTube video link paste karein.", true); return id; }
  $("#tl-tx").addEventListener("click", function () { var id = toolVid(); if (id) T.showTranscript(id); });
  $("#tl-rw").addEventListener("click", function () { var id = toolVid(); if (id) T.rewriteVideo(id); });
  $("#tl-an").addEventListener("click", function () {
    var id = toolVid(); if (!id || T.needKey()) return;
    T.modal("Video analysis", "Hook, story arc, cliffhangers aur thumbnail analyse ho rahe hain…", "", "analysis-" + id + ".json");
    T.gemini([T.videoPart(id), { text: T.ANALYSE }], true, "analyze").then(function (j) { T.modal("Video analysis", "Strategy ka khaka, original script ke liye.", JSON.stringify(j, null, 2), "analysis-" + id + ".json"); })
      .catch(function (er) { $("#x-msub").textContent = "Fail: " + er.message; });
  });
  $("#tl-q").addEventListener("input", function () {
    var id = vidFrom(this.value.trim());
    $("#tl-sizes").innerHTML = id ? [["maxresdefault", "1280×720"], ["sddefault", "640×480"], ["hqdefault", "480×360"]].map(function (s) { var u = "https://i.ytimg.com/vi/" + id + "/" + s[0] + ".jpg"; return '<a class="x-vcard" href="' + u + '" target="_blank" rel="noopener" download style="width:200px"><div class="x-vthumb" style="background-image:url(\'' + u + '\')"></div><p>' + s[1] + "</p></a>"; }).join("") : "";
  });

  /* ================= boot ================= */
  drawLearn(); drawSaved(); drawMap(); fillLangs(); renderHome();
  if (store.get("mychq", "")) { $("#tp-q").value = store.get("mychq", ""); }
  T.go("home");
})();
