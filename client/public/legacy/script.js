// ---------- state (loaded from the SmartCare API: see api.js) ----------
// Departments are managed from the "Departments" screen (staff only). Each item mirrors the server record:
// id, n=name, p=token code, room, st=OPD status, tm=timing, fee, cap=daily tokens (70% online / 30% counter),
// on/off=tokens already booked online / at the counter today, cur=now serving, w=patients waiting.
const DEPTS = [];
const DOC_STATUS = ["Available", "Busy", "Unavailable"];
// Queue rows deliberately hold NO personal data: only token, department, booking type, status and time.
const S = {
  user: "Patient",
  me: null,
  pay: [],
  admin: false,
  staff: null,
  stats: null,
  pre: null,
  lastOff: null,
  editDept: null,
  nf: "All",
  queue: [],
  notes: [],
  local: [],
  srv: [],
  readAt: 0,
  filter: "All",
  payMode: "razorpay",
  patient: false, // patient session (name + mobile); staff session is S.admin (JWT from the server)
  area: "patient", // which dashboard layout is showing: "patient" or "staff"
  rx: null, // parcha loaded on the staff "Print Parcha" screen
  next: null, // page the visitor wanted before being sent to a login screen
};
// Small localStorage helper for the patient session (the staff session lives in api.js as a JWT)
const pst = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} },
};
S.patient = pst.get("sc_patient") === "1";
const patientPhone = () => pst.get("sc_phone") || "";

// ---------- helpers ----------
const $ = (s) => document.querySelector(s),
  now = () =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const esc = (s) =>
  String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const dep = (n) => DEPTS.find((d) => d.n === n) || {},
  dn = () => DEPTS.map((d) => d.n);
const roomOf = (n) => "Room " + (dep(n).room || "–");
const pill = (s) => `<span class="pill ${s.toLowerCase()}">${s}</span>`;
function toast(m) {
  let c = $("#toasts");
  if (!c) {
    c = document.createElement("div");
    c.id = "toasts";
    c.className = "toasts";
    c.setAttribute("role", "status");
    document.body.appendChild(c);
  }
  const e = document.createElement("div");
  e.className = "toast";
  e.textContent = m;
  c.appendChild(e);
  setTimeout(() => e.remove(), 3400);
}
const curTok = (n) => dep(n).cur || "–";
const waiting = (n) => dep(n).w || 0;
const mine = () =>
  S.me
    ? { ...S.me }
    : {
        t: "–",
        n: S.user,
        d: (DEPTS[0] || {}).n || "–",
        s: "Waiting",
        src: "online",
        reg: "–",
        pay: null,
        ahead: 0,
        est: null,
      };
const ahead = () => (S.me && S.me.ahead != null ? S.me.ahead : 0);
const est = () => (S.me && S.me.est ? S.me.est.text : "–");
const arriveBy = () =>
  S.me && S.me.est
    ? "Please arrive by " + S.me.est.arriveBy
    : "Book a token to see your arrival time";

// ---------- A4 OPD prescription parcha ----------
// One layout for both the online parcha (V.parcha) and the counter parcha (V.counter). Print with window.print();
// the print CSS (src/styles.css, "OPD prescription parcha") shows only .printable. Blank values print as writable lines.
// Registered time prints like "04 Oct 2026, 01:01 am" (am/pm in lower case).
const rxReg = (v) => (v ? String(v).replace(/\b(AM|PM)\b/g, (m) => m.toLowerCase()) : v);
const rxField = (label, value, cls = "") =>
  `<div class="rxf ${cls}"><small>${label}</small><b>${value || value === 0 ? esc(value) : "&nbsp;"}</b></div>`;
const rxSheet = (o) => `<div class="printable rxwrap"><div class="rx">
<div class="rxh"><b class="rxbrand">SMARTCARE HOSPITAL</b><div class="rxtt"><b>OPD PRESCRIPTION</b><small>PARCHA</small></div></div>
<div class="rxtop"><div class="rxfs">${rxField("Patient", o.name, "w2")}${rxField("Age", o.age)}${rxField("Registered", rxReg(o.reg))}${rxField("Department", o.dept)}${rxField("Doctor", o.doctor)}${rxField("Patient address", o.address, "w2 rxaddr")}</div>
<div class="rxtok"><small>Token</small><b>${esc(o.token)}</b><div class="rxqr">${QR.svg(o.token, 150)}</div><i>${esc(o.code || o.token)}</i></div></div>
<div class="rxvit">${["BP (mmHg)", "Pulse (/min)", "Temp (°F)", "SpO₂ (%)", "Weight (kg)"].map((l) => `<div><small>${l}</small></div>`).join("")}</div>
<div class="rxtwo"><div><small>Complaints / History</small></div><div><small>Diagnosis</small></div></div>
<div class="rxbody"><span>℞ Prescription</span><i></i><i></i><i></i></div>
<p class="rxnote">Note: This Parcha is Valid for 24 hours only.</p>
<div class="rxsig"><div><small>Follow-up / Investigations</small></div><div><small>Doctor's signature &amp; stamp</small></div></div>
<p class="rxfoot">Please keep this parcha safe.</p>
</div></div>`;
const rxToday = () => new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

// ---------- notifications ----------
const KIND = {
  appointment: ["#7c5cd6", "Appointment"],
  token: ["#2a78d1", "Token"],
  queue: ["#d98a0b", "Queue"],
  doctor: ["#12a594", "Availability"],
  room: ["#0aa5b8", "Room"],
  emergency: ["#e5383b", "Emergency"],
  payment: ["#16a34a", "Payment"],
};
const unread = () => S.notes.filter((n) => !n.read).length;
const bellHtml = () =>
  `Notifications${unread() ? ` <b class="bdg">${unread()}</b>` : ""}`;
function badge() {
  const b = $("#bell");
  if (b) b.innerHTML = bellHtml();
  const n = $("#navbell");
  if (n) n.innerHTML = bellHtml();
}
function notify(k, m) {
  S.local.unshift({ k, m, ts: Date.now(), t: now(), read: false });
  if (S.local.length > 30) S.local.length = 30;
  SC.merge();
  toast(m);
  try {
    if ("Notification" in window && Notification.permission === "granted")
      new Notification("SmartCare", { body: m });
  } catch (e) {}
  if (location.hash === "#/alerts") route();
  else badge();
}

// ---------- layout ----------
// Two separate dashboards: patients and hospital staff each get their own menu.
const NAV_PATIENT = [
  ["patient", "My Dashboard"],
  ["register", "Token Booking"],
  ["queue", "My Queue"],
  ["parcha", "Token / Parcha"],
  ["genqr", "Generate QR"],
  ["live", "Live Queue"],
  ["mobile", "Mobile View"],
  ["alerts", "Notifications"],
];
const NAV_STAFF = [
  ["emergency", "Emergency"],
  ["staff", "Staff Dashboard"],
  ["doctor", "Doctor Console"],
  ["admin", "Admin Overview"],
  ["counter", "Counter Booking"],
  ["sparcha", "Print Parcha"],
  ["scan", "Scan QR"],
  ["live", "Live Queue"],
  ["depts", "Departments"],
  ["doctors", "OPD Status"],
  ["analytics", "Analytics"],
  ["alerts", "Notifications"],
];
function patientLogout() {
  pst.set("sc_patient", null);
  pst.set("sc_phone", null);
  pst.set("sc_name", null);
  pst.set("sc_age", null);
  pst.set("sc_token", null);
  S.patient = false;
  S.me = null;
  S.user = "Patient";
  S.area = "patient";
  location.hash = "#/";
  route();
}
function staffLogout() {
  SC.logout();
  S.rx = null;
  S.area = "patient";
  location.hash = "#/";
  route();
}
function shell(route, inner) {
  const staff = S.area === "staff";
  const nav = staff ? NAV_STAFF : NAV_PATIENT;
  const who = staff ? (S.staff && (S.staff.name || S.staff.username)) || "Staff" : S.user;
  return `<div class="app"><aside class="side"><a class="logo" href="#/${staff ? "staff" : "patient"}"><i>+</i>SmartCare</a>
 <small style="display:block;padding:0 14px 8px;opacity:.7;letter-spacing:.06em;text-transform:uppercase">${staff ? "Staff / Admin Panel" : "Patient Panel"}</small>
 ${nav.map(([r, l]) => `<a href="#/${r}" class="${r === route ? "on" : ""}${staff && r === "emergency" ? " emgred" : ""}"${r === "alerts" ? ' id="navbell"' : ""}>${r === "alerts" ? bellHtml() : l}</a>`).join("")}<div class="sp"></div><a href="#/">Home</a><a href="#" onclick="${staff ? "staffLogout()" : "patientLogout()"};return false">Logout</a></aside>
 <main class="main"><div class="top"><a class="bellbtn" id="bell" href="#/alerts" aria-label="Notifications">${bellHtml()}</a><button id="th" aria-label="Toggle theme">Theme</button><div class="av">${esc(String(who || "?")[0])}</div><b>${esc(who)}</b> <button class="btn ghost" style="margin-left:10px;padding:6px 12px" onclick="${staff ? "staffLogout()" : "patientLogout()"}">Logout</button></div>${inner}</main></div>`;
}
const head = (t, s) => `<h2 class="t">${t}</h2><p class="sub">${s}</p>`;

// ---------- mobile / phone helpers & reusable booking OTP verification ----------
const cleanPhone = (val) => String(val || "").replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, "");
const phoneOk = (val) => /^[6-9]\d{9}$/.test(cleanPhone(val));

