// End-to-end API test. Needs a running API + MongoDB, started in demo payment mode:
//   PAYMENT_MODE=demo ADMIN_PASSWORD=TestPass123 MONGODB_URI=mongodb://127.0.0.1:27017/smartcare_test npm run dev
//   API=http://localhost:5000/api ADMIN_PASSWORD=TestPass123 node tests/e2e.mjs
const API = (process.env.API || 'http://localhost:5000/api').replace(/\/$/, '');
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'TestPass123';

let pass = 0;
const fails = [];
let jwt = '';
const rnd = () => Math.floor(Math.random() * 1e9).toString().padStart(9, '0');

async function call(method, path, body, { auth = false, raw = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) headers.Authorization = 'Bearer ' + jwt;
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch { /* none */ }
  return raw ? { status: res.status, data, res } : { status: res.status, data };
}
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fails.push(name); console.log('  ✘', name, extra ? `\n      ${extra}` : ''); }
}
const section = (s) => console.log('\n' + s);
const person = (extra = {}) => ({ name: 'Test Patient', age: 30, phone: '9' + rnd(), address: '12 Test Road, Noida', ...extra });

section('Health + public data');
let r = await call('GET', '/health');
ok(r.status === 200 && r.data.ok && r.data.database, 'health: API up and database connected', JSON.stringify(r.data));
ok(r.data.paymentMode === 'demo', 'health: payment mode is demo (start the API with PAYMENT_MODE=demo)', r.data.paymentMode);
r = await call('GET', '/departments');
const depts = r.data;
ok(r.status === 200 && depts.length >= 15, `departments: ${depts?.length} seeded`);
const byName = (n) => depts.find((d) => d.name === n);
const emergency = byName('Emergency'); // fee 0 -> free flow
const cardio = byName('Cardiology'); // fee 20 -> demo payment flow
r = await call('GET', '/nope');
ok(r.status === 404, 'unknown /api route returns 404 JSON');

