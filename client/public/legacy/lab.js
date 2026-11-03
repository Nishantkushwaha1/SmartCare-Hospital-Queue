// SmartCare Lab Report + Feedback.
//   Patient panel : #/lab (book a test -> room + time slot, then collect the report with its QR code), #/feedback
//   Staff panel   : #/labdesk (collect samples, enter results, issue the report), #/feedbacks (feedback inbox)
// Classic script, loaded after script.js: it uses that file's globals (S, V, shell, head, esc, toast, notify, route,
// PATIENT, STAFF, pst, patientPhone, DEPTS, QR) and SC.req from api.js. The doctor's QR scanner is a React screen
// (client/src/components/LabReportView.jsx).
(() => {
  PATIENT.add("lab");
  PATIENT.add("feedback");
  STAFF.add("labdesk");
  STAFF.add("feedbacks");

  const $$ = (s) => document.querySelectorAll(s);
  const render = () => route(true);
  const lab = (m, p, b) => SC.req(m, "/lab" + p, b);
  const fail = (e) => SC.error(e);

  // ---------- small helpers ----------
  const dayLabel = (d, days) => {
    const i = (days || []).indexOf(d);
    const txt = new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
    return i === 0 ? "Today · " + txt : i === 1 ? "Tomorrow · " + txt : txt;
  };
  const longDay = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  const STATUS_CLASS = { Booked: "consultation", "Sample Collected": "waiting", "Report Ready": "completed", Cancelled: "busy" };
  const lpill = (s) => `<span class="pill ${STATUS_CLASS[s] || ""}">${esc(s)}</span>`;
  const stepsHtml = (status) => {
    const at = status === "Report Ready" ? 2 : status === "Sample Collected" ? 1 : 0;
    return `<div class="steps">${["Booked", "Sample collected", "Report ready"].map((l, i) => `<div class="${i <= at ? "on" : ""}"><i></i>${l}</div>`).join("")}</div>`;
  };
  const info = (label, value) => `<div><small>${label}</small><br><b>${esc(value)}</b></div>`;

  // The report as a printable sheet. The QR carries only the report code: the doctor scans it and the
  // hospital system returns the full report (so medical data is never printed inside a QR anyone can read).
  const reportSheet = (b, who) => {
    const r = b.report;
    return `<div class="printable labrep">
<div class="labrep-h"><div><b class="labrep-brand">SMARTCARE HOSPITAL</b><small>Laboratory report</small></div><div class="labrep-qr">${QR.svg(r.code, 150)}<i>${esc(r.code)}</i><small>Show this QR to your doctor</small></div></div>
<div class="labrep-info">
${info("Patient", who.name)}${info("Age", who.age || "–")}${info("Mobile", who.phone || "–")}
${info("Test", b.testName)}${info("Sample", b.sample)}${info("Test date", longDay(b.day))}
${info("Booking code", b.code)}${info("Reported on", r.issuedAt)}${info("Reported by", r.issuedBy || "Lab")}
</div>
<table class="tbl labrep-tbl"><thead><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Ref. range</th><th>Flag</th></tr></thead><tbody>
${r.results.map((x) => `<tr class="${x.flag !== "Normal" ? "abn" : ""}"><td>${esc(x.name)}</td><td><b>${esc(x.value)}</b></td><td>${esc(x.unit)}</td><td>${esc(x.ref)}</td><td><span class="lflag ${esc(x.flag)}">${x.flag === "Normal" ? "Normal" : esc(x.flag)}</span></td></tr>`).join("")}
</tbody></table>
${r.remarks ? `<p class="labrep-rem"><b>Remarks:</b> ${esc(r.remarks)}</p>` : ""}
<p class="labrep-note">Reference ranges are for adults. Please show this report to your doctor; do not self-medicate from the values.</p>
</div>`;
  };

  // =====================================================================
  //  PATIENT: Lab Report
  // =====================================================================
  const L = (S.lab = {
    tests: [], cats: [], days: [], tab: "book", cat: "All", test: null, day: null, slots: null, slot: null,
    mine: [], mineLoaded: false, openCode: null, done: null, busy: false, scroll: false, slotReq: 0,
  });

  // The browser remembers the booking codes (per mobile number); the server only returns a booking when the phone matches too.
  const codesKey = () => "sc_lab_" + patientPhone();
  const getCodes = () => { try { return JSON.parse(pst.get(codesKey()) || "[]"); } catch (e) { return []; } };
  const addCode = (c) => { const l = getCodes().filter((x) => x !== c); l.unshift(c); pst.set(codesKey(), JSON.stringify(l.slice(0, 50))); };
  const seenKey = () => "sc_labseen_" + patientPhone();
  const getSeen = () => { try { return JSON.parse(pst.get(seenKey()) || "{}"); } catch (e) { return {}; } };
  const setSeen = (o) => pst.set(seenKey(), JSON.stringify(o));

  async function loadTests() {
    if (L.tests.length) return;
    const r = await lab("GET", "/tests");
    L.tests = r.tests; L.cats = r.categories; L.days = r.days;
    if (!L.day) L.day = r.days[0];
  }
  async function loadSlots() {
    const id = ++L.slotReq;
    L.slots = null; L.slot = null;
    render();
    try {
      const r = await lab("GET", `/slots?testId=${encodeURIComponent(L.test)}&day=${encodeURIComponent(L.day)}`);
      if (id !== L.slotReq) return;
      L.slots = r.slots;
    } catch (e) { if (id === L.slotReq) { L.slots = []; fail(e); } }
    if (id === L.slotReq) render();
  }
  async function loadMine(quiet) {
    const phone = patientPhone(), codes = getCodes();
    if (!phone || !codes.length) { L.mine = []; L.mineLoaded = true; return; }
    const rows = await lab("POST", "/my", { phone, codes });
    const seen = getSeen();
    rows.forEach((b) => {
      if (b.status === "Report Ready" && seen[b.code] && seen[b.code] !== "Report Ready") notify("appointment", `Your ${b.testName} report is ready. Open Lab Report to see it and its QR code.`);
      seen[b.code] = b.status;
    });
    setSeen(seen);
    L.mine = rows; L.mineLoaded = true;
    if (!quiet && !rows.find((b) => b.code === L.openCode)) L.openCode = null;
  }
  // Called by api.js on every poll (every 10 s): tells the patient when a lab report becomes ready.
  window.labSync = async () => {
    try {
      if (!S.patient || !getCodes().length) return;
      // Only bookings still in progress can change, and 30 s is plenty: finished ones are not asked about again.
      if (L.mineLoaded && !L.mine.some((b) => b.status === "Booked" || b.status === "Sample Collected")) return;
      if (Date.now() - (L.lastSync || 0) < 25000) return;
      L.lastSync = Date.now();
      const wasOpen = location.hash === "#/lab", before = JSON.stringify(L.mine.map((b) => b.status));
      await loadMine(true);
      if (wasOpen && L.tab === "mine" && before !== JSON.stringify(L.mine.map((b) => b.status))) render();
    } catch (e) { /* offline: try again on the next poll */ }
  };

  async function bookNow() {
    if (L.busy || !L.slot) return;
    L.busy = true; render();
    try {
      const age = Number(pst.get("sc_age"));
      const b = await lab("POST", "/bookings", { testId: L.test, day: L.day, slot: L.slot, name: S.user, phone: patientPhone(), ...(Number.isFinite(age) && age > 0 ? { age } : {}) });
      addCode(b.code);
      const seen = getSeen(); seen[b.code] = "Booked"; setSeen(seen);
      L.done = b; L.test = null; L.slots = null; L.slot = null;
      toast(`Lab test booked: Room ${b.room}, ${b.slotLabel}`);
      await loadMine(true).catch(() => {});
    } catch (e) { fail(e); if (L.test) { L.busy = false; return loadSlots(); } }
    L.busy = false; render();
  }

  V.lab = () => {
    const tabs = `<div class="tabs"><button class="${L.tab === "book" ? "on" : ""}" data-lt="book">Book a Test</button><button class="${L.tab === "mine" ? "on" : ""}" data-lt="mine">My Lab Reports${L.mine.some((b) => b.status === "Report Ready") ? ' <b class="bdg">' + L.mine.filter((b) => b.status === "Report Ready").length + "</b>" : ""}</button></div>`;
    return shell("lab", head("Lab Report", "Book a lab test, get your room number and time slot, and collect your report with a QR code for the doctor.") + tabs + (L.tab === "book" ? bookHtml() : mineHtml()));
  };

  function bookHtml() {
    if (!L.tests.length) return `<div class="card"><p class="sub">Loading lab tests…</p></div>`;
    if (L.done) {
      const b = L.done;
      return `<div class="card labdone"><div class="note g"><b>Your lab test is booked.</b> Please reach the room at your slot time and give the sample.</div>
<div class="labbig"><div><small>Room number</small><div class="big">${esc(b.room)}</div><span>${esc(b.roomName)}</span></div><div><small>Time slot</small><div class="big" style="font-size:24px">${esc(b.slotLabel)}</div><span>${esc(longDay(b.day))}</span></div></div>
<div class="grid2eq">${info("Test", b.testName)}${info("Sample to give", b.sample)}${info("Booking code", b.code)}</div>
<div class="note b" style="margin-top:12px"><b>Preparation:</b> ${esc(b.prep)}</div>
<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px"><button class="btn" data-lt="mine">My Lab Reports</button><button class="btn ghost" id="lbagain">Book another test</button></div></div>`;
    }
    const list = L.tests.filter((t) => L.cat === "All" || t.category === L.cat);
    const sel = L.tests.find((t) => t.id === L.test);
    return `<div class="tabs lcat">${["All", ...L.cats].map((c) => `<button class="${c === L.cat ? "on" : ""}" data-lc="${esc(c)}">${esc(c)}</button>`).join("")}</div>
<div class="labgrid">${list.map((t) => `<div class="card labtest${t.id === L.test ? " sel" : ""}"><b>${esc(t.name)}</b>
<div class="labmeta"><span>🧪 ${esc(t.sample)}</span><span>🚪 Room ${esc(t.room)} · ${esc(t.roomName)}</span><span>🕒 ${esc(t.hours)}</span></div>
<button class="btn${t.id === L.test ? "" : " ghost"} block" data-lt-pick="${esc(t.id)}">${t.id === L.test ? "Selected" : "Select test"}</button></div>`).join("")}</div>
${sel ? slotPanel(sel) : `<p class="sub" style="margin-top:14px">Select a test to see its available time slots.</p>`}`;
  }

  function slotPanel(t) {
    const ready = L.slot && L.slots && L.slots.find((s) => s.start === L.slot);
    return `<div class="card" id="slotpanel" style="margin-top:16px"><h3 style="margin:0 0 4px">${esc(t.name)}</h3>
<p class="sub" style="margin-bottom:10px">Room <b>${esc(t.room)}</b> (${esc(t.roomName)}, ${esc(t.floor)}) · Sample: <b>${esc(t.sample)}</b></p>
<div class="note b"><b>Preparation:</b> ${esc(t.prep)}</div>
<label>Choose a day</label><div class="tabs">${L.days.map((d) => `<button class="${d === L.day ? "on" : ""}" data-ld="${d}">${esc(dayLabel(d, L.days))}</button>`).join("")}</div>
<label>Choose a time slot</label>
${L.slots === null ? `<p class="sub">Loading slots…</p>` : L.slots.length === 0 ? `<p class="sub">No slots left for this day. Please pick another day.</p>` : `<div class="slotgrid">${L.slots.map((s) => `<button class="slot${s.start === L.slot ? " on" : ""}${s.full ? " full" : ""}" ${s.full ? "disabled" : ""} data-ls="${s.start}"><b>${esc(s.label.split(" – ")[0])}</b><small>${s.full ? "Full" : s.free + " left"}</small></button>`).join("")}</div>`}
${ready ? `<div class="labsum"><div><small>Your room</small><b>${esc(t.room)}</b></div><div><small>Your slot</small><b>${esc(ready.label)}</b></div><div><small>Date</small><b>${esc(longDay(L.day))}</b></div></div>` : ""}
<button class="btn block" id="lbook" ${ready && !L.busy ? "" : "disabled"} style="margin-top:14px">${L.busy ? "Booking…" : ready ? "Confirm booking" : "Select a time slot"}</button></div>`;
  }

  function mineHtml() {
    const recover = `<form class="card" id="lrecover" style="margin-bottom:14px"><b>Booked on another phone?</b><p class="sub" style="margin:2px 0 8px">Enter the booking code (like LB-K7M2QX4R) to add it here. It must belong to your mobile number.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><input id="lrcode" placeholder="LB-XXXXXXXX" autocomplete="off" style="flex:1;min-width:180px;text-transform:uppercase"><button class="btn ghost">Add booking</button></div></form>`;
    if (!L.mineLoaded) return `<div class="card"><p class="sub">Loading your lab bookings…</p></div>`;
    if (!L.mine.length) return recover + `<div class="card"><b>No lab bookings yet</b><p class="sub">Book a test and it will appear here. Your report and its QR code show up here when the lab finishes it.</p><button class="btn" data-lt="book">Book a lab test</button></div>`;
    const who = { name: S.user, phone: patientPhone(), age: pst.get("sc_age") };
    return recover + L.mine.map((b) => `<div class="card labbk" style="margin-bottom:14px">
<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><b style="font-size:17px">${esc(b.testName)}</b>${lpill(b.status)}</div>
<div class="grid2eq" style="margin:12px 0">${info("Date", longDay(b.day))}${info("Time slot", b.slotLabel)}${info("Room", b.room + " · " + b.roomName)}${info("Sample", b.sample)}${info("Booking code", b.code)}</div>
${b.status === "Cancelled" ? "" : stepsHtml(b.status)}
${b.status === "Booked" ? `<div class="note b"><b>Preparation:</b> ${esc(b.prep)}</div>` : ""}
${b.status === "Sample Collected" ? `<div class="note g">Your sample is with the lab. The report will appear here and you will get a notification.</div>` : ""}
<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
${b.status === "Report Ready" ? `<button class="btn" data-lopen="${esc(b.code)}">${L.openCode === b.code ? "Hide report" : "View report & QR"}</button>` : ""}
${b.status === "Booked" ? `<button class="btn ghost" data-lcancel="${esc(b.code)}" style="color:var(--bad);border-color:var(--bad)">Cancel booking</button>` : ""}</div>
${b.status === "Report Ready" && L.openCode === b.code ? `<div style="margin-top:14px">${reportSheet(b, who)}<button class="btn ghost noprint" onclick="window.print()" style="margin-top:10px">Print / Save as PDF</button></div>` : ""}</div>`).join("");
  }

  V.lab.after = () => {
    $$("[data-lt]").forEach((b) => (b.onclick = () => { L.tab = b.dataset.lt; L.done = null; if (L.tab === "mine") L.mineLoaded = false; render(); }));
    $$("[data-lc]").forEach((b) => (b.onclick = () => { L.cat = b.dataset.lc; render(); }));
    $$("[data-lt-pick]").forEach((b) => (b.onclick = () => { L.test = L.test === b.dataset.ltPick ? null : b.dataset.ltPick; L.scroll = !!L.test; L.slots = null; L.slot = null; if (L.test) loadSlots(); else render(); }));
    $$("[data-ld]").forEach((b) => (b.onclick = () => { L.day = b.dataset.ld; loadSlots(); }));
    $$("[data-ls]").forEach((b) => (b.onclick = () => { L.slot = b.dataset.ls; render(); }));
    const bk = $("#lbook"); if (bk) bk.onclick = bookNow;
    const again = $("#lbagain"); if (again) again.onclick = () => { L.done = null; render(); };
    $$("[data-lopen]").forEach((b) => (b.onclick = () => { L.openCode = L.openCode === b.dataset.lopen ? null : b.dataset.lopen; render(); }));
    $$("[data-lcancel]").forEach((b) => (b.onclick = async () => {
      if (!confirm("Cancel this lab booking? Your slot will be given to another patient.")) return;
      try { await lab("POST", `/bookings/${encodeURIComponent(b.dataset.lcancel)}/cancel`, { phone: patientPhone() }); toast("Lab booking cancelled"); await loadMine(true); render(); } catch (e) { fail(e); }
    }));
    const rf = $("#lrecover");
    if (rf) rf.onsubmit = async (ev) => {
      ev.preventDefault();
      const code = $("#lrcode").value.trim().toUpperCase();
      if (!code) return;
      try {
        const b = await lab("POST", "/lookup", { phone: patientPhone(), code });
        addCode(b.code); const seen = getSeen(); seen[b.code] = b.status; setSeen(seen);
        await loadMine(true); toast("Booking added"); render();
      } catch (e) { fail(e); }
    };
    if (L.scroll && $("#slotpanel")) { L.scroll = false; $("#slotpanel").scrollIntoView({ behavior: "smooth", block: "start" }); }
    // first visit: load the catalog (and my bookings for the badge), then draw again
    if (!L.tests.length) loadTests().then(render).catch(fail);
    if (!L.mineLoaded && !L.loadingMine) {
      L.loadingMine = true;
      loadMine().catch((e) => { if (L.tab === "mine") fail(e); }).finally(() => { L.loadingMine = false; L.mineLoaded = true; render(); });
    }
  };

  // =====================================================================
  //  PATIENT: Feedback
  // =====================================================================
  const FB = (S.fb = { rating: 0, cat: "Other", dept: "", msg: "", anon: false, busy: false, sent: false, cats: null });
  const FB_CATS = ["Doctor & consultation", "Queue & waiting time", "Staff behaviour", "Cleanliness", "Lab services", "Website / token booking", "Other"];
  const RATE_WORD = ["", "Very poor", "Poor", "Okay", "Good", "Excellent"];

  V.feedback = () =>
    shell("feedback", head("Feedback", "Tell us about your visit. Your feedback helps the hospital improve its services.") +
      (FB.sent
        ? `<div class="card" style="text-align:center;padding:34px 20px"><div style="font-size:42px">🙏</div><h3>Thank you for your feedback!</h3><p class="sub">We have received it. The hospital team reads every message.</p><button class="btn" id="fbagain">Send another feedback</button></div>`
        : `<form class="card" id="fbf" onsubmit="return false" style="max-width:640px">
<label>How was your experience?</label>
<div class="stars" id="fbstars" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star${n <= FB.rating ? " on" : ""}" data-star="${n}" role="radio" aria-checked="${n === FB.rating}" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`).join("")}<span id="fbword">${RATE_WORD[FB.rating] || "Tap a star"}</span></div>
<label>About</label><select id="fbcat">${FB_CATS.map((c) => `<option${c === FB.cat ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>
<label>Department (optional)</label><select id="fbdept"><option value="">Not about one department</option>${DEPTS.map((d) => `<option value="${esc(d.n)}"${d.n === FB.dept ? " selected" : ""}>${esc(d.n)}</option>`).join("")}</select>
<label>Your feedback</label><textarea id="fbmsg" rows="5" maxlength="1000" placeholder="What went well? What can we do better?">${esc(FB.msg)}</textarea>
<div class="sub" style="text-align:right;margin:2px 0 8px"><span id="fbcount">${FB.msg.length}</span>/1000</div>
<label class="pmo" style="display:flex;gap:8px;align-items:center;margin-bottom:12px"><input type="checkbox" id="fbanon"${FB.anon ? " checked" : ""} style="width:auto"> Send anonymously (do not share my name and mobile number)</label>
<button class="btn block" id="fbsend"${FB.busy ? " disabled" : ""}>${FB.busy ? "Sending…" : "Submit feedback"}</button></form>`));

  V.feedback.after = () => {
    const again = $("#fbagain"); if (again) again.onclick = () => { Object.assign(FB, { rating: 0, msg: "", sent: false, dept: "", cat: "Other" }); render(); };
    if (!$("#fbf")) return;
    $$("[data-star]").forEach((b) => (b.onclick = () => {
      FB.rating = Number(b.dataset.star);
      $$("[data-star]").forEach((x) => { const on = Number(x.dataset.star) <= FB.rating; x.classList.toggle("on", on); x.setAttribute("aria-checked", Number(x.dataset.star) === FB.rating); });
      $("#fbword").textContent = RATE_WORD[FB.rating];
    }));
    $("#fbcat").onchange = (e) => (FB.cat = e.target.value);
    $("#fbdept").onchange = (e) => (FB.dept = e.target.value);
    $("#fbanon").onchange = (e) => (FB.anon = e.target.checked);
    $("#fbmsg").oninput = (e) => { FB.msg = e.target.value; $("#fbcount").textContent = FB.msg.length; };
    $("#fbsend").onclick = async () => {
      if (!FB.rating) return toast("Please choose a star rating");
      FB.busy = true; render();
      try {
        await SC.req("POST", "/feedback", { rating: FB.rating, category: FB.cat, department: FB.dept, message: FB.msg, ...(FB.anon ? {} : { name: S.user, phone: patientPhone() }) });
        FB.sent = true;
      } catch (e) { fail(e); }
      FB.busy = false; render();
    };
  };

  // =====================================================================
  //  STAFF: Lab Desk
  // =====================================================================
  const D = (S.ld = { day: null, days: [], rows: null, tests: null, sel: null, vals: {}, remarks: "", busy: false, view: null, f: "All" });
  const dayList = () => {
    return [0, 1, 2].map((i) => new Date(Date.now() + i * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  };

  async function loadDesk() {
    if (!D.days.length) { D.days = dayList(); D.day = D.days[0]; }
    const [b, t] = await Promise.all([SC.req("GET", "/admin/lab/bookings?day=" + D.day), D.tests ? Promise.resolve(null) : SC.req("GET", "/admin/lab/tests")]);
    D.rows = b.bookings; if (t) D.tests = t;
  }

  V.labdesk = () => {
    const rows = (D.rows || []).filter((r) => D.f === "All" || r.status === D.f);
    const count = (s) => (D.rows || []).filter((r) => r.status === s).length;
    const sel = D.sel && (D.rows || []).find((r) => r.code === D.sel);
    return shell("labdesk", head("Lab Desk", "Collect samples, enter the results and issue the report. The patient gets the report with its QR code.") +
      `<div class="tabs">${(D.days.length ? D.days : [""]).map((d) => `<button class="${d === D.day ? "on" : ""}" data-dd="${d}">${d ? esc(dayLabel(d, D.days)) : "Today"}</button>`).join("")}<button id="ldrefresh" style="margin-left:auto">Refresh</button></div>
<div class="stats" style="margin-bottom:14px"><div class="card stat"><span>To collect</span><b style="color:var(--pri)">${count("Booked")}</b></div><div class="card stat"><span>Awaiting result</span><b style="color:var(--warn)">${count("Sample Collected")}</b></div><div class="card stat"><span>Reports issued</span><b style="color:var(--ok)">${count("Report Ready")}</b></div></div>
<div class="tabs">${["All", "Booked", "Sample Collected", "Report Ready", "Cancelled"].map((s) => `<button class="${s === D.f ? "on" : ""}" data-df="${s}">${s}</button>`).join("")}</div>
${sel && sel.status === "Sample Collected" ? resultForm(sel) : ""}${D.view ? viewReport(D.view) : ""}
<div class="card wrap"><table class="tbl"><tr><th>Booking</th><th>Patient</th><th>Test</th><th>Room</th><th>Slot</th><th>Status</th><th>Action</th></tr>${D.rows === null ? `<tr><td colspan="7">Loading…</td></tr>` : rows.map((r) => `<tr><td><b>${esc(r.code)}</b></td><td>${esc(r.patient.name)}<br><small>${esc(r.patient.phone)}${r.patient.age ? " · " + esc(r.patient.age) + " y" : ""}</small></td><td>${esc(r.testName)}</td><td>${esc(r.room)}</td><td>${esc(r.slotLabel)}</td><td>${lpill(r.status)}</td><td>${r.status === "Booked" ? `<button class="btn" style="padding:4px 10px;font-size:12px" data-dcollect="${esc(r.code)}">Sample collected</button>` : r.status === "Sample Collected" ? `<button class="btn" style="padding:4px 10px;font-size:12px" data-dresult="${esc(r.code)}">Enter results</button>` : r.status === "Report Ready" ? `<button class="btn ghost" style="padding:4px 10px;font-size:12px" data-dview="${esc(r.code)}">View report</button>` : "–"}</td></tr>`).join("") || `<tr><td colspan="7">No lab bookings for this day.</td></tr>`}</table></div>`);
  };

  function resultForm(r) {
    const t = (D.tests || []).find((x) => x.id === r.testId);
    if (!t) return "";
    return `<form class="card" id="ldform" style="margin-bottom:14px" onsubmit="return false"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><b style="font-size:17px">${esc(t.name)}</b><div class="sub" style="margin:0">${esc(r.patient.name)} · ${esc(r.code)}</div></div><button type="button" class="btn ghost" id="ldcancel" style="align-self:flex-start">Close</button></div>
<div class="resgrid">${t.params.map((p) => `<div><label>${esc(p.name)}${p.unit ? ` <small>(${esc(p.unit)})</small>` : ""}</label><input data-pv="${esc(p.key)}" ${p.type === "number" ? 'inputmode="decimal"' : ""} value="${esc(D.vals[p.key] || "")}" placeholder="${p.ref ? "Ref: " + esc(p.ref) : ""}" autocomplete="off"></div>`).join("")}</div>
<label>Remarks (optional)</label><textarea id="ldrem" rows="2" maxlength="500">${esc(D.remarks)}</textarea><br>
<button class="btn block" id="ldissue"${D.busy ? " disabled" : ""}>${D.busy ? "Issuing…" : "Issue report & generate QR"}</button></form>`;
  }
  function viewReport(r) {
    return `<div class="card" style="margin-bottom:14px"><div style="display:flex;justify-content:flex-end;gap:8px" class="noprint"><button class="btn ghost" onclick="window.print()">Print</button><button class="btn ghost" id="ldclose">Close</button></div>${reportSheet(r, r.patient)}</div>`;
  }

  V.labdesk.after = () => {
    if (D.rows === null) loadDesk().then(render).catch(fail);
    $$("[data-dd]").forEach((b) => (b.onclick = () => { D.day = b.dataset.dd; D.rows = null; D.sel = null; D.view = null; render(); loadDesk().then(render).catch(fail); }));
    $$("[data-df]").forEach((b) => (b.onclick = () => { D.f = b.dataset.df; render(); }));
    const rf = $("#ldrefresh"); if (rf) rf.onclick = () => loadDesk().then(() => { toast("Refreshed"); render(); }).catch(fail);
    $$("[data-dcollect]").forEach((b) => (b.onclick = async () => {
      try { await SC.req("POST", `/admin/lab/bookings/${encodeURIComponent(b.dataset.dcollect)}/collect`); toast("Sample marked as collected"); await loadDesk(); render(); } catch (e) { fail(e); }
    }));
    $$("[data-dresult]").forEach((b) => (b.onclick = () => { D.sel = b.dataset.dresult; D.vals = {}; D.remarks = ""; D.view = null; render(); const f = $("#ldform"); f && f.scrollIntoView({ behavior: "smooth", block: "start" }); }));
    $$("[data-dview]").forEach((b) => (b.onclick = () => { D.view = (D.rows || []).find((r) => r.code === b.dataset.dview) || null; D.sel = null; render(); window.scrollTo(0, 0); }));
    const cl = $("#ldclose"); if (cl) cl.onclick = () => { D.view = null; render(); };
    const cc = $("#ldcancel"); if (cc) cc.onclick = () => { D.sel = null; render(); };
    $$("[data-pv]").forEach((i) => (i.oninput = () => (D.vals[i.dataset.pv] = i.value)));
    const rem = $("#ldrem"); if (rem) rem.oninput = () => (D.remarks = rem.value);
    const is = $("#ldissue");
    if (is) is.onclick = async () => {
      D.busy = true; render();
      try {
        const out = await SC.req("POST", `/admin/lab/bookings/${encodeURIComponent(D.sel)}/report`, { values: D.vals, remarks: D.remarks });
        toast("Report issued. QR code generated."); D.sel = null; D.vals = {}; D.remarks = ""; D.view = out;
        await loadDesk();
      } catch (e) { fail(e); }
      D.busy = false; render();
    };
  };

  // =====================================================================
  //  STAFF: Feedback inbox
  // =====================================================================
  const FI = (S.fi = { data: null, f: 0 });
  const stars = (n) => `<span class="fstars" aria-label="${n} out of 5">${"★".repeat(n)}<i>${"★".repeat(5 - n)}</i></span>`;
  V.feedbacks = () => {
    const d = FI.data;
    const body = !d ? `<div class="card"><p class="sub">Loading feedback…</p></div>` : (() => {
      const max = Math.max(1, ...Object.values(d.summary.byRating));
      const items = d.items.filter((x) => !FI.f || x.rating === FI.f);
      return `<div class="stats" style="margin-bottom:14px"><div class="card stat"><span>Average rating</span><b>${d.summary.count ? d.summary.average.toFixed(1) + " / 5" : "–"}</b></div><div class="card stat"><span>Total feedback</span><b>${d.summary.count}</b></div></div>
<div class="card" style="margin-bottom:14px">${[5, 4, 3, 2, 1].map((r) => `<div class="fbar"><span>${r} ★</span><div><i style="width:${(d.summary.byRating[r] / max) * 100}%"></i></div><b>${d.summary.byRating[r]}</b></div>`).join("")}</div>
<div class="tabs">${[0, 5, 4, 3, 2, 1].map((r) => `<button class="${r === FI.f ? "on" : ""}" data-fif="${r}">${r ? r + " ★" : "All"}</button>`).join("")}<button id="firefresh" style="margin-left:auto">Refresh</button></div>
<div class="card wrap"><table class="tbl"><tr><th>Date</th><th>Rating</th><th>About</th><th>Department</th><th>Feedback</th><th>Patient</th></tr>${items.map((x) => `<tr><td>${esc(x.at)}</td><td>${stars(x.rating)}</td><td>${esc(x.category)}</td><td>${esc(x.department || "–")}</td><td style="white-space:normal;min-width:220px">${esc(x.message || "–")}</td><td>${x.name || x.phone ? esc(x.name) + "<br><small>" + esc(x.phone) + "</small>" : "<small>Anonymous</small>"}</td></tr>`).join("") || `<tr><td colspan="6">No feedback yet.</td></tr>`}</table></div>`;
    })();
    return shell("feedbacks", head("Patient Feedback", "What patients say about the hospital") + body);
  };
  V.feedbacks.after = () => {
    const load = () => SC.req("GET", "/admin/feedback").then((r) => { FI.data = r; render(); }).catch(fail);
    if (!FI.data) load();
    $$("[data-fif]").forEach((b) => (b.onclick = () => { FI.f = Number(b.dataset.fif); render(); }));
    const rf = $("#firefresh"); if (rf) rf.onclick = load;
  };

  // The router may already have drawn the home page before this file finished loading (direct link to #/lab).
  if (S.ready) route(true);
})();