function setupBookingOtpVerifier({ phoneInputId, sendBtnId, sectionId, prefix = "bop" }) {
  const phoneInput = $(phoneInputId);
  const sendBtn = $(sendBtnId);
  const section = $(sectionId);
  if (!phoneInput || !sendBtn || !section) return { isVerified: () => false, getPhone: () => "" };

  let isVerified = false;
  let verifiedPhone = null;
  let cooldownTimer = null;
  let cooldownRemaining = 0;
  let activePhoneForOtp = null;

  const getClean = () => cleanPhone(phoneInput.value);

  const resetVerification = () => {
    isVerified = false;
    verifiedPhone = null;
    activePhoneForOtp = null;
    if (cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null; }
    cooldownRemaining = 0;
    sendBtn.disabled = false;
    sendBtn.textContent = "Send OTP";
    sendBtn.style.color = "";
    sendBtn.style.borderColor = "";
    section.style.display = "none";
    section.innerHTML = "";
  };

  const startCooldown = () => {
    cooldownRemaining = 30;
    sendBtn.disabled = true;
    sendBtn.textContent = `Resend (${cooldownRemaining}s)`;
    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      cooldownRemaining--;
      if (cooldownRemaining > 0) {
        sendBtn.textContent = `Resend (${cooldownRemaining}s)`;
      } else {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
        if (!isVerified) {
          sendBtn.disabled = false;
          sendBtn.textContent = "Resend OTP";
        }
      }
    }, 1000);
  };

  const renderOtpSection = (devOtp) => {
    section.style.display = "block";
    section.innerHTML = `
      ${devOtp ? `
        <div class="note b" style="margin-bottom:8px;padding:8px 12px;background:rgba(42,120,209,0.12);border:1px solid var(--pri);border-radius:8px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-weight:700;color:var(--ink)">Demo OTP:</span>
            <span style="font-family:monospace;font-size:16px;letter-spacing:3px;font-weight:700;color:var(--pri)">${esc(devOtp)}</span>
          </div>
          <small style="display:block;margin-top:4px;color:var(--mute)">Use this Demo OTP to verify. Real SMS delivery is not configured.</small>
        </div>` : ""}
      <div style="display:flex;gap:8px;align-items:center">
        <input id="${prefix}-val" type="text" inputmode="numeric" maxlength="6" placeholder="Enter 6-digit OTP" autocomplete="one-time-code" style="flex:1" aria-label="Enter 6-digit OTP">
        <button type="button" class="btn" id="${prefix}-vbtn" style="white-space:nowrap;padding:9px 16px">Verify OTP</button>
      </div>
      <div id="${prefix}-msg" style="font-size:12px;margin-top:4px;color:var(--mute)"></div>
    `;

    const otpInput = $(`#${prefix}-val`);
    const verifyBtn = $(`#${prefix}-vbtn`);
    const msgEl = $(`#${prefix}-msg`);

    const doVerify = async () => {
      const code = otpInput ? otpInput.value.trim() : "";
      const currentClean = getClean();
      if (!currentClean || currentClean !== activePhoneForOtp) {
        toast("Mobile number changed. Click Send OTP again.");
        resetVerification();
        return;
      }
      if (!/^\d{6}$/.test(code)) {
        toast("Enter the 6-digit OTP");
        if (otpInput) otpInput.focus();
        return;
      }
      verifyBtn.disabled = true;
      verifyBtn.textContent = "Verifying...";
      if (msgEl) msgEl.innerHTML = "";
      try {
        await SC.verifyOtp(currentClean, code, "booking");
        isVerified = true;
        verifiedPhone = currentClean;
        if (cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null; }
        sendBtn.disabled = true;
        sendBtn.textContent = "Verified ✓";
        sendBtn.style.color = "#16a34a";
        sendBtn.style.borderColor = "#16a34a";
        section.innerHTML = `
          <div style="display:flex;align-items:center;gap:6px;color:#16a34a;background:rgba(22,163,74,0.12);border:1px solid #16a34a;border-radius:8px;padding:8px 12px;font-weight:600;font-size:13px">
            <span>Mobile Number Verified ✓</span>
          </div>
        `;
        toast("Mobile Number Verified ✓");
      } catch (err) {
        verifyBtn.disabled = false;
        verifyBtn.textContent = "Verify OTP";
        const errMsg = err.message || "Incorrect or expired OTP";
        toast(errMsg);
        if (msgEl) msgEl.innerHTML = `<span style="color:var(--bad)">${esc(errMsg)}</span>`;
        if (otpInput) otpInput.focus();
      }
    };

    if (verifyBtn) verifyBtn.onclick = doVerify;
    if (otpInput) {
      otpInput.focus();
      otpInput.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          doVerify();
        }
      };
    }
  };

  sendBtn.onclick = async () => {
    const raw = phoneInput.value;
    const clean = getClean();
    if (!phoneOk(raw)) {
      toast("Enter a valid 10-digit mobile number");
      phoneInput.focus();
      return;
    }
    if (isVerified && clean === verifiedPhone) {
      toast("Mobile number is already verified ✓");
      return;
    }
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending...";
    try {
      const r = await SC.sendOtp(clean, "booking");
      activePhoneForOtp = clean;
      renderOtpSection(r.devOtp);
      startCooldown();
      toast(r.devOtp ? `Demo OTP: ${r.devOtp}` : "OTP sent to your mobile number");
    } catch (err) {
      sendBtn.disabled = false;
      sendBtn.textContent = "Send OTP";
      toast(err.message || "Failed to send OTP");
    }
  };

  phoneInput.addEventListener("input", () => {
    if (isVerified && getClean() !== verifiedPhone) {
      resetVerification();
      toast("Mobile number changed. Please verify with a new OTP.");
    }
  });

  return {
    isVerified: () => Boolean(isVerified && verifiedPhone && verifiedPhone === getClean()),
    getPhone: () => getClean(),
    reset: resetVerification
  };
}

// ---------- screens ----------
const V = {};
V.doctor = () => "";
const go = (id) => {
  const e = document.getElementById(id);
  e && e.scrollIntoView({ behavior: "smooth" });
};
const fs = (d) => {
  const b = document.body;
  b.style.zoom = d
    ? Math.min(1.3, Math.max(0.9, (parseFloat(b.style.zoom) || 1) + d * 0.1))
    : 1;
};
const NOTICES = [
  [
    "04 Oct 2026",
    "OPD token counter opens at 7:30 AM. Online registration is available from 6:00 AM.",
  ],
  [
    "01 Oct 2026",
    "Child immunisation is held every Wednesday in the Pediatrics wing.",
  ],
  [
    "28 Sep 2026",
    "Essential medicines are free at the hospital pharmacy on showing the parcha.",
  ],
  [
    "20 Sep 2026",
    "Emergency and casualty services run 24 hours. Dial 108 for an ambulance.",
  ],
];
const STEPS = [
  [
    "Register",
    "Enter your name, age, phone, choose a department and pay the fee online.",
  ],
  [
    "Collect token",
    "You get a token number and a digital parcha with a QR code.",
  ],
  ["Track your queue", "See patients ahead and the estimated time."],
  ["Visit the doctor", "Reach your room when your token is called."],
];
V[""] = () => {
  const info = DEPTS.map((d) => ({
    d: d.n,
    room: d.room,
    cur: curTok(d.n),
    w: waiting(d.n),
  }));
  return `<div class="u"><span>Helpline: 1800-000-0000 &nbsp;|&nbsp; Emergency: 108</span><span>Text size <button onclick="fs(-1)" aria-label="Smaller text">A-</button><button onclick="fs(0)" aria-label="Normal text">A</button><button onclick="fs(1)" aria-label="Larger text">A+</button><button id="th" aria-label="Toggle theme">Theme</button></span></div>
<div class="brand"><a class="logo" href="#/"><i>+</i><div><b>SmartCare Hospital</b><small>OPD Token and Queue Management Portal</small></div></a><div class="links"><a href="#/patient-login">Patient Login</a><a href="#/staff-login">Staff Login</a></div></div>
<nav class="mn" id="top"><a onclick="go('top')">Home</a><a onclick="go('dep')">Departments</a><a onclick="go('book')">Token booking</a><a onclick="go('how')">How to get a token</a><a onclick="go('notice')">Notices</a><a onclick="go('contact')">Contact</a></nav>
<div class="tick"><b>Latest</b><div>OPD token counter opens at 7:30 AM &nbsp;&bull;&nbsp; Emergency services are available 24 hours &nbsp;&bull;&nbsp; Child immunisation every Wednesday</div></div>
<section class="hr"><div class="in"><div><h2>Less Waiting.<br><em>More</em> Healing.</h2><p>Get a token before you reach the hospital, see how many patients are ahead of you and plan your visit around the estimated time.</p>
<div class="cta"><a class="btn" href="#/register">Register for token</a><a class="btn ghost" href="#/live">View live queue</a></div>
<form class="track" id="tf"><input id="tk" placeholder="Enter token number, e.g. GM-048" aria-label="Token number"><button class="btn">Track</button></form></div>
<div class="panel"><h3>Live OPD status <small>Updated ${now()}</small></h3><div class="pscroll"><table><tr><th>Department</th><th>Room</th><th>Now serving</th><th>Waiting</th></tr>${info.map((x) => `<tr><td>${esc(x.d)}</td><td>${esc(x.room)}</td><td><b>${x.cur}</b></td><td>${x.w}</td></tr>`).join("")}</table></div></div></div></section>
<section class="sec2"><div class="in"><div class="ql"><a href="#/register">Get OPD token<small>Register online in a minute</small></a><a href="#/queue">Track my queue<small>Position and estimated time</small></a><a href="#/genqr">Generate QR<small>QR code for your token</small></a><a href="#/scan">Scan QR<small>Check in at the room</small></a><a class="em" href="#/emergency">Emergency priority<small>For critical patients</small></a></div></div></section>
<section class="sec2" id="book"><div class="in"><h2>Token booking</h2><p class="lead">Every department's daily tokens are split: 70% can be booked online, 30% are issued by the hospital admin at the counter.</p><div class="split"><div class="d1 bk on"><span class="tag">70% Online</span><h3>Book from home</h3><p>${totLeft("online")} online tokens left today across all departments.</p><a class="btn block" href="#/register">Book online token</a></div><div class="d1 bk off"><span class="tag">30% Offline</span><h3>Hospital counter</h3><p>${totLeft("offline")} counter tokens left today. Booked by the hospital admin: walk in, tell the counter your department and pay the fee.</p><a class="btn ghost block" href="#/register">See counter tokens</a></div></div></div></section>
<section class="sec2 alt" id="dep"><div class="in"><h2>Departments</h2><p class="lead">Current OPD position in each department.</p><div class="ds">${info.map((x, i) => `<div class="d1"><h3>${esc(x.d)}</h3><p>${esc(DEPTS[i].tm)}</p><div class="kv"><span>Room number</span><b>${esc(x.room)}</b></div><div class="kv"><span>Registration fee</span><b>${DEPTS[i].fee ? "₹" + DEPTS[i].fee : "Free"}</b></div><div class="kv"><span>Now serving</span><b>${x.cur}</b></div><div class="kv"><span>Patients waiting</span><b>${x.w}</b></div><div class="kv"><span>Tokens left (online / counter)</span><b>${left(DEPTS[i], "online")} / ${left(DEPTS[i], "offline")}</b></div><br><a class="btn block" href="#/register">Get token</a></div>`).join("")}</div></div></section>
<section class="sec2 alt" id="how"><div class="in"><h2>How to get a token</h2><p class="lead">Four simple steps, no need to stand in line.</p><div class="bam"></div><div class="bd">${STEPS.map((x, i) => `<div class="board ${i % 2 ? "p" : ""}"><small>Step 0${i + 1}</small><h3>${x[0]}</h3><p>${x[1]}</p></div>`).join("")}</div></div></section>
<section class="sec2" id="notice"><div class="in"><h2>Notices</h2><p class="lead">Announcements from the hospital administration.</p><div class="nb">${NOTICES.map((n) => `<div class="pin"><time>${n[0]}</time><span>${n[1]}</span></div>`).join("")}</div></div></section>
<div class="pat"></div><footer class="ft2" id="contact"><div class="in"><div><h4>SmartCare Hospital</h4>Hospital Road, District Headquarters<br>Uttar Pradesh - 000000</div><div><h4>Contact</h4>Helpline: 1800-000-0000<br>Emergency: 108<br>help@smartcare.example</div><div><h4>OPD timings</h4>Mon to Sat: 8:00 AM - 4:00 PM<br>Emergency: 24 hours</div><div><h4>Quick links</h4><a href="#/register">Get token</a><a href="#/live">Live queue</a><a href="#/patient-login">Patient login</a><a href="#/staff-login">Staff login</a></div></div><div class="in cp">&copy; 2026 SmartCare Hospital. All rights reserved.</div></footer>`;
};
V[""].after = () =>
  ($("#tf").onsubmit = async (e) => {
    e.preventDefault();
    const v = $("#tk").value.trim().toUpperCase();
    if (!v) return toast("Enter a token number");
    try {
      await SC.track(v);
      if (!S.patient) {
        S.patient = true;
        pst.set("sc_patient", "1");
      }
      location.hash = "#/queue";
    } catch (err) {
      toast(err.status === 404 ? "Token not found" : err.message);
    }
  });

