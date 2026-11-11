/* Shared backend client for the website and the admin panel. */
(function () {
  var C = window.TR_CONFIG || {};
  var ready = C.SUPABASE_URL && !/YOUR-PROJECT/.test(C.SUPABASE_URL) && window.supabase;
  var sb = ready ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;
  var session = null, listeners = [], sessionKnown = false;
  if (sb) {
    sb.auth.getSession().then(function (r) { session = r.data.session; sessionKnown = true; fire(); }, function () { sessionKnown = true; fire(); });
    sb.auth.onAuthStateChange(function (_e, s) { session = s; sessionKnown = true; fire(); });
  }
  function fire() { listeners.forEach(function (f) { try { f(session); } catch (e) { console.error(e); } }); }
  function call(action, payload) {
    if (!sb) return Promise.reject(new Error("Backend is not set up (assets/config.js)."));
    var body = Object.assign({ action: action }, payload || {});
    var headers = { "Content-Type": "application/json", apikey: C.SUPABASE_ANON_KEY, Authorization: "Bearer " + (session ? session.access_token : C.SUPABASE_ANON_KEY) };
    return fetch(C.SUPABASE_URL + "/functions/v1/api", { method: "POST", headers: headers, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ("HTTP " + r.status)); e.status = r.status; e.limit = !!j.limit; throw e; }
        if (j._credits != null) document.dispatchEvent(new CustomEvent("tr:credits", { detail: j._credits }));
        return j;
      }); });
  }
  window.BE = {
    ready: !!sb, sb: sb, call: call,
    session: function () { return session; },
    user: function () { return session && session.user; },
    onAuth: function (f) { listeners.push(f); if (!sb) setTimeout(function () { f(null); }, 0); else if (sessionKnown) setTimeout(function () { f(session); }, 0); },
    signIn: function (email, pw) { return sb.auth.signInWithPassword({ email: email, password: pw }).then(chk); },
    signUp: function (email, pw, name) { return sb.auth.signUp({ email: email, password: pw, options: { data: { full_name: name || "" }, emailRedirectTo: location.origin + location.pathname } }).then(chk); },
    google: function () { return sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } }).then(chk); },
    reset: function (email) { return sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }).then(chk); },
    signOut: function () { return sb.auth.signOut(); },
    settings: function () { return sb.from("site_settings").select("*").eq("id", 1).single().then(chk).then(function (r) { return r.data; }); },
    plans: function () { return sb.from("plans").select("*").eq("active", true).order("sort").then(chk).then(function (r) { return r.data || []; }); },
    methods: function () { return sb.from("payment_methods").select("*").eq("active", true).order("sort").then(chk).then(function (r) { return r.data || []; }); },
    upload: function (bucket, path, file) {
      return sb.storage.from(bucket).upload(path, file, { upsert: true, contentType: file.type }).then(chk).then(function () {
        return bucket === "public-assets" ? sb.storage.from(bucket).getPublicUrl(path).data.publicUrl : path;
      });
    }
  };
  function chk(r) { if (r && r.error) throw new Error(r.error.message); return r; }
})();
