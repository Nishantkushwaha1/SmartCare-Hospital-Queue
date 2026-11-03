import React, { useCallback, useEffect, useRef, useState } from 'react';
import DoctorShell from './DoctorShell.jsx';

const API = (window.SMARTCARE_API_URL || '/api').replace(/\/$/, '');
const CODE_RE = /LR-[A-Z0-9]{10}/i; // the QR on a patient's lab report carries this report code
const CAM_ID = 'lab-cam';
const IDLE_MSG = "Press the button and point the camera at the QR code on the patient's lab report.";

const longDay = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const Info = ({ label, value }) => (<div><small>{label}</small><br /><b>{value || value === 0 ? value : '–'}</b></div>);

function ReportSheet({ r }) {
  const abnormal = r.report.results.filter((x) => x.flag !== 'Normal').length;
  return (
    <div className="printable labrep">
      <div className="labrep-h">
        <div><b className="labrep-brand">SMARTCARE HOSPITAL</b><small>Laboratory report</small></div>
        <div style={{ textAlign: 'right' }}><small>Report code</small><b style={{ fontFamily: 'ui-monospace,Menlo,Consolas,monospace' }}>{r.report.code}</b></div>
      </div>
      <div className="labrep-info">
        <Info label="Patient" value={r.patient.name} />
        <Info label="Age" value={r.patient.age} />
        <Info label="Mobile" value={r.patient.phone} />
        <Info label="Test" value={r.testName} />
        <Info label="Sample" value={r.sample} />
        <Info label="Test date" value={longDay(r.day)} />
        <Info label="Booking code" value={r.code} />
        <Info label="Reported on" value={r.report.issuedAt} />
        <Info label="Reported by" value={r.report.issuedBy || 'Lab'} />
      </div>
      <table className="tbl labrep-tbl">
        <thead><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Ref. range</th><th>Flag</th></tr></thead>
        <tbody>
          {r.report.results.map((x) => (
            <tr key={x.key} className={x.flag !== 'Normal' ? 'abn' : ''}>
              <td>{x.name}</td><td><b>{x.value}</b></td><td>{x.unit}</td><td>{x.ref}</td>
              <td><span className={`lflag ${x.flag}`}>{x.flag}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.report.remarks && <p className="labrep-rem"><b>Remarks:</b> {r.report.remarks}</p>}
      <p className="labrep-note">{abnormal ? `${abnormal} value${abnormal > 1 ? 's' : ''} outside the reference range. ` : ''}Reference ranges are for adults.</p>
    </div>
  );
}

export default function LabReportView() {
  const [manual, setManual] = useState('');
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [facing, setFacing] = useState('environment'); // 'environment' = back camera (default), 'user' = front camera
  const [status, setStatus] = useState(IDLE_MSG);
  const [recent, setRecent] = useState([]); // reports opened in this session
  const scanner = useRef(null);
  const hasLogin = Boolean(sessionStorage.getItem('sc_jwt'));

  const stopScan = useCallback(async () => {
    const s = scanner.current;
    scanner.current = null;
    if (s) { try { await s.stop(); } catch (e) { /* already stopped */ } try { s.clear(); } catch (e) { /* ignore */ } }
    setScanning(false);
  }, []);
  useEffect(() => () => { stopScan(); }, [stopScan]);

  const openReport = useCallback(async (raw) => {
    const m = CODE_RE.exec(String(raw || ''));
    setError('');
    if (!m) { setError('This QR code is not a SmartCare lab report. Ask the patient for the QR on their lab report.'); return false; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/admin/lab/reports/${m[0].toUpperCase()}`, { headers: { Authorization: 'Bearer ' + (sessionStorage.getItem('sc_jwt') || '') } });
      const data = await res.json().catch(() => null);
      if (res.status === 401) throw new Error('Please login as Staff / Doctor first, then scan again.');
      if (!res.ok) throw new Error((data && data.error) || `Could not load the report (${res.status})`);
      setReport(data);
      setRecent((l) => [data, ...l.filter((x) => x.report.code !== data.report.code)].slice(0, 8));
      setManual('');
      return true;
    } catch (e) {
      setReport(null);
      setError(e.message || 'Could not load the report.');
      return false;
    } finally { setLoading(false); }
  }, []);

  // Start the camera that faces `mode` ('environment' = back, 'user' = front).
  const beginScan = async (mode) => {
    if (!window.Html5Qrcode) { setStatus('Camera QR library not loaded. Please type the report code below.'); return; }
    setError('');
    setFacing(mode);
    setScanning(true);
    setStatus(`Looking for a QR code (${mode === 'environment' ? 'back' : 'front'} camera)…`);
    const s = new window.Html5Qrcode(CAM_ID);
    scanner.current = s;
    const onDecode = async (text) => {
      await stopScan();
      setStatus('QR scanned. Loading the report…');
      const ok = await openReport(text);
      setStatus(ok ? 'Report loaded. Press the button to scan the next QR.' : IDLE_MSG);
    };
    const cfg = { fps: 10 };
    const noop = () => {};
    try {
      try {
        await s.start({ facingMode: { exact: mode } }, cfg, onDecode, noop); // that exact camera
      } catch (e1) {
        try {
          await s.start({ facingMode: mode }, cfg, onDecode, noop); // preferred; any camera on laptops
        } catch (e2) {
          const cams = await window.Html5Qrcode.getCameras();
          if (!cams || !cams.length) throw new Error('No cameras found');
          const re = mode === 'environment' ? /back|rear|environment/i : /front|user|face/i;
          const hit = cams.find((c) => c.label && re.test(c.label));
          const cam = hit || (mode === 'environment' ? cams[cams.length - 1] : cams[0]);
          await s.start(cam.id, cfg, onDecode, noop);
        }
      }
    } catch (err) {
      scanner.current = null;
      setScanning(false);
      setStatus('Camera error: ' + (err && err.message ? err.message : err) + '. Please type the report code below.');
    }
  };

  const startScan = async () => {
    if (scanner.current) return stopScan().then(() => setStatus('Scanner stopped.'));
    await beginScan(facing);
  };

  const switchCamera = async () => {
    const next = facing === 'environment' ? 'user' : 'environment';
    await stopScan();
    await beginScan(next);
  };

  return (
    <DoctorShell active="doctor-lab">
      <h2 className="t">Lab Report</h2>
      <p className="sub">Scan the QR code on the patient's lab report to see the full report here.</p>

      {!hasLogin && (
        <div className="note b" style={{ marginBottom: 14 }}>
          Staff login is needed to open lab reports. <a href="/#/staff-login">Login as Staff / Doctor</a>
        </div>
      )}

      <div className="labscan">
        <div>
          <div className="card">
            <b>Scan with camera</b>
            <div className="scanbox"><div id={CAM_ID} style={{ width: '100%', display: scanning ? 'block' : 'none' }} /></div>
            <p className="sub" aria-live="polite">{status}</p>
            <button className="btn block" onClick={startScan}>{scanning ? 'Stop scanning' : 'Start scanning'}</button>
            {scanning && (
              <button type="button" className="btn ghost block" style={{ marginTop: 8 }} onClick={switchCamera}>
                {facing === 'environment' ? 'Switch to front camera' : 'Switch to back camera'}
              </button>
            )}
            <form onSubmit={(e) => { e.preventDefault(); openReport(manual); }}>
              <label htmlFor="labcode">Or type the report code</label>
              <input id="labcode" value={manual} onChange={(e) => setManual(e.target.value.toUpperCase())} placeholder="e.g. LR-7KQ3M9XA2B" autoComplete="off" />
              <br />
              <button className="btn ghost block" disabled={loading || !manual.trim()}>{loading ? 'Loading…' : 'Open report'}</button>
            </form>
          </div>

          {recent.length > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <b>Opened in this session</b>
              <ul className="nl" style={{ marginTop: 8 }}>
                {recent.map((x) => (
                  <li key={x.report.code} style={{ cursor: 'pointer' }} onClick={() => { setReport(x); setError(''); }}>
                    <i style={{ background: x.report.results.some((r) => r.flag !== 'Normal') ? '#e5383b' : '#16a34a' }} />
                    <span><small className="kt">{x.testName}</small><br />{x.patient.name} · {x.report.code}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div>
          {error && <div className="note" style={{ background: 'var(--badbg)', color: 'var(--bad)', marginBottom: 14 }}>{error}</div>}
          {report ? (
            <div className="card">
              <div className="noprint" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 10 }}>
                <button className="btn ghost" onClick={() => window.print()}>Print</button>
                <button className="btn ghost" onClick={() => setReport(null)}>Close</button>
              </div>
              <ReportSheet r={report} />
            </div>
          ) : (
            !error && <div className="card"><b>Report</b><p className="sub">The scanned report's patient details and test results will appear here.</p></div>
          )}
        </div>
      </div>
    </DoctorShell>
  );
}