// ---------- token quota: 70% online / 30% offline ----------
const QP = 0.7,
  quota = (d) => {
    const on = Math.round(d.cap * QP);
    return { on, off: d.cap - on };
  };
const left = (d, src) => {
  const q = quota(d);
  return Math.max(0, src === "online" ? q.on - d.on : q.off - d.off);
};
const totLeft = (src) => DEPTS.reduce((a, d) => a + left(d, src), 0);
// ---------- payments ----------
// Online tokens are paid through Razorpay Checkout (UPI / card / net banking). Card and bank details are typed
// into Razorpay's secure window and never reach this app or the SmartCare server.
// Counter (offline) parchas are booked by the hospital admin, who collects the fee in cash / UPI / card.
const MODES = ["Cash", "UPI", "Card"];
const sumPay = (src) =>
    S.pay
      .filter((p) => p.src === src && p.st !== "refunded")
      .reduce((a, p) => a + p.amt, 0),
  payTxt = (p) => (p ? (p.amt ? `₹${p.amt} via ${esc(p.m)}` : "Free") : "–"),
  feeTxt = (d) => (d.fee ? "₹" + d.fee : "Free");
const radios = (name, list) =>
  `<div class="pm">${list.map((m, i) => `<label class="pmo"><input type="radio" name="${name}" value="${m}"${i ? "" : " checked"}> ${m}</label>`).join("")}</div>`;
const picked = (name) => {
  const r = document.querySelector(`input[name=${name}]:checked`);
  return r ? r.value : "";
};
const FULLMSG = (n) =>
  `Online tokens for ${n} are full. Please take a counter (offline) token at the hospital.`;

V.register = () => {
  const opt = (src) =>
    DEPTS.map((d) => {
      const l = left(d, src);
      return `<option value="${esc(d.n)}"${l ? "" : " disabled"}${src === "online" && l && d.n === S.pre ? " selected" : ""}>${esc(d.n)} (${l ? l + " left" : "Full"})</option>`;
    }).join("");
  return shell(
    "register",
    head(
      "Token Booking",
      "Daily tokens in every department are split: 70% for online booking (fee paid online) and 30% for the hospital counter (offline parcha booked by the admin).",
    ) +
      `<div class="split">
<form class="card bk on" id="rf" onsubmit="return false"><span class="tag">70% Online</span><h3>Book online</h3><small class="sub">${totLeft("online")} online tokens left today</small>
<label>Full name *</label><input id="fn" value="${esc(S.user === "Patient" ? "" : S.user)}" placeholder="Full name" required><label>Age *</label><input id="ag" type="number" placeholder="e.g. 28" min="0" max="120" required><label>Mobile number *</label><div class="otp-field-wrap"><div style="display:flex;gap:8px;align-items:center"><input id="ph" type="tel" inputmode="numeric" placeholder="10-digit mobile number" autocomplete="tel" value="${esc(patientPhone())}" required style="flex:1"><button type="button" class="btn ghost" id="ph-send" style="white-space:nowrap;padding:9px 14px">Send OTP</button></div><div id="ph-otp-box" style="display:none;margin-top:8px"></div></div><label>Patient Address *</label><textarea id="faddr" placeholder="Enter complete patient address" required></textarea><label>Department *</label><select id="dp">${opt("online")}</select>
<div class="fee" id="fee"></div>
<div id="payw" class="note b">${S.payMode === "demo" ? "<b>Demo mode:</b> a practice payment window will open. No real money is charged." : "You will pay securely with Razorpay: UPI, debit/credit card or net banking. Card and bank details are entered in Razorpay's own window and never reach SmartCare."}</div>
<br><button class="btn block" id="gt">Get Online Token</button><p class="sub">Your token is reserved for a few minutes while you pay. Your phone number is used only for notifications and is never shown on queue screens.</p></form>
<div class="card bk off"><span class="tag">30% Offline</span><h3>Hospital counter</h3><small class="sub">${totLeft("offline")} counter tokens left today</small><p class="sub">The counter (offline) parcha is booked by the hospital admin. Patients cannot book it from this page.</p>
<ol class="how"><li>Walk in to the hospital counter.</li><li>Tell the admin your department.</li><li>Pay the fee at the counter: cash, UPI or card.</li><li>Collect your printed parcha with the QR code and room number.</li></ol></div></div>
<div class="card" style="margin-top:18px"><b>Not sure which department?</b><p class="sub">Type the problem (for example "chest pain" or "skin rash") to see which department and room number to go to.</p><div class="finder"><input id="fp" placeholder="e.g. chest pain" aria-label="Problem"><button class="btn" id="fb">Find room</button></div><div id="fr"></div></div>
<div class="card wrap" style="margin-top:18px"><b>Today's token quota and fee by department</b><table class="tbl"><tr><th>Department</th><th>Room</th><th>Fee</th><th>Online (70%)</th><th>Offline (30%)</th></tr>${DEPTS.map(
        (d) => {
          const q = quota(d),
            pc = (u, t) => (t ? Math.min(100, Math.round((u / t) * 100)) : 100);
          return `<tr><td><b>${esc(d.n)}</b></td><td>${esc(d.room)}</td><td>${feeTxt(d)}</td><td>${Math.min(d.on, q.on)}/${q.on}<div class="bar"><i style="width:${pc(d.on, q.on)}%"></i></div></td><td>${Math.min(d.off, q.off)}/${q.off}<div class="bar"><i style="width:${pc(d.off, q.off)}%"></i></div></td></tr>`;
        },
      ).join("")}</table></div>`,
  );
};
V.register.after = () => {
  S.pre = null;
  const sel = $("#dp"),
    btn = $("#gt");
  const regOtp = setupBookingOtpVerifier({
    phoneInputId: "#ph",
    sendBtnId: "#ph-send",
    sectionId: "#ph-otp-box",
    prefix: "reg-otp"
  });
  const upd = () => {
    const f = dep(sel.value).fee || 0;
    $("#fee").innerHTML = f
      ? `Registration fee: <b>₹${f}</b>`
      : `Registration fee: <b>Free</b> (no payment needed)`;
    $("#payw").hidden = !f;
    btn.textContent = f ? `Pay ₹${f} & Get Online Token` : "Get Online Token";
  };
  sel.onchange = upd;
  upd();
  btn.onclick = async () => {
    if (!$("#rf").reportValidity()) return;
    if (!regOtp.isVerified()) {
      toast("Please verify your mobile number with OTP first");
      $("#ph").focus();
      return;
    }
    const dept = sel.value,
      d = dep(dept),
      f = d.fee || 0;
    if (!left(d, "online")) return toast(FULLMSG(dept));
    btn.disabled = true;
    btn.textContent = f ? "Opening secure payment…" : "Booking…";
    try {
      await SC.bookOnline({
        name: $("#fn").value.trim(),
        age: $("#ag").value,
        phone: $("#ph").value.trim(),
        address: $("#faddr").value.trim(),
        dept,
      });
      location.hash = "#/parcha";
    } catch (e) {
      btn.disabled = false;
      upd();
      toast(e.message);
      SC.refresh().catch(() => {});
    }
  };
  const find = () => {
    const v = $("#fp").value.trim();
    if (!v) return;
    const d = deptFrom(nrm(v)) || DEPTS[0];
    $("#fr").innerHTML =
      `<div class="note g">For "${esc(v)}", please consult <b>${esc(d.n)}</b> in <b>Room ${esc(d.room)}</b>.</div>`;
  };
  $("#fb").onclick = find;
  $("#fp").onkeydown = (e) => {
    if (e.key === "Enter") find();
  };
};

