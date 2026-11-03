import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http.js';
import { todayKey, fmtDateTime } from '../utils/time.js';
import { LabBooking, LAB_ROOMS, LAB_TESTS, LAB_CATEGORIES, labTestById } from '../db.js';

// Patients can book for today and the next two days.
const ADVANCE_DAYS = 2;
// One patient can hold at most this many active lab bookings per day (stops one number hogging a room).
const MAX_PER_PHONE_PER_DAY = 6;
const ACTIVE = ['Booked', 'Sample Collected'];

// Codes avoid look-alike characters (0/O, 1/I) because patients read them out at the counter.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rand = (n) => Array.from({ length: n }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const newBookingCode = () => `LB-${rand(8)}`;
const newReportCode = () => `LR-${rand(10)}`;

// ---------- time helpers (hospital local time) ----------
const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const label12 = (min) => {
  const h = Math.floor(min / 60);
  return `${String(h % 12 || 12).padStart(2, '0')}:${String(min % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
function nowMinutes() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: env.TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const get = (t) => Number(p.find((x) => x.type === t).value);
  return get('hour') * 60 + get('minute');
}
export const addDays = (day, n) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const labDays = () => Array.from({ length: ADVANCE_DAYS + 1 }, (_, i) => addDays(todayKey(), i));

// ---------- catalog ----------
const hoursOf = (t) => {
  const r = LAB_ROOMS[t.room];
  return `${label12(toMin(t.from || r.open))} – ${label12(toMin(t.to || r.close))}`;
};

const publicTest = (t) => {
  const r = LAB_ROOMS[t.room];
  return { id: t.id, name: t.name, category: t.category, sample: t.sample, prep: t.prep, room: r.id, roomName: r.name, floor: r.floor, hours: hoursOf(t) };
};

export const labCatalog = () => ({ categories: LAB_CATEGORIES, days: labDays(), today: todayKey(), tests: LAB_TESTS.map(publicTest) });

// Staff need the parameter list to enter results.
export const labCatalogForStaff = () =>
  LAB_TESTS.map((t) => ({
    ...publicTest(t),
    params: t.params.map((p) => ({ key: p.key, name: p.name, unit: p.unit || '', type: p.type === 'text' ? 'text' : 'number', ref: refText(p) })),
  }));

function slotList(test) {
  const r = LAB_ROOMS[test.room];
  const out = [];
  for (let s = toMin(test.from || r.open); s + r.slotMin <= toMin(test.to || r.close); s += r.slotMin) {
    out.push({ start: hhmm(s), startMin: s, label: `${label12(s)} – ${label12(s + r.slotMin)}` });
  }
  return out;
}

function mustTest(testId) {
  const t = labTestById(testId);
  if (!t) throw new HttpError(404, 'Unknown lab test');
  return t;
}
function mustDay(day) {
  if (!labDays().includes(day)) throw new HttpError(400, `You can book lab tests for today and the next ${ADVANCE_DAYS} days only.`);
}

// Free seats for every slot of a test on a day (the room is shared by all tests done in it).
export async function slotsFor(testId, day) {
  const test = mustTest(testId);
  mustDay(day);
  const room = LAB_ROOMS[test.room];
  const taken = await LabBooking.aggregate([
    { $match: { room: room.id, day, seat: { $exists: true } } },
    { $group: { _id: '$slot', n: { $sum: 1 } } },
  ]);
  const used = new Map(taken.map((x) => [x._id, x.n]));
  const isToday = day === todayKey();
  const nowMin = nowMinutes();
  const slots = slotList(test)
    .filter((s) => !isToday || s.startMin > nowMin)
    .map((s) => {
      const free = Math.max(0, room.capacity - (used.get(s.start) || 0));
      return { start: s.start, label: s.label, free, capacity: room.capacity, full: free === 0 };
    });
  return { test: publicTest(test), day, slots };
}

// ---------- patient side ----------
const reportView = (b) =>
  b.status === 'Report Ready' && b.report
    ? { code: b.report.code, results: b.report.results, remarks: b.report.remarks || '', issuedAt: fmtDateTime(b.report.issuedAt), issuedBy: b.report.issuedBy || '' }
    : null;

const view = (b) => {
  const t = labTestById(b.testId);
  return {
    code: b.code,
    testId: b.testId,
    testName: b.testName,
    category: b.category,
    sample: b.sample,
    prep: t ? t.prep : '',
    room: b.room,
    roomName: b.roomName,
    day: b.day,
    slot: b.slot,
    slotLabel: b.slotLabel,
    status: b.status,
    report: reportView(b),
  };
};

export async function createBooking({ testId, day, slot, name, phone, age }) {
  const test = mustTest(testId);
  mustDay(day);
  const room = LAB_ROOMS[test.room];
  const s = slotList(test).find((x) => x.start === slot);
  if (!s) throw new HttpError(400, 'That time slot is not available for this test.');
  if (day === todayKey() && s.startMin <= nowMinutes()) throw new HttpError(409, 'That slot has already started. Please choose a later slot.');

  if (await LabBooking.exists({ 'patient.phone': phone, testId, day, status: { $in: ACTIVE } }))
    throw new HttpError(409, 'You already have this test booked for that day. See "My Lab Reports".');
  if ((await LabBooking.countDocuments({ 'patient.phone': phone, day, status: { $in: ACTIVE } })) >= MAX_PER_PHONE_PER_DAY)
    throw new HttpError(409, `You can book at most ${MAX_PER_PHONE_PER_DAY} lab tests for one day.`);

  const doc = {
    testId, testName: test.name, category: test.category, sample: test.sample, room: room.id, roomName: room.name,
    day, slot: s.start, slotLabel: s.label, patient: { name, phone, ...(age != null ? { age } : {}) },
  };
  // Take the first free seat. Two people racing for the last seat: the unique index rejects one of them.
  let attempts = 0;
  for (let seat = 1; seat <= room.capacity && attempts < room.capacity + 5; attempts++) {
    try {
      return view(await LabBooking.create({ ...doc, seat, code: newBookingCode() }));
    } catch (e) {
      if (e && e.code === 11000) {
        if (e.keyPattern && e.keyPattern.code) continue; // booking-code collision: retry the same seat with a new code
        seat++; // seat taken: try the next one
        continue;
      }
      throw e;
    }
  }
  throw new HttpError(409, 'This time slot has just become full. Please choose another slot.');
}

export async function myBookings(phone, codes) {
  const rows = await LabBooking.find({ code: { $in: codes }, 'patient.phone': phone }).sort({ day: -1, slot: -1 });
  return rows.map(view);
}

export async function lookupBooking(phone, code) {
  const b = await LabBooking.findOne({ code, 'patient.phone': phone });
  if (!b) throw new HttpError(404, 'No lab booking found for this code and mobile number.');
  return view(b);
}

export async function cancelBooking(phone, code) {
  const b = await LabBooking.findOneAndUpdate(
    { code, 'patient.phone': phone, status: 'Booked' },
    { $set: { status: 'Cancelled' }, $unset: { seat: 1 } },
    { new: true }
  );
  if (b) return view(b);
  const existing = await LabBooking.findOne({ code, 'patient.phone': phone });
  if (!existing) throw new HttpError(404, 'Lab booking not found.');
  throw new HttpError(409, existing.status === 'Cancelled' ? 'This booking is already cancelled.' : 'The sample is already collected, so this booking can no longer be cancelled.');
}

// ---------- staff side ----------
const staffView = (b) => ({
  ...view(b),
  patient: { name: (b.patient && b.patient.name) || '', phone: (b.patient && b.patient.phone) || '', age: b.patient && b.patient.age != null ? b.patient.age : null },
});

export async function bookingsForDay(day) {
  const rows = await LabBooking.find({ day }).sort({ room: 1, slot: 1, seat: 1 }).limit(500);
  return rows.map(staffView);
}

export async function collectSample(code) {
  const b = await LabBooking.findOneAndUpdate({ code, status: 'Booked' }, { $set: { status: 'Sample Collected', collectedAt: new Date() } }, { new: true });
  if (b) return staffView(b);
  const existing = await LabBooking.findOne({ code });
  if (!existing) throw new HttpError(404, 'Lab booking not found.');
  throw new HttpError(409, `This booking is "${existing.status}", so the sample cannot be marked as collected.`);
}

const fmtNum = (n) => String(n);
function refText(p) {
  if (p.type === 'text') return p.normal && p.normal.length ? p.normal[0].replace(/^./, (c) => c.toUpperCase()) : '';
  return `${fmtNum(p.low)} – ${fmtNum(p.high)}`;
}
function flagOf(p, value) {
  if (p.type === 'text') return !p.normal || p.normal.length === 0 || p.normal.includes(value.trim().toLowerCase()) ? 'Normal' : 'Abnormal';
  const n = Number(value);
  return n < p.low ? 'Low' : n > p.high ? 'High' : 'Normal';
}

export async function issueReport(code, { values, remarks }, admin) {
  const b = await LabBooking.findOne({ code });
  if (!b) throw new HttpError(404, 'Lab booking not found.');
  if (b.status === 'Report Ready') throw new HttpError(409, 'The report for this booking is already issued.');
  if (b.status !== 'Sample Collected') throw new HttpError(409, b.status === 'Cancelled' ? 'This booking was cancelled.' : 'Mark the sample as collected before entering results.');
  const test = mustTest(b.testId);

  const results = test.params.map((p) => {
    const raw = values[p.key] == null ? '' : String(values[p.key]).trim();
    if (!raw) throw new HttpError(400, `Enter a value for "${p.name}".`);
    if (p.type !== 'text' && !Number.isFinite(Number(raw))) throw new HttpError(400, `"${p.name}" must be a number.`);
    return { key: p.key, name: p.name, unit: p.unit || '', value: raw.slice(0, 60), ref: refText(p), flag: flagOf(p, raw) };
  });

  for (let i = 0; i < 5; i++) {
    try {
      const done = await LabBooking.findOneAndUpdate(
        { _id: b._id, status: 'Sample Collected' },
        { $set: { status: 'Report Ready', report: { code: newReportCode(), results, remarks: remarks || '', issuedAt: new Date(), issuedBy: (admin && (admin.name || admin.username)) || 'Lab' } } },
        { new: true }
      );
      if (!done) throw new HttpError(409, 'The report for this booking was just issued by someone else.');
      return staffView(done);
    } catch (e) {
      if (e && e.code === 11000) continue; // report-code collision: pick a new code
      throw e;
    }
  }
  throw new HttpError(500, 'Could not create a report code. Please try again.');
}

// Doctor scans the QR on the patient's report: the QR carries the report code, the full report comes from here.
export async function reportByCode(reportCode) {
  const b = await LabBooking.findOne({ 'report.code': reportCode });
  if (!b) throw new HttpError(404, 'No lab report found for this QR code.');
  return staffView(b);
}
