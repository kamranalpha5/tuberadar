/* TubeRadar admin panel. Everything here is protected by Supabase row-level security (profiles.is_admin). */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var sb = window.BE ? BE.sb : null, PLANS = [], METHODS = [], SET = null, EDIT = null;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var tt; function toast(m, err) { var t = $("#toast"); t.textContent = m; t.className = "toast on" + (err ? " err" : ""); clearTimeout(tt); tt = setTimeout(function () { t.className = "toast"; }, err ? 6000 : 2500); }
  function chk(r) { if (r && r.error) throw new Error(r.error.message); return r; }
  function fail(e) { toast(e.message || String(e), true); }
  function day() { return new Date().toISOString().slice(0, 10); }
  function d(s) { return s ? new Date(s).toLocaleString() : "–"; }

  if (!window.BE || !BE.ready) { document.body.innerHTML = '<div class="login card"><h1>Setup needed</h1><p>Add the Supabase URL and anon key in assets/config.js (see the README).</p></div>'; return; }

  /* ---------- auth gate ---------- */
  var started = false;
  BE.onAuth(function (s) {
    if (!s) { $("#app").hidden = true; $("#login").hidden = false; started = false; return; }
    sb.from("profiles").select("is_admin,email").eq("id", s.user.id).single().then(function (r) {
      if (!r.data || !r.data.is_admin) { $("#app").hidden = true; $("#login").hidden = false; $("#lg-note").innerHTML = "<b>" + esc(s.user.email) + "</b> is not an admin. Run this in the Supabase SQL Editor:<br><code>update public.profiles set is_admin = true where email = '" + esc(s.user.email) + "';</code>"; return; }
      $("#login").hidden = true; $("#app").hidden = false;
      if (!started) { started = true; boot(); }
    });
  });
  $("#lg-go").addEventListener("click", function () { $("#lg-msg").textContent = ""; BE.signIn($("#lg-email").value.trim(), $("#lg-pw").value).catch(function (e) { $("#lg-msg").textContent = e.message; }); });
  $("#lg-pw").addEventListener("keydown", function (e) { if (e.key === "Enter") $("#lg-go").click(); });
  $("#logout").addEventListener("click", function () { BE.signOut(); });

  /* ---------- tabs ---------- */
  function tab(t) { $$(".nav").forEach(function (b) { if (b.dataset.t === t) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); }); $$("main section").forEach(function (s) { s.hidden = s.dataset.p !== t; }); LOAD[t] && LOAD[t](); }
  $$(".nav").forEach(function (b) { b.addEventListener("click", function () { tab(b.dataset.t); }); });
  var LOAD = { dash: dash, pays: pays, users: users, plans: plans, methods: methods, keys: keys, site: site, legal: legal };
  function boot() {
    Promise.all([sb.from("plans").select("*").order("sort"), sb.from("payment_methods").select("*").order("sort"), sb.from("site_settings").select("*").eq("id", 1).single()]).then(function (r) {
      PLANS = r[0].data || []; METHODS = r[1].data || []; SET = r[2].data || {};
      $("#logo").innerHTML = esc(SET.site_name || "TubeRadar") + "<small>Admin panel</small>"; document.title = "Admin · " + (SET.site_name || "TubeRadar");
      tab("dash");
    }).catch(fail);
  }
  function planName(id) { var p = PLANS.filter(function (x) { return x.id === id; })[0]; return p ? p.name : id; }
  function methodName(id) { var m = METHODS.filter(function (x) { return x.id === id; })[0]; return m ? m.title : "–"; }

  /* ---------- dashboard ---------- */
  function dash() {
    var now = new Date().toISOString(), month = new Date(Date.now() - 30 * 864e5).toISOString();
    Promise.all([
      sb.from("profiles").select("id", { count: "exact", head: true }),
      sb.from("profiles").select("id", { count: "exact", head: true }).neq("plan_id", "free").gt("plan_expires_at", now),
      sb.from("payments").select("id", { count: "exact", head: true }).eq("status", "pending"),
      sb.from("payments").select("plan_id,created_at,status,email,tid,amount_text").gte("created_at", month).order("created_at", { ascending: false })
    ]).then(function (r) {
      var pays = r[3].data || [], rev = pays.filter(function (p) { return p.status === "approved"; }).reduce(function (s, p) { var pl = PLANS.filter(function (x) { return x.id === p.plan_id; })[0]; return s + (pl ? +pl.price_pkr : 0); }, 0);
      $("#n-pend").hidden = !r[2].count; $("#n-pend").textContent = r[2].count;
      $("#d-stats").innerHTML = [["Users", r[0].count || 0], ["Active paid plans", r[1].count || 0], ["Pending payments", r[2].count || 0], ["Revenue, 30 days", "Rs " + rev.toLocaleString()]].map(function (s) { return '<div class="card"><p>' + s[0] + "</p><strong>" + s[1] + "</strong></div>"; }).join("");
      $("#d-pays").innerHTML = pays.length ? "<table><tbody>" + pays.slice(0, 10).map(function (p) { return "<tr><td>" + d(p.created_at) + "</td><td>" + esc(p.email) + "</td><td>" + esc(planName(p.plan_id)) + "</td><td>" + esc(p.amount_text) + '</td><td><span class="tag ' + p.status + '">' + p.status + "</span></td></tr>"; }).join("") + "</tbody></table>" : '<p class="meta">No payments yet.</p>';
    }).catch(fail);
  }

  /* ---------- payments ---------- */
  $("#p-filter").addEventListener("change", pays);
  function pays() {
    var q = sb.from("payments").select("*").order("created_at", { ascending: false }).limit(200), f = $("#p-filter").value;
    if (f) q = q.eq("status", f);
    q.then(chk).then(function (r) {
      var rows = r.data || [];
      $("#p-rows").innerHTML = rows.length ? rows.map(function (p) {
        return "<tr><td>" + d(p.created_at) + "</td><td>" + esc(p.email) + "</td><td>" + esc(planName(p.plan_id)) + "</td><td>" + esc(p.amount_text) + "</td><td>" + esc(methodName(p.method_id)) + "</td><td><b>" + esc(p.tid) + "</b></td><td>" + (p.screenshot_url ? '<button class="btn g s" data-proof="' + esc(p.screenshot_url) + '">View</button>' : '<span class="meta">none</span>') + '</td><td><span class="tag ' + p.status + '">' + p.status + "</span>" + (p.note ? '<br><small class="meta">' + esc(p.note) + "</small>" : "") + "</td><td>" +
          (p.status !== "approved" ? '<button class="btn s" data-ok="' + p.id + '">Approve</button> ' : "") + (p.status !== "rejected" ? '<button class="btn r s" data-no="' + p.id + '">Reject</button>' : "") + "</td></tr>";
      }).join("") : '<tr><td colspan="9" class="meta">No payments.</td></tr>';
    }).catch(fail);
  }
  $("#p-rows").addEventListener("click", function (e) {
    var ok = e.target.closest("[data-ok]"), no = e.target.closest("[data-no]"), pr = e.target.closest("[data-proof]");
    if (ok) sb.rpc("approve_payment", { p_id: +ok.dataset.ok }).then(chk).then(function () { toast("Approved, plan active ✓"); pays(); dash(); }).catch(fail);
    if (no) { var note = prompt("Reason for rejection (the user will see it):", "TID did not match"); if (note === null) return; sb.rpc("reject_payment", { p_id: +no.dataset.no, p_note: note }).then(chk).then(function () { toast("Rejected"); pays(); }).catch(fail); }
    if (pr) sb.storage.from("payment-proofs").createSignedUrl(pr.dataset.proof, 600).then(chk).then(function (r) { window.open(r.data.signedUrl, "_blank"); }).catch(fail);
  });

  /* ---------- users ---------- */
  var ut; $("#u-q").addEventListener("input", function () { clearTimeout(ut); ut = setTimeout(users, 300); });
  function users() {
    var q = sb.from("profiles").select("*").order("created_at", { ascending: false }).limit(200), s = $("#u-q").value.trim();
    if (s) q = q.ilike("email", "%" + s + "%");
    Promise.all([q, sb.from("usage").select("*").eq("day", day())]).then(function (r) {
      chk(r[0]); var us = {}; (r[1].data || []).forEach(function (u) { us[u.user_id] = u; });
      var opts = PLANS.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>"; }).join("");
      $("#u-rows").innerHTML = (r[0].data || []).map(function (u) {
        var exp = u.plan_expires_at && new Date(u.plan_expires_at) > new Date(), x = us[u.id] || {};
        return "<tr><td>" + esc(u.email) + (u.is_admin ? ' <span class="tag">admin</span>' : "") + (u.banned ? ' <span class="tag rejected">blocked</span>' : "") + "<br><small class=\"meta\">joined " + d(u.created_at) + "</small></td><td>" + esc(planName(u.plan_id)) + (u.plan_id !== "free" && !exp ? ' <span class="tag rejected">expired</span>' : "") + "</td><td>" + d(u.plan_expires_at) + "</td><td>" + (u.shared_group || "–") + "</td><td>" + (x.credits_used || 0) + " cr · " + (x.json_used || 0) + " json</td>" +
          '<td><div class="row" style="flex-wrap:nowrap"><select class="in" style="width:150px" data-plan="' + u.id + '">' + opts.replace('value="' + u.plan_id + '"', 'value="' + u.plan_id + '" selected') + '</select><input class="in" style="width:70px" type="number" value="30" data-days="' + u.id + '" title="days"><button class="btn s" data-set="' + u.id + '">Set</button></div></td>' +
          '<td><button class="btn g s" data-reset="' + u.id + '">Reset today</button> <button class="btn ' + (u.banned ? "g" : "r") + ' s" data-ban="' + u.id + '" data-v="' + (u.banned ? 0 : 1) + '">' + (u.banned ? "Unblock" : "Block") + "</button></td></tr>";
      }).join("") || '<tr><td colspan="7" class="meta">No users.</td></tr>';
    }).catch(fail);
  }
  $("#u-rows").addEventListener("click", function (e) {
    var s = e.target.closest("[data-set]"), rs = e.target.closest("[data-reset]"), b = e.target.closest("[data-ban]");
    if (s) { var id = s.dataset.set; sb.rpc("admin_set_plan", { p_user: id, p_plan: $('[data-plan="' + id + '"]').value, p_days: +$('[data-days="' + id + '"]').value || 30 }).then(chk).then(function () { toast("Plan updated ✓"); users(); }).catch(fail); }
    if (rs) sb.from("usage").delete().eq("user_id", rs.dataset.reset).eq("day", day()).then(chk).then(function () { toast("Today's usage reset ✓"); users(); }).catch(fail);
    if (b) sb.from("profiles").update({ banned: b.dataset.v === "1" }).eq("id", b.dataset.ban).then(chk).then(function () { toast("Saved ✓"); users(); }).catch(fail);
  });

  /* ---------- plans ---------- */
  var PF = [["name", "Name", "text"], ["price_usd", "Price USD", "number"], ["price_pkr", "Price PKR", "number"], ["period_days", "Days", "number"], ["daily_credits", "Credits / day", "number"], ["daily_json", "Strategy JSON / day", "number"], ["radar_visible", "Radar visible (empty = all)", "number"], ["avp_visible", "AVP visible (empty = all)", "number"], ["max_seats", "Max users per group", "number"], ["sort", "Sort", "number"]];
  function plans() {
    $("#pl-list").innerHTML = PLANS.map(function (p) {
      return '<div class="card" data-pid="' + esc(p.id) + '"><div class="row" style="justify-content:space-between"><h2>' + esc(p.name) + ' <small class="meta">(' + esc(p.id) + ')</small></h2><div class="row"><label class="sw"><input type="checkbox" data-f="shared"' + (p.shared ? " checked" : "") + '> Shared</label><label class="sw"><input type="checkbox" data-f="highlight"' + (p.highlight ? " checked" : "") + '> Highlight</label><label class="sw"><input type="checkbox" data-f="active"' + (p.active ? " checked" : "") + '> Active</label></div></div><div class="grid4">' +
        PF.map(function (f) { return "<label><span>" + f[1] + '</span><input class="in" type="' + f[2] + '" data-f="' + f[0] + '" value="' + esc(p[f[0]] == null ? "" : p[f[0]]) + '"></label>'; }).join("") +
        '</div><label style="margin-top:12px"><span>Features (one per line)</span><textarea class="in" data-f="features" style="min-height:90px">' + esc((p.features || []).join("\n")) + '</textarea></label><div class="row" style="margin-top:10px"><button class="btn" data-savep="' + esc(p.id) + '">Save ' + esc(p.name) + "</button></div></div>";
    }).join("");
  }
  $("#pl-list").addEventListener("click", function (e) {
    var b = e.target.closest("[data-savep]"); if (!b) return; var card = b.closest("[data-pid]"), up = {};
    $$("[data-f]", card).forEach(function (i) {
      var k = i.dataset.f;
      if (i.type === "checkbox") up[k] = i.checked; else if (k === "features") up[k] = i.value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
      else if (i.type === "number") up[k] = i.value === "" ? null : +i.value; else up[k] = i.value;
    });
    ["price_usd", "price_pkr", "period_days", "daily_credits", "daily_json", "sort"].forEach(function (k) { if (up[k] == null) up[k] = 0; });
    sb.from("plans").update(up).eq("id", b.dataset.savep).then(chk).then(function () { toast("Plan saved ✓ (live on the website immediately)"); return sb.from("plans").select("*").order("sort"); }).then(function (r) { PLANS = r.data || PLANS; }).catch(fail);
  });

  /* ---------- payment methods ---------- */
  function methods() {
    sb.from("payment_methods").select("*").order("sort").then(chk).then(function (r) {
      METHODS = r.data || [];
      $("#m-rows").innerHTML = METHODS.length ? METHODS.map(function (m) { return "<tr><td>" + (m.qr_url ? '<img class="qr" src="' + esc(m.qr_url) + '" alt="">' : '<span class="meta">no QR</span>') + "</td><td><b>" + esc(m.title) + '</b><br><small class="meta">' + esc(m.kind) + "</small></td><td>" + esc(m.account_name || "") + "<br>" + esc(m.account_number || "") + (m.iban ? "<br>" + esc(m.iban) : "") + '</td><td><label class="sw"><input type="checkbox" data-act="' + m.id + '"' + (m.active ? " checked" : "") + '></label></td><td><button class="btn g s" data-edit="' + m.id + '">Edit</button> <button class="btn r s" data-del="' + m.id + '">Delete</button></td></tr>'; }).join("") : '<tr><td colspan="5" class="meta">No methods yet. Add Easypaisa or a bank below.</td></tr>';
    }).catch(fail);
  }
  $("#m-rows").addEventListener("click", function (e) {
    var ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]"), act = e.target.closest("[data-act]");
    if (act) sb.from("payment_methods").update({ active: act.checked }).eq("id", +act.dataset.act).then(chk).then(function () { toast("Saved ✓"); }).catch(fail);
    if (del && confirm("Delete this method?")) sb.from("payment_methods").delete().eq("id", +del.dataset.del).then(chk).then(methods).catch(fail);
    if (ed) { var m = METHODS.filter(function (x) { return x.id === +ed.dataset.edit; })[0]; EDIT = m; $("#m-title").textContent = "Edit: " + m.title; $("#m-cancel").hidden = false;
      $("#m-kind").value = m.kind; $("#m-name").value = m.title; $("#m-acc").value = m.account_name || ""; $("#m-num").value = m.account_number || ""; $("#m-bank").value = m.bank_name || ""; $("#m-iban").value = m.iban || ""; $("#m-sort").value = m.sort || 0; $("#m-ins").value = m.instructions || ""; }
  });
  $("#m-cancel").addEventListener("click", resetM);
  function resetM() { EDIT = null; $("#m-title").textContent = "Add a payment method"; $("#m-cancel").hidden = true; ["#m-name", "#m-acc", "#m-num", "#m-bank", "#m-iban", "#m-ins"].forEach(function (s) { $(s).value = ""; }); $("#m-qr").value = ""; $("#m-sort").value = 0; }
  $("#m-save").addEventListener("click", function () {
    var row = { kind: $("#m-kind").value, title: $("#m-name").value.trim() || $("#m-kind").selectedOptions[0].textContent, account_name: $("#m-acc").value.trim(), account_number: $("#m-num").value.trim(), bank_name: $("#m-bank").value.trim(), iban: $("#m-iban").value.trim(), instructions: $("#m-ins").value.trim(), sort: +$("#m-sort").value || 0 };
    var f = $("#m-qr").files[0];
    (f ? BE.upload("public-assets", "qr/" + Date.now() + "-" + f.name.replace(/[^\w.]/g, "_"), f) : Promise.resolve(null)).then(function (url) {
      if (url) row.qr_url = url;
      return EDIT ? sb.from("payment_methods").update(row).eq("id", EDIT.id) : sb.from("payment_methods").insert(row);
    }).then(chk).then(function () { toast("Payment method saved ✓"); resetM(); methods(); }).catch(fail);
  });

  /* ---------- keys ---------- */
  function mask(k) { return k ? "Saved: …" + k.slice(-4) : "Not set"; }
  function keys() {
    sb.from("app_secrets").select("*").eq("id", 1).single().then(chk).then(function (r) { var s = r.data || {}; $("#k-yt-now").textContent = mask(s.youtube_key); $("#k-ytc-now").textContent = mask(s.youtube_collector_key); $("#k-gm-now").textContent = mask(s.gemini_key); $("#k-model").value = s.gemini_model || ""; }).catch(fail);
  }
  $("#k-save").addEventListener("click", function () {
    var up = { updated_at: new Date().toISOString() };
    if ($("#k-yt").value.trim()) up.youtube_key = $("#k-yt").value.trim();
    if ($("#k-ytc").value.trim()) up.youtube_collector_key = $("#k-ytc").value.trim();
    if ($("#k-gm").value.trim()) up.gemini_key = $("#k-gm").value.trim();
    if ($("#k-model").value.trim()) up.gemini_model = $("#k-model").value.trim();
    sb.from("app_secrets").update(up).eq("id", 1).then(chk).then(function () { ["#k-yt", "#k-ytc", "#k-gm"].forEach(function (s) { $(s).value = ""; }); toast("Keys saved ✓ (live in 1 minute)"); keys(); }).catch(fail);
  });
  $("#k-test").addEventListener("click", function () {
    $("#k-msg").textContent = "Testing… (the old key may stay cached for up to 1 minute)";
    var a = BE.call("yt", { path: "videos", params: { part: "id", id: "dQw4w9WgXcQ" } }).then(function () { return "YouTube ✓"; }, function (e) { return "YouTube ✗ " + e.message; });
    var b = BE.call("gemini", { kind: "chat", parts: [{ text: "Reply with OK" }] }).then(function () { return "Gemini ✓"; }, function (e) { return "Gemini ✗ " + e.message; });
    Promise.all([a, b]).then(function (r) { $("#k-msg").textContent = r.join(" · "); });
  });

  /* ---------- website settings ---------- */
  var COSTS = ["yt_per_10_units", "transcript", "rewrite", "analyze", "strategy", "chat", "topics"];
  function site() {
    var s = SET || {}, c = s.collector || {};
    $("#s-name").value = s.site_name || ""; $("#s-tag").value = s.tagline || ""; $("#s-biz").value = s.business_name || ""; $("#s-wa").value = s.whatsapp || ""; $("#s-email").value = s.contact_email || ""; $("#s-ann").value = s.announcement || ""; $("#s-auto").checked = !!s.auto_activate;
    $("#s-costs").innerHTML = COSTS.map(function (k) { return "<label><span>" + k + '</span><input class="in" type="number" min="0" data-cost="' + k + '" value="' + esc((s.credit_costs || {})[k] == null ? "" : s.credit_costs[k]) + '"></label>'; }).join("");
    $("#c-reg").value = (c.regions || []).join(","); $("#c-lang").value = c.relevanceLanguage || ""; $("#c-minv").value = c.minViews || ""; $("#c-mino").value = c.minOutlier || ""; $("#c-age").value = c.newChannelMaxAgeDays || ""; $("#c-prof").value = c.maxProfilesPerRun || "";
    $("#c-niches").value = (s.niches || []).join("\n");
  }
  $("#s-save").addEventListener("click", function () {
    var costs = {}; $$("[data-cost]").forEach(function (i) { if (i.value !== "") costs[i.dataset.cost] = +i.value; });
    var up = { site_name: $("#s-name").value.trim() || "TubeRadar", tagline: $("#s-tag").value.trim(), business_name: $("#s-biz").value.trim(), whatsapp: $("#s-wa").value.trim(), contact_email: $("#s-email").value.trim(), announcement: $("#s-ann").value.trim(), auto_activate: $("#s-auto").checked, credit_costs: costs,
      collector: { regions: $("#c-reg").value.split(",").map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean), relevanceLanguage: $("#c-lang").value.trim(), minViews: +$("#c-minv").value || 3000, minOutlier: +$("#c-mino").value || 2, newChannelMaxAgeDays: +$("#c-age").value || 90, maxProfilesPerRun: +$("#c-prof").value || 120 },
      niches: $("#c-niches").value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean), updated_at: new Date().toISOString() };
    sb.from("site_settings").update(up).eq("id", 1).then(chk).then(function () { SET = Object.assign(SET || {}, up); toast("Settings saved ✓ (live on the website immediately)"); }).catch(fail);
  });

  /* ---------- policies ---------- */
  function legal() { var l = (SET && SET.legal) || {}; ["terms", "privacy", "copyright", "refund"].forEach(function (k) { $("#l-" + k).value = l[k] || ""; }); }
  $("#l-save").addEventListener("click", function () {
    var l = {}; ["terms", "privacy", "copyright", "refund"].forEach(function (k) { var v = $("#l-" + k).value.trim(); if (v) l[k] = v; });
    sb.from("site_settings").update({ legal: l }).eq("id", 1).then(chk).then(function () { SET.legal = l; toast("Policies saved ✓"); }).catch(fail);
  });
})();