// ---------- admin: counter (offline) parcha booking ----------
V.counter = () => {
  const o = S.lastOff,
    rows = S.pay.filter((p) => p.src === "offline"),
    opt = DEPTS.map((d) => {
      const l = left(d, "offline");
      return `<option value="${esc(d.n)}"${l ? "" : " disabled"}>${esc(d.n)} · ${feeTxt(d)} (${l ? l + " left" : "Full"})</option>`;
    }).join("");
  return shell(
    "counter",
    head(
      "Counter Booking",
      "The offline parcha is booked here by the admin. Collect the fee, then issue the parcha.",
    ) +
      `
<div class="stats"><div class="card stat"><span>Counter tokens left</span><b>${totLeft("offline")}</b></div><div class="card stat"><span>Counter collection</span><b>₹${sumPay("offline")}</b></div><div class="card stat"><span>Online collection</span><b>₹${sumPay("online")}</b></div><div class="card stat"><span>Total collected</span><b>₹${sumPay("online") + sumPay("offline")}</b></div></div>
<div class="grid2"><form class="card bk off" id="cf" onsubmit="return false"><span class="tag">Admin · 30% Offline</span><h3>Issue counter parcha</h3><p class="sub">Enter patient details and select the department.</p>
<label>Patient Name *</label><input id="cn" placeholder="Patient name" autocomplete="off" required>
<label>Mobile number *</label><div class="otp-field-wrap"><div style="display:flex;gap:8px;align-items:center"><input id="cpn" type="tel" inputmode="numeric" placeholder="10-digit mobile number" autocomplete="off" required style="flex:1"><button type="button" class="btn ghost" id="cpn-send" style="white-space:nowrap;padding:9px 14px">Send OTP</button></div><div id="cpn-otp-box" style="display:none;margin-top:8px"></div></div>
<label>Patient Address *</label><textarea id="caddr" placeholder="Enter complete patient address" required></textarea>
<label>Department *</label><select id="cd">${opt}</select><div class="fee" id="cfee"></div><div id="cpw"><label>Fee received by *</label>${radios("cm", MODES)}</div>
<br><button class="btn block" id="cg">Issue Parcha</button><br><button type="button" class="btn ghost block" id="cl">Lock counter booking</button></form>
<div>${o ? `${rxSheet({ token: o.t, name: o.name || "", age: "", address: o.address || "", reg: rxToday() + ", " + o.pay.at, dept: o.d, doctor: dep(o.d).doc, ahead: "–", est: "–", code: o.pay.rc })}<button class="btn block" id="cp" style="margin-top:12px">Print parcha</button>` : `<div class="card"><b>Issued parcha</b><p class="sub">The parcha with its QR code appears here after you issue it.</p></div>`}</div></div>
<div class="card wrap" style="margin-top:18px"><b>Counter bookings today</b><table class="tbl"><tr><th>Token</th><th>Department</th><th>Room</th><th>Fee</th><th>Received by</th><th>Receipt</th><th>Time</th></tr>${rows.map((p) => `<tr><td><b>${p.tok}</b></td><td>${esc(p.d)}</td><td>${esc(dep(p.d).room || "–")}</td><td>${p.amt ? "₹" + p.amt : "Free"}</td><td>${esc(p.m)}</td><td>${esc(p.rc)}</td><td>${p.at}</td></tr>`).join("") || `<tr><td colspan="7">No counter bookings yet.</td></tr>`}</table></div>`,
  );
};
V.counter.after = () => {
  const sel = $("#cd"),
    btn = $("#cg");
  const counterOtp = setupBookingOtpVerifier({
    phoneInputId: "#cpn",
    sendBtnId: "#cpn-send",
    sectionId: "#cpn-otp-box",
    prefix: "cnt-otp"
  });
  const upd = () => {
    const f = dep(sel.value).fee || 0;
    $("#cfee").innerHTML = f
      ? `Fee to collect: <b>₹${f}</b>`
      : `Fee: <b>Free</b> (no payment needed)`;
    $("#cpw").hidden = !f;
    btn.textContent = f
      ? `Collect ₹${f} & Issue Parcha`
      : "Issue Free Parcha";
  };
  sel.onchange = upd;
  upd();
  btn.onclick = async () => {
    if (!$("#cf").reportValidity()) return;
    if (!counterOtp.isVerified()) {
      toast("Please verify the patient's mobile number with OTP first");
      $("#cpn").focus();
      return;
    }
    btn.disabled = true;
    try {
      const o = await SC.issueCounter(sel.value, picked("cm") || "Cash", $("#cn").value.trim(), $("#cpn").value.trim(), $("#caddr").value.trim());
      toast("Counter parcha " + o.t + " issued");
      route();
    } catch (e) {
      btn.disabled = false;
      SC.error(e);
    }
  };
  $("#cl").onclick = () => {
    SC.logout();
    route();
  };
  const cp = $("#cp");
  if (cp) cp.onclick = () => window.print();
};

// ---------- staff: print the parcha of any token issued today ----------
V.sparcha = () => {
  const r = S.rx;
  const rows = S.queue;
  return shell(
    "sparcha",
    head("Print Parcha", "Search a token issued today (online or counter) and print its A4 parcha with the QR code.") +
      `<div class="grid2"><div class="card"><h3>Find token</h3>
<label>Token number</label><input id="sp-t" placeholder="e.g. GM-048" autocomplete="off" style="text-transform:uppercase">
<br><button class="btn block" id="sp-go">Show parcha</button><br><button class="btn ghost block" id="sp-rf">Refresh token list</button></div>
<div>${
        r
          ? `${rxSheet({ token: r.token, name: r.patient.name, age: r.patient.age, address: r.patient.address || "", reg: r.registeredAtText, dept: r.department, doctor: dep(r.department).doc, ahead: r.estimate ? r.ahead : "–", est: r.estimate ? r.estimate.text : "–", code: r.payment ? r.payment.receipt : r.token })}<button class="btn block" id="sp-pr" style="margin-top:12px">Print parcha</button>`
          : `<div class="card"><b>Parcha preview</b><p class="sub">Enter a token number or choose one from today's list. The parcha appears here, ready to print.</p></div>`
      }</div></div>
<div class="card wrap noprint" style="margin-top:18px"><b>Today's tokens</b> <small class="sub">(${rows.length})</small><input id="sp-f" placeholder="Filter by token, department or status" style="margin:10px 0" autocomplete="off"><table class="tbl" id="sp-tb"><tr><th>Token</th><th>Department</th><th>Booking</th><th>Status</th><th>Time</th><th></th></tr>${
        rows
          .map(
            (q) =>
              `<tr data-s="${esc((q.t + " " + q.d + " " + q.s + " " + (q.src === "offline" ? "offline counter" : "online")).toLowerCase())}"><td><b>${esc(q.t)}</b></td><td>${esc(q.d)}</td><td>${q.src === "offline" ? "Offline" : "Online"}</td><td>${pill(q.s)}</td><td>${esc(q.at)}</td><td><button class="btn ghost" data-pt="${esc(q.t)}">Print</button></td></tr>`,
          )
          .join("") || `<tr><td colspan="6">No tokens issued today yet.</td></tr>`
      }</table></div>`,
  );
};
V.sparcha.after = () => {
  const load = async (tk, print) => {
    tk = String(tk || "").trim().toUpperCase();
    if (!tk) return toast("Enter a token number");
    try {
      S.rx = await SC.parchaFor(tk);
      route(true);
      if (print) setTimeout(() => window.print(), 150);
    } catch (e) {
      toast(e.status === 404 ? "Token not found for today" : e.message);
    }
  };
  $("#sp-go").onclick = () => load($("#sp-t").value);
  $("#sp-t").onkeydown = (e) => {
    if (e.key === "Enter") load($("#sp-t").value);
  };
  $("#sp-rf").onclick = async () => {
    try {
      await SC.refresh();
    } catch (e) {}
    route(true);
  };
  $("#sp-f").oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll("#sp-tb tr[data-s]").forEach((tr) => (tr.style.display = tr.dataset.s.includes(q) ? "" : "none"));
  };
  document.querySelectorAll("[data-pt]").forEach((b) => (b.onclick = () => load(b.dataset.pt, true)));
  const pr = $("#sp-pr");
  if (pr) pr.onclick = () => window.print();
};

V.parcha = () => {
  const m = mine(),
    a = ahead();
  if (!S.me)
    return shell(
      "parcha",
      head(
        "Token / Parcha",
        "Your token and QR code appear here after booking",
      ) +
        `<div class="card"><p class="sub">You have not booked a token yet.</p><a class="btn" href="#/register">Book a token</a></div>`,
    );
  return shell(
    "parcha",
    head("Token Generated", "Show this parcha at your room") +
      `<div class="grid2"><div class="card"><div class="okbox">✓ Token generated successfully!<div style="font-weight:500;margin-top:3px">Your token number</div><div class="big">${m.t}</div></div>
<div style="margin:12px 0">
<div class="row">
<span>Patient</span><b>${esc(m.n)}${m.a ? ` (${m.a}y)` : ""}</b>
</div>
<div class="row">
<span>Patient Address</span><b>${esc(m.addr || "–")}</b>
</div>
<div class="row">
<span>Department</span><b>${esc(m.d)}</b>
</div>
<div class="row"><span>Booking</span><b>${m.src === "offline" ? "Offline (counter)" : "Online"}</b>
</div>
<div class="row"><span>Room number</span><b>${esc(dep(m.d).room || "–")}</b></div><div class="row"><span>Registration time</span><b>${esc(m.reg)}</b></div><div class="row"><span>Fee paid</span><b>${payTxt(m.pay)}</b></div><div class="row"><span>Receipt no.</span><b>${m.pay ? esc(m.pay.rc) : "–"}</b></div></div>
<button class="btn block" onclick="window.print()">View Parcha / Download</button><br><a class="btn ghost block" href="#/queue">Go to My Queue</a></div>
${rxSheet({ token: m.t, name: m.n, age: m.a, address: m.addr || "", reg: m.reg, dept: m.d, doctor: dep(m.d).doc, ahead: a, est: est(), code: m.pay ? m.pay.rc : m.t })}
</div>`,
  );
};

V.queue = () => {
  const m = mine(),
    a = ahead();
  if (!S.me)
    return shell(
      "queue",
      head("My Queue", "Track your live queue status") +
        `<div class="card"><p class="sub">You have no active token. Book one, or enter a token number on the home page to track it.</p><a class="btn" href="#/register">Book a token</a></div>`,
    );
  return shell(
    "queue",
    head("My Queue", "Track your live queue status") +
      `<div class="card" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:14px;margin-bottom:16px"><div><small style="color:var(--pri)">Token no.</small><div class="big" style="font-size:30px">${m.t}</div></div><div><small>Room number</small><br><b>${esc(dep(m.d).room || "–")}</b></div><div><small>Department</small><br><b>${esc(m.d)}</b></div>${pill("Waiting").replace("Waiting", "In Queue").replace("waiting", "completed")}</div>