section('Staff auth');
r = await call('POST', '/auth/login', { username: ADMIN_USER, password: 'wrong-password' });
ok(r.status === 401, 'login with wrong password -> 401');
r = await call('POST', '/auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
ok(r.status === 200 && r.data.token, 'login with correct password -> token', JSON.stringify(r.data));
jwt = r.data?.token || '';
r = await call('GET', '/admin/stats');
ok(r.status === 401, 'admin route without token -> 401');
r = await call('GET', '/admin/stats', undefined, { auth: true });
ok(r.status === 200 && typeof r.data.total === 'number', 'admin stats with token');

section('Online booking: validation');
r = await call('POST', '/bookings/online', { ...person(), departmentId: 'abc' });
ok(r.status === 400, 'bad departmentId -> 400');
r = await call('POST', '/bookings/online', { ...person({ phone: '123' }), departmentId: emergency.id });
ok(r.status === 400, 'bad phone -> 400');
r = await call('POST', '/bookings/online', { ...person({ age: 200 }), departmentId: emergency.id });
ok(r.status === 400, 'bad age -> 400');

section('Online booking: free department');
const p1 = person();
r = await call('POST', '/bookings/online', { ...p1, departmentId: emergency.id });
ok(r.status === 201 && r.data.free && r.data.ticket?.token, 'free booking returns a ticket', JSON.stringify(r.data));
const freeToken = r.data?.ticket?.token;
r = await call('GET', '/queue/token/' + freeToken);
ok(r.status === 200 && r.data.status === 'Waiting', 'public token status works');
ok(!JSON.stringify(r.data).match(/Test Patient|Test Road|phone/i), 'public token status has no personal data');
r = await call('GET', '/queue');
ok(r.status === 200 && r.data.some((t) => t.token === freeToken), 'token appears in public live queue');
ok(!JSON.stringify(r.data).match(/Test Patient|Test Road/), 'public live queue has no personal data');

section('Online booking: paid department (demo payment)');
const p2 = person();
r = await call('POST', '/bookings/online', { ...p2, departmentId: cardio.id });
ok(r.status === 201 && r.data.demo && r.data.order?.id, 'paid booking starts a demo order', JSON.stringify(r.data));
const orderId = r.data?.order?.id;
r = await call('GET', '/payments/status/' + orderId);
ok(r.status === 200 && r.data.status === 'created' && !r.data.ticket, 'order is pending before payment');
r = await call('POST', '/payments/demo/confirm', { orderId, method: 'UPI' });
ok(r.status === 200 && r.data.ticket?.token, 'demo confirm issues the token', JSON.stringify(r.data));
const paidToken = r.data?.ticket?.token;
ok(r.data?.ticket?.payment?.amount === cardio.fee, 'receipt shows the department fee');
const again = await call('POST', '/payments/demo/confirm', { orderId, method: 'UPI' });
ok(again.status === 200 && again.data.ticket?.token === paidToken, 'confirming twice is idempotent (same token)');
r = await call('GET', '/departments');
const c2 = r.data.find((d) => d.id === cardio.id);
ok(c2.onlineBooked === cardio.onlineBooked + 1, 'quota counter went up by exactly 1', `${cardio.onlineBooked} -> ${c2.onlineBooked}`);

section('Unpaid reservation can be cancelled');
r = await call('POST', '/bookings/online', { ...person(), departmentId: cardio.id });
const o2 = r.data?.order?.id;
r = await call('POST', '/payments/cancel', { orderId: o2 });
ok(r.status === 200 && r.data.released === true, 'cancel releases the reserved slot');
r = await call('GET', '/departments');
ok(r.data.find((d) => d.id === cardio.id).onlineBooked === c2.onlineBooked, 'quota restored after cancel');

section('Patient accounts (OTP)');
const phone = '9' + rnd();
r = await call('POST', '/patient-auth/send-otp', { phone, purpose: 'register' });
ok(r.status === 200 && /^\d{6}$/.test(r.data.devOtp || ''), 'send-otp returns dev OTP outside production', JSON.stringify(r.data));
const otp = r.data?.devOtp;
r = await call('POST', '/patient-auth/send-otp', { phone, purpose: 'register' });
ok(r.status === 429, 'asking for OTP again within 30s -> 429');
r = await call('POST', '/patient-auth/register', { name: 'Ravi Kumar', phone, password: 'secret12', confirmPassword: 'secret12', otp: '000000' });
ok(r.status === 400, 'register with wrong OTP -> 400');
r = await call('POST', '/patient-auth/register', { name: 'Ravi Kumar', phone, password: 'secret12', confirmPassword: 'secret12', otp });
ok(r.status === 201 && r.data.patient?.phone === phone, 'register with right OTP', JSON.stringify(r.data));
r = await call('POST', '/patient-auth/login', { phone, password: 'secret12' });
ok(r.status === 200, 'patient login');
r = await call('POST', '/patient-auth/login', { phone, password: 'nope-nope' });
ok(r.status === 401, 'patient login wrong password -> 401');

section('Counter booking + staff queue actions');
r = await call('POST', '/admin/counter-bookings', { departmentId: cardio.id, mode: 'Cash', name: 'Counter Pt', phone: '9876543210', address: 'Village Road' }, { auth: true });
ok(r.status === 201 && r.data.ticket?.token && r.data.payment?.receipt, 'counter booking issues token + receipt', JSON.stringify(r.data));
const counterToken = r.data?.ticket?.token;
r = await call('POST', '/admin/counter-bookings', { departmentId: cardio.id, mode: 'Cash', name: 'x' }, { auth: true });
ok(r.status === 400, 'counter booking without phone/address -> 400');
r = await call('GET', '/admin/tokens/' + counterToken, undefined, { auth: true });
ok(r.status === 200 && r.data.patient?.name === 'Counter Pt', 'parcha shows patient name for staff');
r = await call('POST', '/admin/queue/checkin', { token: paidToken }, { auth: true });
ok(r.status === 200 && r.data.status === 'Consultation', 'check-in moves token to Consultation', JSON.stringify(r.data));
r = await call('POST', '/admin/queue/checkin', { token: counterToken }, { auth: true });
ok(r.status === 200 && r.data.status === 'Consultation', 'next check-in works');
r = await call('GET', '/queue/token/' + paidToken);
ok(r.data.status === 'Completed', 'previous consultation was auto-completed');
r = await call('PATCH', `/admin/queue/${counterToken}/status`, { status: 'Completed' }, { auth: true });
ok(r.status === 200 && r.data.status === 'Completed', 'staff can complete a token');
r = await call('POST', '/admin/queue/checkin', { token: 'ZZ-999' }, { auth: true });
ok(r.status === 404, 'check-in of unknown token -> 404');

section('Emergency priority');
r = await call('POST', '/admin/emergency', { token: freeToken, name: 'Test Patient', address: 'Test Road' }, { auth: true });
ok(r.status === 201 && r.data.status === 'Emergency', 'existing token can be marked Emergency', JSON.stringify(r.data));
r = await call('POST', '/admin/emergency', { departmentId: emergency.id, name: 'Walk-in', address: 'Highway', phone: '9000000001' }, { auth: true });
ok(r.status === 201 && r.data.status === 'Emergency', 'new emergency token for a walk-in', JSON.stringify(r.data));

section('Refund');
r = await call('GET', '/admin/payments', undefined, { auth: true });
ok(r.status === 200 && r.data.length >= 2, 'payments list for today');
const refundable = r.data.find((p) => p.source === 'offline' && p.amount > 0 && p.status === 'paid' && p.token !== counterToken);
// make a fresh counter payment to refund (the previous ones were already seen)
r = await call('POST', '/admin/counter-bookings', { departmentId: cardio.id, mode: 'UPI', name: 'Refund Pt', phone: '9876500000', address: 'Somewhere' }, { auth: true });
const refTok = r.data?.ticket?.token;
r = await call('GET', '/admin/payments', undefined, { auth: true });
const pay = r.data.find((p) => p.token === refTok);
r = await call('POST', `/admin/payments/${pay.id}/refund`, { reason: 'test' }, { auth: true });
ok(r.status === 200 && r.data.status === 'refunded', 'waiting patient can be refunded', JSON.stringify(r.data));
r = await call('GET', '/queue/token/' + refTok);
ok(r.data.status === 'Cancelled', 'refunded token is Cancelled');
r = await call('POST', `/admin/payments/${pay.id}/refund`, {}, { auth: true });
ok(r.status === 409, 'second refund -> 409');

section('Departments admin');
r = await call('POST', '/departments', { name: 'Test Dept ' + rnd().slice(0, 4), room: '999', fee: 5, dailyCap: 20 }, { auth: true });
ok(r.status === 201 && r.data.code, 'create department with auto code', JSON.stringify(r.data));
const nd = r.data;
r = await call('POST', '/departments', { name: nd.name.toLowerCase(), room: '1' }, { auth: true });
ok(r.status === 409, 'duplicate name (case-insensitive) -> 409');
r = await call('PATCH', `/departments/${nd.id}/status`, { status: 'Busy' }, { auth: true });
ok(r.status === 200 && r.data.status === 'Busy', 'change OPD status');
r = await call('PUT', `/departments/${nd.id}`, { name: nd.name + ' B', room: '998', fee: 5, dailyCap: 20 }, { auth: true });
ok(r.status === 200 && r.data.room === '998', 'edit department');
r = await call('DELETE', `/departments/${nd.id}`, undefined, { auth: true });
ok(r.status === 200, 'delete empty department');

section('Notifications + stats');
r = await call('GET', '/notifications?token=' + paidToken);
ok(r.status === 200 && r.data.length > 0, 'notifications for a token');
r = await call('GET', '/admin/stats', undefined, { auth: true });
ok(r.status === 200 && r.data.total > 0 && r.data.collected.total > 0, 'stats show tokens + collected money', JSON.stringify(r.data.collected));

section('Concurrency: quota must never be oversold');
const free2 = byName('Emergency');
const before = (await call('GET', '/departments')).data.find((d) => d.id === free2.id);
const left = before.onlineLeft;
const N = left + 12;
const results = await Promise.all(Array.from({ length: N }, () => call('POST', '/bookings/online', { ...person(), departmentId: free2.id })));
const created = results.filter((x) => x.status === 201);
const full = results.filter((x) => x.status === 409);
const limited = results.filter((x) => x.status === 429);
console.log(`      fired ${N}: ${created.length} booked, ${full.length} full(409), ${limited.length} rate-limited(429), other ${N - created.length - full.length - limited.length}`);
const toks = created.map((x) => x.data.ticket.token);
ok(new Set(toks).size === toks.length, 'all issued token numbers are unique');
const after = (await call('GET', '/departments')).data.find((d) => d.id === free2.id);
ok(after.onlineBooked <= Math.round(after.dailyCap * 0.7), 'online quota never exceeded', `${after.onlineBooked} booked`);
ok(created.length <= left, 'never issued more tokens than slots left', `${created.length} > ${left}`);

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log('FAILED:\n - ' + fails.join('\n - ')); process.exit(1); }
