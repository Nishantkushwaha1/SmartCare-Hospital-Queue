// SmartCare API client + state sync.
// Classic script (loaded before script.js); shares its globals: S, DEPTS, dep, toast, notify, route, badge, esc.
const SC = (() => {
  const BASE = (window.SMARTCARE_API_URL || "/api").replace(/\/$/, "");
  const LIVE = new Set(["queue", "live", "mobile", "admin"]); // screens that refresh themselves every few seconds
  let jwt = ""; try { jwt = sessionStorage.getItem("sc_jwt") || "" } catch (e) { }
  const store = {
    get: k => { try { return localStorage.getItem(k) } catch (e) { return null } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch (e) { } }
  };
  const setJwt = v => { jwt = v || ""; try { v ? sessionStorage.setItem("sc_jwt", v) : sessionStorage.removeItem("sc_jwt") } catch (e) { } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function req(method, path, body) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (jwt) headers.Authorization = "Bearer " + jwt;
    let res;
    try { res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }) }
    catch (e) { throw Object.assign(new Error("Cannot reach the SmartCare server. Check your connection and try again."), { status: 0 }) }
    let data = null; try { data = await res.json() } catch (e) { }
    if (!res.ok) {
      const err = Object.assign(new Error((data && data.error) || `Request failed (${res.status})`), { status: res.status });
      if (res.status === 401 && jwt && path !== "/auth/login") logout(); // staff session expired
      throw err
    }
    return data
  }

  // ---------- server -> UI shapes ----------
  const mapDept = d => ({ id: d.id, n: d.name, p: d.code, room: d.room, doc: d.doctor || "", st: d.status, tm: d.timing, fee: d.fee, cap: d.dailyCap, on: d.onlineBooked, off: d.offlineBooked, cur: d.currentToken || "–", w: d.waiting });
  const meFrom = (t, prev) => ({
    t: t.token, n: (prev && prev.n) || S.user, a: (prev && prev.a != null ? prev.a : store.get("sc_age")) || "", addr: (prev && prev.addr) || store.get("sc_address") || "", d: t.department, s: t.status, src: t.source, reg: t.registeredAtText, ahead: t.ahead, est: t.estimate,
    pay: t.payment ? { rc: t.payment.receipt, amt: t.payment.amount, m: t.payment.method } : null
  });

  // ---------- notifications: server (broadcast + my token) merged with local ones ----------
  function merge() { S.notes = [...(S.local || []), ...(S.srv || [])].sort((a, b) => b.ts - a.ts) }
  function syncNotes(list) {
    const first = !S.seen;
    if (first) { S.seen = new Set(); if (!S.readAt) { S.readAt = Math.max(0, ...list.map(n => Date.parse(n.createdAt))); store.set("sc_read", S.readAt) } }
    const fresh = [];
    S.srv = list.map(n => {
      const ts = Date.parse(n.createdAt);
      if (!S.seen.has(n.id)) { S.seen.add(n.id); if (!first) fresh.push(n.message) }
      return { id: n.id, k: n.kind, m: n.message, ts, t: n.time, read: ts <= S.readAt }
    });
    merge();
    fresh.reverse().forEach(m => { toast(m); try { if ("Notification" in window && Notification.permission === "granted") new Notification("SmartCare", { body: m }) } catch (e) { } })
  }
  function markRead() { S.readAt = Math.max(S.readAt || 0, ...S.notes.map(n => n.ts)); store.set("sc_read", S.readAt); S.notes.forEach(n => n.read = true) }

  // ---------- load everything the screens read ----------
  async function load() {
    const tk = S.me && S.me.t !== "–" ? "?token=" + encodeURIComponent(S.me.t) : "";
    const [deps, queue, notes] = await Promise.all([req("GET", "/departments"), req("GET", "/queue"), req("GET", "/notifications" + tk)]);
    DEPTS.length = 0; deps.forEach(d => DEPTS.push(mapDept(d)));
    S.queue = queue.map(q => ({ t: q.token, d: q.department, s: q.status, at: q.time, src: q.source }));
    syncNotes(notes);
    if (S.me) {
      try { S.me = meFrom(await req("GET", "/queue/token/" + encodeURIComponent(S.me.t)), S.me) }
      catch (e) { if (e.status === 404) { S.me = null; store.set("sc_token", null) } }
    }
    if (S.admin) {
      try {
        const [pay, stats] = await Promise.all([req("GET", "/admin/payments"), req("GET", "/admin/stats")]);
        S.pay = pay.map(p => ({ id: p.id, rc: p.receipt, tok: p.token, d: p.department, m: p.method, amt: p.amount, src: p.source, st: p.status, at: p.time }));
        S.stats = stats
      } catch (e) { if (e.status !== 401) throw e }
    }
  }
  const refresh = async () => { await load(); badge() };

  // ---------- live updates ----------
  let timer = null, busy = false;
  async function poll() {
    if (busy || document.hidden) return; busy = true;
    try {
      const prev = S.me ? { t: S.me.t, s: S.me.s, a: S.me.ahead } : null;
      await load();
      if (prev && S.me && S.me.t === prev.t && prev.s === "Waiting" && S.me.s === "Waiting" && S.me.ahead < prev.a)
        notify("queue", S.me.ahead ? `Queue status: ${S.me.ahead} patient(s) ahead of ${S.me.t}` : `Queue status: you are next, ${S.me.t}`);
      badge();
      const r = location.hash.replace(/^#\/?/, "");
      if (S.admin && LIVE.has(r)) route(true);
    } catch (e) {/* offline: keep showing the last data */ }
    busy = false
  }

  async function init() {
    S.readAt = Number(store.get("sc_read")) || 0;
    S.user = store.get("sc_name") || S.user;
    try { S.payMode = (await req("GET", "/health")).paymentMode || "razorpay" } catch (e) { if (e.status === 0) throw e }
    if (jwt) { try { S.staff = (await req("GET", "/auth/me")).admin; S.admin = true } catch (e) { if (e.status === 0) throw e } }
    const t = store.get("sc_token");
    if (t) { try { S.me = meFrom(await req("GET", "/queue/token/" + encodeURIComponent(t))) } catch (e) { if (e.status === 0) throw e; store.set("sc_token", null) } }
    await load();
    if (!timer) { timer = setInterval(poll, 10000); document.addEventListener("visibilitychange", () => { if (!document.hidden) poll() }) }
  }
  function fail(e) {
    const m = document.getElementById("smartcare-mount") || document.getElementById("root");
    if (m) m.innerHTML = `<div style="max-width:520px;margin:12vh auto;padding:24px;font-family:sans-serif;text-align:center"><h2>SmartCare could not load</h2><p>${esc(e && e.message || "Unknown error")}</p><button class="btn" onclick="location.reload()">Try again</button></div>`
  }
  const error = e => { if (e && e.status === 401) { toast("Staff login required"); route() } else toast((e && e.message) || "Something went wrong") };

  // ---------- patient: booking + payment ----------
  async function adopt(ticket, name, age, address) {
    S.user = name; store.set("sc_name", name); store.set("sc_age", age == null ? null : String(age)); store.set("sc_address", address || "");
    S.me = meFrom(ticket, { n: name, a: age, addr: address }); store.set("sc_token", ticket.token);
    await refresh()
  }

  // Razorpay Checkout. The browser never sees card/bank details; we only get back ids + a signature.
  async function confirmPayment(order, resp) {
    let last;
    for (let i = 0; i < 3; i++) {
      try { return await req("POST", "/payments/verify", { orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature }) }
      catch (e) { last = e; if (e.status && e.status < 500 && e.status !== 402) throw e; await sleep(1500) }
    }
    // Money may have been taken even though our confirmation call failed: see if the webhook issued the token.
    for (let i = 0; i < 10; i++) {
      try { const s = await req("GET", "/payments/status/" + order.id); if (s.ticket) return { ticket: s.ticket } } catch (e) { }
      await sleep(2000)
    }
    throw last || new Error("Payment received, but the token is not confirmed yet. Open My Queue in a minute or ask at the helpdesk.")
  }
  function checkout(r, form) {
    return new Promise((resolve, reject) => {
      if (!window.Razorpay) return reject(new Error("The payment window could not load. Check your internet connection and try again."));
      let done = false;
      const rz = new window.Razorpay({
        key: r.order.keyId, amount: r.order.amount, currency: r.order.currency, order_id: r.order.id,
        name: "SmartCare Government Hospital", description: "OPD registration fee · " + form.dept,
        prefill: { name: form.name, contact: form.phone }, theme: { color: "#12304d" },
        handler: resp => { done = true; confirmPayment(r.order, resp).then(resolve, reject) },
        modal: {
          confirm_close: true, ondismiss: () => setTimeout(() => {
            if (done) return; done = true; // closed without paying: free the reserved token
            req("POST", "/payments/cancel", { orderId: r.order.id }).catch(() => { });
            reject(Object.assign(new Error("Payment cancelled. No token was booked."), { cancelled: true }))
          }, 1200)
        }
      });
      rz.on("payment.failed", resp => toast("Payment failed: " + ((resp.error && resp.error.description) || "please try again")));
      rz.open()
    })
  }
  // DEMO MODE: a practice payment window (server runs with PAYMENT_MODE=demo). No real money, Razorpay not used.
  function demoCheckout(r, form) {
    return new Promise((resolve, reject) => {
      const ov = document.createElement("div");
      ov.id = "scdemo"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true");
      ov.style.cssText = "position:fixed;inset:0;background:rgba(10,20,35,.62);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px";
      const opt = (v, c) => `<label style="display:flex;gap:8px;align-items:center;padding:9px 10px;border:1px solid #d5dee8;border-radius:8px;margin-bottom:6px;cursor:pointer"><input type="radio" name="scdm" value="${v}"${c ? " checked" : ""}> ${v}</label>`;
      ov.innerHTML = `<div style="background:#fff;color:#12304d;max-width:380px;width:100%;border-radius:14px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.35)">
<div style="background:#fff4d6;color:#7a5200;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;margin-bottom:14px">DEMO MODE · practice payment, no real money is charged</div>
<b style="font-size:17px">SmartCare Government Hospital</b>
<div style="color:#5b6b7c;font-size:13px;margin:4px 0 12px">OPD registration fee · ${esc(form.dept)}</div>
<div style="font-size:30px;font-weight:700;margin-bottom:14px">₹${esc(r.fee)}</div>
${opt("UPI", true)}${opt("Card")}${opt("Net Banking")}
<button class="btn block" id="scdp-pay" style="margin-top:10px">Pay ₹${esc(r.fee)} (demo)</button>
<button class="btn ghost block" id="scdp-fail" style="margin-top:8px">Simulate failed payment</button>
<button class="btn ghost block" id="scdp-x" style="margin-top:8px">Cancel</button></div>`;
      document.body.appendChild(ov);
      const close = () => { try { ov.remove() } catch (e) { } };
      const release = msg => { close(); req("POST", "/payments/cancel", { orderId: r.order.id }).catch(() => { }); reject(Object.assign(new Error(msg), { cancelled: true })) };
      document.querySelector("#scdp-x").onclick = () => release("Payment cancelled. No token was booked.");
      document.querySelector("#scdp-fail").onclick = () => { toast("Payment failed (demo)"); release("Payment failed. No token was booked.") };
      document.querySelector("#scdp-pay").onclick = async () => {
        const b = document.querySelector("#scdp-pay"); b.disabled = true; b.textContent = "Processing payment…";
        const m = document.querySelector("input[name=scdm]:checked");
        try { await sleep(900); const out = await req("POST", "/payments/demo/confirm", { orderId: r.order.id, method: (m && m.value) || "UPI" }); close(); resolve(out) }
        catch (e) { close(); reject(e) }
      }
    })
  }
  async function bookOnline(form) {
    const r = await req("POST", "/bookings/online", { name: form.name, age: form.age, phone: form.phone, address: form.address, departmentId: dep(form.dept).id });
    const out = r.free ? r : (r.demo ? await demoCheckout(r, form) : await checkout(r, form));
    await adopt(out.ticket, form.name, form.age, form.address);
    return out.ticket
  }
  async function track(token) {
    const r = await req("GET", "/queue/token/" + encodeURIComponent(token));
    S.me = meFrom(r, S.me); store.set("sc_token", r.token); S.seen = null; await refresh()
  }

  // ---------- staff ----------
  async function login(username, password) {
    const r = await req("POST", "/auth/login", { username, password });
    setJwt(r.token); S.admin = true; S.staff = r.admin;
    try { await load() } catch (e) { /* login succeeded; data will refresh on the next poll */ }
    badge()
  }
  // ---------- patient accounts: register / login / forgot password (mobile + OTP) ----------
  const patientAuth = (path, body) => req("POST", "/patient-auth" + path, body);
  const sendOtp = (phone, purpose = "booking") => patientAuth("/send-otp", { phone, purpose });
  const verifyOtp = (phone, otp, purpose = "booking") => patientAuth("/verify-otp", { phone, otp, purpose });
  function logout() { setJwt(""); S.admin = false; S.staff = null; S.pay = []; S.stats = null; S.lastOff = null }
  async function issueCounter(dept, mode, name, phone, address) {
    const r = await req("POST", "/admin/counter-bookings", { departmentId: dep(dept).id, mode, name, phone, address });
    S.lastOff = { t: r.ticket.token, d: r.ticket.department, pay: { rc: r.payment.receipt, amt: r.payment.amount, m: r.payment.method, at: r.payment.time }, name: r.ticket.name, address: r.ticket.address };
    await refresh(); return S.lastOff
  }
  async function parchaFor(token) { return await req("GET", "/admin/tokens/" + encodeURIComponent(token)) }
  async function checkIn(token) { const r = await req("POST", "/admin/queue/checkin", { token }); await refresh(); return r }
  async function saveDept(id, d) { const r = id ? await req("PUT", "/departments/" + id, d) : await req("POST", "/departments", d); await refresh(); return r }
  async function removeDept(id) { await req("DELETE", "/departments/" + id); await refresh() }
  async function setStatus(id, status) { await req("PATCH", "/departments/" + id + "/status", { status }); await refresh() }
  async function emergency(body) { const r = await req("POST", "/admin/emergency", body); await refresh(); return r }

  return { init, fail, error, refresh, merge, markRead, bookOnline, track, login, patientAuth, sendOtp, verifyOtp, logout, issueCounter, parchaFor, checkIn, saveDept, removeDept, setStatus, emergency };
})();