<div class="stats"><div class="card stat"><span>Current token</span><b>${curTok(m.d)}</b></div><div class="card stat"><span>Patients ahead</span><b>${a}</b></div><div class="card stat"><span>Estimated time</span><b style="font-size:24px">${est()}</b></div></div>
<div class="card"><div class="steps"><div class="on"><i></i>Waiting</div><div><i></i>Called</div><div><i></i>Consultation</div><div><i></i>Completed</div></div>
<div class="note g">${m.s === "Consultation" ? `Your token is called. Please go to Room ${esc(dep(m.d).room || "–")}.` : m.s === "Completed" ? "Your consultation is completed." : m.s === "Cancelled" ? "This token was cancelled." : `You are ${a + 1}th in queue. Please wait for your turn.`}</div><div class="note b">AI prediction: the estimated time may change based on real-time queue data.</div></div>`,
  );
};

// Public queue view: only room number and department are shown (no names, phones, addresses or emails).
V.live = () => {
  const f = S.filter,
    rows = S.queue.filter((q) => f === "All" || q.d === f),
    m = mine().t;
  return shell(
    "live",
    head("Live Queue", "Current queue status for all departments") +
      `<div class="tabs">${["All", ...dn()].map((d) => `<button class="${d === f ? "on" : ""}" data-f="${esc(d)}">${esc(d)}</button>`).join("")}</div>
<div class="card wrap"><table class="tbl"><tr><th>Token no.</th><th>Room number</th><th>Department</th><th>Booking</th><th>Status</th><th>Time</th></tr>${rows.map((q) => `<tr class="${q.t === m ? "me" : ""}"><td>${q.t}</td><td>${esc(dep(q.d).room || "–")}</td><td>${esc(q.d)}</td><td>${q.src === "offline" ? "Offline" : "Online"}</td><td>${pill(q.s)}</td><td>${q.at}</td></tr>`).join("") || `<tr><td colspan="6">No patients in this department.</td></tr>`}</table></div>`,
  );
};
V.live.after = () =>
  document.querySelectorAll("[data-f]").forEach(
    (b) =>
      (b.onclick = () => {
        S.filter = b.dataset.f;
        route();
      }),
  );

// ---------- QR: Generate + Scan ----------
V.genqr = () => {
  const m = mine();
  return shell(
    "genqr",
    head(
      "Generate QR",
      "Create the QR code for a token. Staff scan it at the room.",
    ) +
      `<div class="grid2"><form class="card" id="gf" onsubmit="return false"><label>Token number</label><input id="gq" value="${m.t === "–" ? "" : m.t}" placeholder="e.g. GM-048" autocomplete="off"><br><button class="btn block" id="gg">Generate QR</button></form><div class="card" id="go" style="text-align:center"></div></div>`,
  );
};
V.genqr.after = () => {
  const show = () => {
    const v = $("#gq").value.trim().toUpperCase(),
      q = S.queue.find((x) => x.t === v),
      m = mine();
    if (!v || v === "–") {
      $("#go").innerHTML =
        '<p class="sub">Enter your token number to generate its QR code.</p>';
      return;
    }
    if (!q && v !== m.t) return toast("Token not found");
    const d = q ? q.d : m.d;
    $("#go").innerHTML =
      `<b>QR for ${v}</b><div class="qrbox">${QR.svg(v, 220)}</div><div style="text-align:left"><div class="row"><span>Room number</span><b>${esc(dep(d).room || "–")}</b></div><div class="row"><span>Department</span><b>${esc(d)}</b></div></div>`;
  };
  $("#gg").onclick = show;
  $("#gq").onkeydown = (e) => {
    if (e.key === "Enter") show();
  };
  show();
};

let camStream = null,
  camTimer = null;
function stopCam() {
  clearInterval(camTimer);
  camTimer = null;
  if (camStream) {
    camStream.getTracks().forEach((t) => t.stop());
    camStream = null;
  }
}
async function checkIn(raw) {
  const v = String(raw).trim().toUpperCase();
  if (!v) {
    toast("Enter a token number");
    return false;
  }
  try {
    const n = await SC.checkIn(v);
    const r = $("#sr");
    if (r)
      r.innerHTML = `<div class="okbox" style="text-align:left">Token ${esc(n.token)} checked in</div><div class="row"><span>Room number</span><b>${esc(n.room)}</b></div><div class="row"><span>Department</span><b>${esc(n.department)}</b></div><div class="row"><span>Status</span>${pill("Consultation")}</div>`;
    return true;
  } catch (e) {
    SC.error(e);
    return false;
  }
}
V.scan = () =>
  shell(
    "scan",
    head("Scan QR", "Scan a patient's QR code to check them in") +
      `<div class="grid2"><div class="card"><b>Scan with camera</b><div class="scanbox"><div id="cam" style="width: 100%; display: none;"></div></div><p class="sub" id="cs">Press the button and point the camera at the QR code.</p><button class="btn block" id="sc">Start scanning</button>
<label>Or type the token number</label><input id="ct" placeholder="e.g. GM-048" autocomplete="off"><br><button class="btn ghost block" id="sn">Check in</button></div><div class="card" id="sr"><b>Result</b><p class="sub">The scanned token's room number and department will appear here.</p></div></div>`,
  );
let html5QrCode = null;
V.scan.after = () => {
  $("#sn").onclick = () => checkIn($("#ct").value);
  $("#sc").onclick = async () => {
    const st = $("#cs"),
      v = $("#cam");

    if (html5QrCode) {
      try {
        await html5QrCode.stop();
      } catch (e) {}
      html5QrCode = null;
      v.style.display = "none";
      $("#sc").textContent = "Start scanning";
      st.textContent = "Scanner stopped.";
      return;
    }

    if (!window.Html5Qrcode) {
      st.textContent =
        "Camera QR library not loaded. Please type the token number below.";
      return;
    }

    v.style.display = "block";
    $("#sc").textContent = "Stop scanning";
    st.textContent = "Looking for a QR code...";

    html5QrCode = new window.Html5Qrcode("cam");
    try {
      const devices = await window.Html5Qrcode.getCameras();
      if (!devices || !devices.length) {
        throw new Error("No cameras found");
      }
      // prefer back camera if available, otherwise use the first one
      let cameraId = devices[0].id;
      for (const d of devices) {
        if (d.label && d.label.toLowerCase().includes("back")) {
          cameraId = d.id;
          break;
        }
      }
      
      await html5QrCode.start(
        cameraId,
        { 
          fps: 10,
          // Removed fixed qrbox so it scans the entire frame, which is much more reliable
          // for webcam scanning where the QR code might not be perfectly centered.
          videoConstraints: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            advanced: [{ focusMode: "continuous" }]
          }
        },
        async (decodedText) => {
          console.log("[Diagnostic] QR Code detected successfully:", decodedText);
          try {
            await html5QrCode.stop();
          } catch (e) {
            console.error("[Diagnostic] Error stopping scanner:", e);
          }
          html5QrCode = null;
          v.style.display = "none";
          $("#sc").textContent = "Start scanning";
          st.textContent = "Checking in token...";

          let token = decodedText;
          if (token.includes("token=")) {
            token = token.split("token=")[1].split("&")[0];
          }
          console.log("[Diagnostic] Extracted token:", token);
          const ok = await checkIn(token);
          st.textContent = ok
            ? "QR scanned."
            : "QR scanned, but the token was not found.";
        },
        (errorMessage) => {
          // parse errors are normal, it just means no QR found in this frame
          // console.debug("[Diagnostic] Scan frame error:", errorMessage);
        }
      );
    } catch (err) {
      st.textContent =
        "Camera error: " + (err.message || err) + ". Please type the token number below.";
      $("#sc").textContent = "Start scanning";
      v.style.display = "none";
      html5QrCode = null;
    }
  };
};

V.mobile = () => {
  const m = mine();
  if (!S.me)
    return shell(
      "mobile",
      head("Patient Dashboard", "Mobile view") +
        `<div class="card"><p class="sub">Book or track a token to see your live status here.</p><a class="btn" href="#/register">Book a token</a></div>`,
    );
  return shell(
    "mobile",
    head("Patient Dashboard", "Mobile view") +
      `<div class="phone"><div class="logo"><i>+</i>SmartCare</div><h3 style="margin:14px 0 0">Hello, ${esc(m.n)}</h3><small style="color:var(--mute)">Here's your current queue status</small>
<div class="two"><div>Token no.<b>${m.t}</b></div><div>Room number<b>${esc(dep(m.d).room || "–")}</b></div><div>Department<b>${esc(m.d)}</b></div><div>Booking<b>${m.src === "offline" ? "Offline" : "Online"}</b></div><div>Patients ahead<b>${ahead()}</b></div><div>Estimated time<b>${est()}</b></div></div>
<div class="steps" style="font-size:10px"><div class="on"><i></i>Waiting</div><div><i></i>Called</div><div><i></i>Visit</div><div><i></i>Done</div></div><div class="note g">${arriveBy()}</div></div>`,
  );
};

V.staff = () => {
  const st = S.stats || { total: 0, waiting: 0, completed: 0, emergency: 0, collected: { total: 0 } };
  const tile = (href, title, text, primary) =>
    `<div class="card" style="text-align:center;padding:28px 18px${primary ? ";border:2px solid var(--pri)" : ""}"><h3>${title}</h3><p class="sub">${text}</p><br><a class="btn${primary ? "" : " ghost"} block" href="${href}">Open</a></div>`;
  return shell(
    "staff",
    head("Staff Dashboard", `Welcome, ${esc((S.staff && (S.staff.name || S.staff.username)) || "Staff")}. Manage check-ins, counter bookings and hospital workflow.`) +
      `<div class="stats"><div class="card stat"><span>Total patients</span><b>${st.total}</b></div><div class="card stat"><span>Waiting</span><b style="color:var(--warn)">${st.waiting}</b></div><div class="card stat"><span>Completed</span><b style="color:var(--ok)">${st.completed}</b></div><div class="card stat"><span>Emergency</span><b style="color:var(--bad)">${st.emergency}</b></div><div class="card stat"><span>Fees collected</span><b>₹${st.collected.total}</b></div></div>
<div class="grid2" style="margin-top:18px">
${tile("#/scan", "Patient Verification", "Scan a patient's QR code or enter the token number to check them into the queue.", true)}
${tile("#/counter", "Counter Booking", "Collect the fee and issue offline (counter) parchas.")}
${tile("#/sparcha", "Print Parcha", "Find any token of today and print its A4 parcha with QR code.")}
${tile("#/admin", "Admin Overview", "Real-time hospital statistics, queue metrics and department status.")}
${tile("#/depts", "Departments", "Add or edit departments, rooms, fees and daily token limits.")}
${tile("#/doctors", "OPD Status", "Update doctor availability for every department.")}
${tile("#/analytics", "Analytics", "Reports on patients, collections and waiting times.")}
${tile("#/emergency", "Emergency Priority", "Move critical patients to the front of the queue.")}
${tile("#/doctor", "Doctor Console", "Open the doctor's consultation console.")}
</div>`,
  );
};

V.admin = () => {
  const st = S.stats || {
    total: 0,
    waiting: 0,
    completed: 0,
    emergency: 0,
    collected: { total: 0 },
  };
  return shell(
    "admin",
    head("Hospital Overview", "Real-time statistics and queue management") +
      `<div class="stats"><div class="card stat"><span>Total patients</span><b>${st.total}</b></div><div class="card stat"><span>Waiting</span><b style="color:var(--warn)">${st.waiting}</b></div><div class="card stat"><span>Completed</span><b style="color:var(--ok)">${st.completed}</b></div><div class="card stat"><span>Emergency</span><b style="color:var(--bad)">${st.emergency}</b></div><div class="card stat"><span>Fees collected</span><b>₹${st.collected.total}</b></div></div>
<div class="card"><b>Department queues</b>${DEPTS.map((d, i) => {
        const l = S.queue.filter((q) => q.d === d.n),
          nx = l.find((q) => q.s === "Waiting");
        return `<div class="dept"><div class="av">${esc(d.p)}</div><div><b>${esc(d.n)}</b> <small>Room ${esc(d.room)}</small><br><small>Current: ${curTok(d.n)} &nbsp; Next: ${nx ? nx.t : "–"}</small></div><div>${waiting(d.n)} in queue</div><a class="btn" href="#/live" onclick="S.filter=DEPTS[${i}].n">View</a></div>`;
      }).join("")}</div>`,
  );
};

// ---------- department management ----------
V.depts = () => {
  const e = S.editDept != null ? DEPTS[S.editDept] : null;
  return shell(
    "depts",
    head(
      "Departments",
      "Add, edit and manage hospital departments and their daily tokens (70% online, 30% offline) and the registration fee",
    ) +
      `<div class="card" style="margin-bottom:18px"><b>${e ? "Edit department" : "Add department"}</b><form id="df" class="dform" onsubmit="return false"><div><label>Department name *</label><input id="dnm" value="${esc(e ? e.n : "")}" required></div><div><label>Token code</label><input id="dcd" maxlength="3" value="${esc(e ? e.p : "")}" ${e ? "readonly" : ""} placeholder="auto"></div><div><label>Room number *</label><input id="drm" value="${esc(e ? e.room : "")}" required></div><div><label>Doctor (printed on parcha)</label><input id="ddr" maxlength="60" value="${esc(e ? e.doc : "")}" placeholder="e.g. Dr. Sharma"></div><div><label>Daily tokens *</label><input id="dcp" type="number" min="10" max="500" value="${e ? e.cap : 50}" required></div><div><label>Fee (₹) *</label><input id="dfe" type="number" min="0" max="5000" value="${e ? e.fee : 10}" required></div><div class="act"><button class="btn" id="dsv">${e ? "Save changes" : "Add department"}</button>${e ? `<button type="button" class="btn ghost" id="dcn">Cancel</button>` : ""}</div></form></div>
<div class="card wrap"><table class="tbl"><tr><th>Department</th><th>Code</th><th>Room</th><th>Daily tokens (online / offline)</th><th>Fee</th><th>Waiting</th><th></th></tr>${DEPTS.map(
        (d, i) => {
          const q = quota(d);
          return `<tr><td><b>${esc(d.n)}</b></td><td>${esc(d.p)}</td><td>${esc(d.room)}</td><td>${d.cap} (${q.on} / ${q.off})</td><td>${d.fee ? "₹" + d.fee : "Free"}</td><td>${waiting(d.n)}</td><td class="ra"><button class="mini" data-e="${i}">Edit</button> <button class="mini del" data-x="${i}">Remove</button></td></tr>`;
        },
      ).join("")}</table></div>`,
  );
};
V.depts.after = () => {
  $("#dsv").onclick = async () => {
    if (!$("#df").reportValidity()) return;
    const n = $("#dnm").value.trim(),
      room = $("#drm").value.trim(),
      doctor = $("#ddr").value.trim(),
      cap = Math.max(10, Math.min(500, +$("#dcp").value || 50)),
      fee = Math.max(0, Math.min(5000, Math.round(+$("#dfe").value || 0))),
      i = S.editDept,
      btn = $("#dsv");
    if (DEPTS.some((d, j) => j !== i && d.n.toLowerCase() === n.toLowerCase()))
      return toast("This department already exists");
    btn.disabled = true;
    try {
      if (i != null) {
        await SC.saveDept(DEPTS[i].id, { name: n, room, doctor, dailyCap: cap, fee });
        S.editDept = null;
        toast("Department updated");
      } else {
        await SC.saveDept(null, {
          name: n,
          code: $("#dcd").value,
          room,
          doctor,
          dailyCap: cap,
          fee,
        });
        toast("Department added: " + n);
      }
      route();
    } catch (e) {
      btn.disabled = false;
      SC.error(e);
    }
  };
  const c = $("#dcn");
  if (c)
    c.onclick = () => {
      S.editDept = null;
      route();
    };
  document.querySelectorAll("[data-e]").forEach(
    (b) =>
      (b.onclick = () => {
        S.editDept = +b.dataset.e;
        route();
      }),
  );
  document.querySelectorAll("[data-x]").forEach(
    (b) =>
      (b.onclick = async () => {
        const d = DEPTS[+b.dataset.x];
        if (!confirm("Remove department " + d.n + "?")) return;
        try {
          await SC.removeDept(d.id);
          S.editDept = null;
          toast("Department removed");
          route();
        } catch (e) {
          SC.error(e);
        }
      }),
  );
};

V.doctors = () =>
  shell(
    "doctors",
    head(
      "OPD Status",
      "Set whether each department's OPD is available. Patients are notified of changes.",
    ) +
      `<div class="card wrap"><table class="tbl"><tr><th>Department</th><th>Room</th><th>Timing</th><th>Status</th><th>Current token</th></tr>
${DEPTS.map((d, i) => `<tr><td><b>${esc(d.n)}</b></td><td>${esc(d.room)}</td><td>${esc(d.tm)}</td><td><select class="ss" data-s="${i}" aria-label="Status of ${esc(d.n)}">${DOC_STATUS.map((s) => `<option${s === d.st ? " selected" : ""}>${s}</option>`).join("")}</select></td><td>${curTok(d.n)}</td></tr>`).join("")}</table></div>`,
  );
V.doctors.after = () =>
  document.querySelectorAll("[data-s]").forEach(
    (s) =>
      (s.onchange = async () => {
        const d = DEPTS[+s.dataset.s];
        try {
          await SC.setStatus(d.id, s.value);
        } catch (e) {
          SC.error(e);
        }
        route();
      }),
  );

V.analytics = () => {
  S.atab = S.atab || 0;
  const st = S.stats || {
    waitByHour: [],
    departments: [],
    total: 0,
    waiting: 0,
    completed: 0,
    cancelled: 0,
  };
  const wh = new Map(st.waitByHour.map((w) => [w.hour, w.avgMinutes]));
  const pts = [8, 9, 10, 11, 12, 13, 14, 15, 16].map((h) =>
    Math.min(60, wh.get(h) || 0),
  );
  const P = pts.map((v, i) => [40 + i * 52, 170 - v * 2.6]);
  const col = ["#2a78d1", "#d98a0b", "#7c5cd6", "#e5383b", "#94a3b8"];
  const tot = st.departments.reduce((a, d) => a + d.count, 0);
  const top = st.departments.slice(0, 4);
  const cnt = [
    ...top.map((d) => d.count),
    tot - top.reduce((a, d) => a + d.count, 0),
  ];
  const pc = cnt.map((c) => (tot ? Math.round((c / tot) * 100) : 0));
  const nm = [...top.map((d) => d.name), "Others"];
  let a = 0;
  const g = tot
    ? pc
        .map((p, i) => {
          const s = a;
          a += p;
          return `${col[i]} ${s}% ${a}%`;
        })
        .join(",")
    : "#e2e8f0 0% 100%";

  let content = "";
  if (S.atab === 0) {
    content = `
  <div class="card"><b>Average waiting time (minutes)</b><svg viewBox="0 0 470 210" style="width:100%;max-width:640px"><g stroke="var(--line)">${[0, 1, 2, 3].map((i) => `<line x1="40" x2="460" y1="${170 - i * 52}" y2="${170 - i * 52}"/>`).join("")}</g><polyline fill="none" stroke="#2a78d1" stroke-width="3" points="${P.map((p) => p.join(",")).join(" ")}"/>${P.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" fill="#2a78d1"/>`).join("")}<g fill="var(--mute)" font-size="11">${["8 AM", "10 AM", "12 PM", "2 PM", "4 PM"].map((t, i) => `<text x="${30 + i * 104}" y="195">${t}</text>`).join("")}</g></svg></div><br>
  <div class="card"><b>Queue by department</b><div class="donutw"><div class="donut" style="background:conic-gradient(${g})"><div><span>${tot}<small>Total</small></span></div></div><div class="leg">${nm.map((n, i) => `<div><i style="background:${col[i]}"></i>${esc(n)} <b style="margin-left:auto;padding-left:30px">${pc[i]}%</b></div>`).join("")}</div></div></div>`;
  } else if (S.atab === 1) {
    const waitSum = st.waitByHour.reduce((a, b) => a + b.avgMinutes, 0);
    const waitAvg = st.waitByHour.length
      ? Math.round(waitSum / st.waitByHour.length)
      : 0;
    content = `
  <div class="card"><b>Waiting Time Overview</b>
    <div style="display:flex; justify-content:space-around; margin-top:20px;">
      <div style="text-align:center;">
        <div style="font-size:32px; color:var(--warn); font-weight:bold;">${waitAvg} min</div>
        <div style="color:var(--mute);">Average Wait Today</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:32px; color:var(--pri); font-weight:bold;">${Math.max(...pts, 0)} min</div>
        <div style="color:var(--mute);">Peak Wait Today</div>
      </div>
    </div>
  </div><br>
  <div class="card"><b>Waiting Time by Hour</b><svg viewBox="0 0 470 210" style="width:100%;max-width:640px"><g stroke="var(--line)">${[0, 1, 2, 3].map((i) => `<line x1="40" x2="460" y1="${170 - i * 52}" y2="${170 - i * 52}"/>`).join("")}</g>
  ${pts.map((v, i) => `<rect x="${40 + i * 52 - 10}" y="${170 - v * 2.6}" width="20" height="${v * 2.6}" fill="var(--warn)" rx="2"/>`).join("")}
  <g fill="var(--mute)" font-size="11">${["8 AM", "9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM", "3 PM", "4 PM"].map((t, i) => `<text x="${30 + i * 52}" y="195">${t}</text>`).join("")}</g></svg></div>
      `;
  } else {
    const totalTokens = st.total || 1; // avoid divide by zero
    const cancelRate = Math.round((st.cancelled / totalTokens) * 100) || 0;
    content = `
  <div class="card"><b>No-Show & Cancellation Analytics</b>
    <div style="display:flex; justify-content:space-around; margin-top:20px;">
      <div style="text-align:center;">
        <div style="font-size:32px; color:var(--bad); font-weight:bold;">${cancelRate}%</div>
        <div style="color:var(--mute);">No-Show Rate</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:32px; color:var(--bad); font-weight:bold;">${st.cancelled}</div>
        <div style="color:var(--mute);">Total Cancelled</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:32px; color:var(--ok); font-weight:bold;">${st.completed}</div>
        <div style="color:var(--mute);">Total Completed</div>
      </div>
    </div>
  </div><br>
  <div class="card"><b>Token Status Distribution</b>
    <div style="display:flex; align-items:center; height:30px; border-radius:4px; overflow:hidden; margin-top:20px;">
      <div style="width:${(st.completed / totalTokens) * 100}%; background:var(--ok); height:100%;"></div>
      <div style="width:${(st.cancelled / totalTokens) * 100}%; background:var(--bad); height:100%;"></div>
      <div style="width:${((st.waiting + st.consultation + st.emergency) / totalTokens) * 100}%; background:var(--warn); height:100%;"></div>
    </div>
    <div style="display:flex; justify-content:space-between; margin-top:10px; font-size:14px; color:var(--mute);">
      <span>${st.completed} Completed</span>
      <span>${st.cancelled} Cancelled</span>
      <span>${st.waiting + st.consultation + st.emergency} Active</span>
    </div>
  </div>
      `;
  }

  return shell(
    "analytics",
    head("Analytics & Reports", "Insights for better hospital management") +
      `<div class="tabs"><button class="${S.atab === 0 ? "on" : ""}" data-tab="0">Queue Trends</button><button class="${S.atab === 1 ? "on" : ""}" data-tab="1">Waiting Time</button><button class="${S.atab === 2 ? "on" : ""}" data-tab="2">No-Show Rate</button></div>
` +
      content,
  );
};

V.analytics.after = () => {
  document.querySelectorAll("[data-tab]").forEach((b) => {
    b.onclick = () => {
      S.atab = parseInt(b.dataset.tab);
      route(true);
    };
  });
};

V.emergency = () =>
  shell(
    "emergency",
    head(
      "Emergency Priority",
      "Mark a patient as emergency to give them priority in the queue",
    ) +
      `<form class="card emg" id="emf" onsubmit="return false"><label>Patient Name *</label><input id="epn" placeholder="Enter patient name" autocomplete="name" required><label>Patient Address *</label><textarea id="eaddr" placeholder="Enter complete patient address" required></textarea><label>Mobile number *</label><div class="otp-field-wrap"><div style="display:flex;gap:8px;align-items:center"><input id="et" type="tel" inputmode="numeric" placeholder="Enter 10-digit mobile number" autocomplete="tel" required style="flex:1"><button type="button" class="btn ghost" id="et-send" style="white-space:nowrap;padding:9px 14px">Send OTP</button></div><div id="et-otp-box" style="display:none;margin-top:8px"></div></div><label>Department *</label><select id="ed">${dn()
        .map(
          (d) =>
            `<option${d === "Emergency" ? " selected" : ""}>${esc(d)}</option>`,
        )
        .join(
          "",
        )}</select><br><button class="btn red block" id="eb">Set Emergency Priority</button></form>`,
  );
V.emergency.after = () => {
  const emgOtp = setupBookingOtpVerifier({
    phoneInputId: "#et",
    sendBtnId: "#et-send",
    sectionId: "#et-otp-box",
    prefix: "emg-otp"
  });
  $("#eb").onclick = async () => {
    if (!$("#emf").reportValidity()) return;
    if (!emgOtp.isVerified()) {
      toast("Please verify the mobile number with OTP first");
      $("#et").focus();
      return;
    }
    const n = $("#epn").value.trim(),
      t = $("#et").value.trim(),
      a = $("#eaddr").value.trim(),
      d = $("#ed").value,
      b = $("#eb");
    b.disabled = true;
    try {
      const r = await SC.emergency(
        { departmentId: dep(d).id, name: n, address: a, phone: t }
      );
      toast(`Emergency priority: token ${r.token}${r.name || n ? ` (${r.name || n})` : ""} (Room ${r.room})`);
      setTimeout(() => (location.hash = "#/alerts"), 700);
    } catch (e) {
      SC.error(e);
    } finally {
      b.disabled = false;
    }
  };
};

V.alerts = () => {
  const f = S.nf,
    list = S.notes.filter((n) => f === "All" || n.k === f),
    can = "Notification" in window && Notification.permission === "default";
  return shell(
    "alerts",
    head(
      "Notifications",
      "Appointments, token updates, queue status, OPD availability and room changes",
    ) +
      `<div class="tabs">${["All", ...Object.keys(KIND)].map((k) => `<button class="${k === f ? "on" : ""}" data-nf="${k}">${k === "All" ? "All" : KIND[k][1]}</button>`).join("")}<button id="mr" style="margin-left:auto">Mark all as read</button>${can ? `<button id="en">Enable browser alerts</button>` : ""}</div>
<div class="card"><ul class="nl">${list.map((n) => `<li class="${n.read ? "" : "new"}"><i style="background:${KIND[n.k][0]}"></i><span><small class="kt" style="color:${KIND[n.k][0]}">${KIND[n.k][1]}</small><br>${esc(n.m)}</span><em>${n.t}</em></li>`).join("") || `<li>No notifications.</li>`}</ul></div>`,
  );
};
V.alerts.after = () => {
  document.querySelectorAll("[data-nf]").forEach(
    (b) =>
      (b.onclick = () => {
        S.nf = b.dataset.nf;
        route();
      }),
  );
  $("#mr").onclick = () => {
    SC.markRead();
    route();
  };
  const en = $("#en");
  if (en)
    en.onclick = () => Notification.requestPermission().then(() => route());
  SC.markRead();
  badge();
};

// ---------- router ----------
// ---------- logins: patients and staff have separate login pages and separate dashboards ----------
// Staff pages need the server login (JWT); every staff API call is also checked on the server.
const STAFF = new Set(["staff", "admin", "counter", "sparcha", "depts", "doctors", "analytics", "emergency", "scan"]);
// Patient pages need a patient login (name + mobile number).
const PATIENT = new Set(["patient", "register", "queue", "parcha", "genqr", "mobile"]);

// Public layout (no sidebar) used by both login pages
const authPage = (kind, body) =>
  `<div class="u"><span>Helpline: 1800-000-0000 &nbsp;|&nbsp; <b class="emgred">${kind === "staff" ? "EMERGENCY: 108" : "Emergency: 108"}</b></span><span><button id="th" aria-label="Toggle theme">Theme</button></span></div>
<div class="brand"><a class="logo" href="#/"><i>+</i><div><b>SmartCare Hospital</b><small>OPD Token and Queue Management Portal</small></div></a><div class="links">${kind === "staff" ? '<a class="emgred" href="#/emergency">Emergency</a>' : ""}<a href="#/patient-login">Patient Login</a><a href="#/staff-login">Staff Login</a></div></div>
<section class="sec2"><div class="in" style="display:flex;justify-content:center"><div style="width:100%;max-width:420px">${body}<p class="sub" style="text-align:center;margin-top:14px">${kind === "staff" ? 'Are you a patient? <a href="#/patient-login">Patient login</a>' : 'Hospital staff? <a href="#/staff-login">Staff login</a>'} &nbsp;|&nbsp; <a href="#/">Back to home</a></p></div></div></section>`;

V["patient-login"] = () =>
  authPage(
    "patient",
    `<div class="card" id="plf">
<span class="tag">Patient</span><h2 class="t" style="margin:6px 0" id="plt">Patient Login</h2><p class="sub" id="pls"></p>
<div id="plfields"></div>
<button class="btn block" id="plb" style="margin-top:12px"></button>
<p class="sub" style="text-align:center;margin-top:12px" id="pllinks"></p></div>`,
  );
V["patient-login"].after = () => {
  let mode = "login"; // login | register | forgot
  let otpSent = false;
  const input = (id, label, attrs) => `<label>${label}</label><input id="${id}" ${attrs}>`;
  const otpRow = () =>
    `<label>Mobile number *</label><div style="display:flex;gap:8px"><input id="plp" type="tel" inputmode="numeric" autocomplete="tel" placeholder="10-digit mobile number" maxlength="13" style="flex:1" value="${esc(patientPhone())}"><button type="button" class="btn ghost" id="pso">${otpSent ? "Resend OTP" : "Send OTP"}</button></div>` +
    (otpSent ? input("plo", "OTP *", 'inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="Enter 6-digit OTP"') : "");
  const render = () => {
    const titles = { login: "Patient Login", register: "Create Patient Account", forgot: "Forgot Password" };
    const subs = {
      login: "Sign in with your mobile number and password to book your OPD token and track your queue.",
      register: "New patient? Fill in your details and verify your mobile number with an OTP.",
      forgot: "Verify your mobile number with an OTP and set a new password.",
    };
    $("#plt").textContent = titles[mode];
    $("#pls").textContent = subs[mode];
    $("#plfields").innerHTML =
      mode === "login"
        ? input("plp", "Mobile number *", `type="tel" inputmode="numeric" autocomplete="tel" placeholder="10-digit mobile number" maxlength="13" value="${esc(patientPhone())}"`) +
          input("plw", "Password *", 'type="password" autocomplete="current-password" placeholder="Your password"') +
          '<p class="sub" style="text-align:right;margin:6px 0 0"><a href="#" id="pfg">Forgot password?</a></p>'
        : mode === "register"
          ? input("pln", "Full name *", `autocomplete="name" placeholder="Your full name" value="${esc(S.user === "Patient" ? "" : S.user)}"`) +
            otpRow() +
            input("plw", "Create password *", 'type="password" autocomplete="new-password" placeholder="At least 6 characters"') +
            input("plw2", "Re-enter password *", 'type="password" autocomplete="new-password" placeholder="Re-enter password"')
          : otpRow() +
            input("plw", "New password *", 'type="password" autocomplete="new-password" placeholder="At least 6 characters"') +
            input("plw2", "Re-enter new password *", 'type="password" autocomplete="new-password" placeholder="Re-enter new password"');
    $("#plb").textContent = { login: "Login", register: "Verify OTP &amp; Register", forgot: "Verify OTP &amp; Reset Password" }[mode].replace(/&amp;/g, "&");
    $("#pllinks").innerHTML =
      mode === "login"
        ? 'New patient? <a href="#" id="pgr">Create account / Register</a>'
        : mode === "register"
          ? 'Already registered? <a href="#" id="pgl">Login</a>'
          : '<a href="#" id="pgl">Back to login</a>';
    const sw = (m) => (e) => { e.preventDefault(); mode = m; otpSent = false; render(); };
    if ($("#pfg")) $("#pfg").onclick = sw("forgot");
    if ($("#pgr")) $("#pgr").onclick = sw("register");
    if ($("#pgl")) $("#pgl").onclick = sw("login");
    if ($("#pso")) $("#pso").onclick = sendOtp;
    $("#plfields").onkeydown = (e) => { if (e.key === "Enter") submit(); };
    const first = $("#pln") || $("#plp") || $("#plw");
    if (first && !first.value) first.focus();
  };
  const cleanPhone = () => $("#plp").value.replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, "");
  const phoneOk = () => /^[6-9]\d{9}$/.test(cleanPhone());
  const done = (r, msg) => {
    const p = r.patient;
    S.user = p.name;
    S.patient = true;
    pst.set("sc_name", p.name);
    pst.set("sc_phone", p.phone);
    pst.set("sc_patient", "1");
    S.area = "patient";
    const nx = S.next && PATIENT.has(S.next) ? S.next : "patient";
    S.next = null;
    toast(msg || "Welcome, " + p.name);
    if (location.hash === "#/" + nx) route();
    else location.hash = "#/" + nx;
  };
  async function sendOtp() {
    if (mode === "register" && $("#pln").value.trim().length < 2) return toast("Enter your full name");
    if (!phoneOk()) return toast("Enter a valid 10-digit mobile number");
    const keep = { n: $("#pln") && $("#pln").value, p: $("#plp").value, w: $("#plw") && $("#plw").value, w2: $("#plw2") && $("#plw2").value };
    const b = $("#pso");
    b.disabled = true;
    try {
      const r = await SC.patientAuth("/send-otp", { phone: cleanPhone(), purpose: mode === "register" ? "register" : "reset" });
      otpSent = true;
      render();
      if ($("#pln")) $("#pln").value = keep.n || "";
      $("#plp").value = keep.p;
      if ($("#plw")) $("#plw").value = keep.w || "";
      if ($("#plw2")) $("#plw2").value = keep.w2 || "";
      toast(r.devOtp ? `OTP sent. Test OTP: ${r.devOtp}` : "OTP sent to your mobile number");
      $("#plo").focus();
    } catch (e) {
      b.disabled = false;
      toast(e.message);
    }
  }
  async function submit() {
    if (!phoneOk()) return toast("Enter a valid 10-digit mobile number");
    const phone = cleanPhone();
    const pw = $("#plw").value;
    if (mode === "login") {
      if (!pw) return toast("Enter your password");
    } else {
      if (mode === "register" && $("#pln").value.trim().length < 2) return toast("Enter your full name");
      if (!otpSent) return toast("Click Send OTP first");
      if (!/^\d{6}$/.test($("#plo").value.trim())) return toast("Enter the 6-digit OTP");
      if (pw.length < 6) return toast("Password must be at least 6 characters");
      if (pw !== $("#plw2").value) return toast("Passwords do not match");
    }
    const b = $("#plb");
    b.disabled = true;
    try {
      if (mode === "login") done(await SC.patientAuth("/login", { phone, password: pw }));
      else if (mode === "register")
        done(await SC.patientAuth("/register", { name: $("#pln").value.trim(), phone, password: pw, confirmPassword: $("#plw2").value, otp: $("#plo").value.trim() }), "Account created. Welcome!");
      else done(await SC.patientAuth("/forgot-password", { phone, password: pw, confirmPassword: $("#plw2").value, otp: $("#plo").value.trim() }), "Password changed. You are logged in.");
    } catch (e) {
      b.disabled = false;
      toast(e.message);
    }
  }
  $("#plb").onclick = submit;
  render();
};

V["staff-login"] = () =>
  authPage(
    "staff",
    `<form class="card" id="lf" onsubmit="return false"><span class="tag">Staff / Admin</span><h2 class="t" style="margin:6px 0">Staff Login</h2><p class="sub">Hospital staff only. Sign in to issue counter parchas, scan QR codes, manage departments and view reports.</p>
<label>Username</label><input id="lu" autocomplete="username" required><label>Password</label><input id="lp" type="password" autocomplete="current-password" required><br><button class="btn block" id="lb">Login as Staff</button></form>`,
  );
V["staff-login"].after = () => {
  const go = async () => {
    const u = $("#lu").value.trim(),
      p = $("#lp").value;
    if (!u || !p) return toast("Enter username and password");
    const b = $("#lb");
    b.disabled = true;
    try {
      await SC.login(u, p);
      S.area = "staff";
      const nx = S.next && STAFF.has(S.next) ? S.next : "staff";
      S.next = null;
      if (location.hash === "#/" + nx) route();
      else location.hash = "#/" + nx;
    } catch (e) {
      b.disabled = false;
      toast(e.message);
    }
  };
  $("#lb").onclick = go;
  $("#lp").onkeydown = $("#lu").onkeydown = (e) => {
    if (e.key === "Enter") go();
  };
  $("#lu").focus();
};

// ---------- patient dashboard ----------
V.patient = () => {
  const m = S.me;
  const tile = (href, title, text, primary) =>
    `<div class="card" style="text-align:center;padding:28px 18px${primary ? ";border:2px solid var(--pri)" : ""}"><h3>${title}</h3><p class="sub">${text}</p><br><a class="btn${primary ? "" : " ghost"} block" href="${href}">Open</a></div>`;
  return shell(
    "patient",
    head("Welcome, " + esc(S.user), "Your patient dashboard: book a token, track your queue and keep your parcha.") +
      (m
        ? `<div class="card" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:14px;margin-bottom:16px"><div><small style="color:var(--pri)">Your token</small><div class="big" style="font-size:30px">${esc(m.t)}</div></div><div><small>Department</small><br><b>${esc(m.d)}</b></div><div><small>Room number</small><br><b>${esc(dep(m.d).room || "–")}</b></div><div><small>Patients ahead</small><br><b>${ahead()}</b></div><div><small>Estimated time</small><br><b>${est()}</b></div><div>${pill(m.s || "Waiting")}</div></div>`
        : `<div class="card" style="margin-bottom:16px"><b>No active token</b><p class="sub">You have not booked a token yet.</p><a class="btn" href="#/register">Book a token</a></div>`) +
      `<div class="grid2">
${tile("#/register", "Book Token", "Pick a department and pay the fee online.", !m)}
${tile("#/queue", "My Queue", "See patients ahead and your estimated time.", !!m)}
${tile("#/parcha", "Token / Parcha", "View or print your token and parcha.")}
${tile("#/genqr", "My QR Code", "Show your token QR at the room.")}
${tile("#/live", "Live Queue", "Current status of every department.")}
${tile("#/alerts", "Notifications", "Updates about your token and the hospital.")}
</div>`,
  );
};

// ---------- router ----------
function route(keep) {
  stopCam();
  const r = location.hash.replace(/^#\/?/, "");
  let v;
  if (r === "staff-login" && S.admin) {
    location.hash = "#/staff";
    return;
  }
  if (r === "patient-login" && S.patient) {
    location.hash = "#/patient";
    return;
  }
  if (STAFF.has(r)) {
    S.area = "staff";
    if (!S.admin) {
      S.next = r;
      v = V["staff-login"];
    }
  } else if (PATIENT.has(r)) {
    S.area = "patient";
    if (!S.patient) {
      S.next = r;
      v = V["patient-login"];
    }
  } else if (r === "live" || r === "alerts") {
    // shared pages (public): use the layout of whoever is logged in
    if (S.admin && (S.area === "staff" || !S.patient)) S.area = "staff";
    else S.area = "patient";
  }
  v = v || V[r] || V[""];
  const mount =
    document.getElementById("smartcare-mount") ||
    document.getElementById("root");
  if (!mount) return;
  mount.innerHTML = v();
  if (keep !== true) window.scrollTo(0, 0);
  v.after && v.after();
  const t = $("#th");
  if (t)
    t.onclick = () => {
      const d = document.documentElement,
        dark =
          getComputedStyle(d).getPropertyValue("--bg").trim() === "#0c1b2b";
      d.dataset.theme = dark ? "light" : "dark";
    };
}
addEventListener("hashchange", route);
{
  const m =
    document.getElementById("smartcare-mount") ||
    document.getElementById("root");
  if (m)
    m.innerHTML =
      '<p style="padding:40px;text-align:center;font-family:sans-serif">Loading SmartCare…</p>';
}
SC.init()
  .then(() => route())
  .catch(SC.fail);
