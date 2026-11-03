import React, { useState, useEffect } from 'react';

import DoctorShell from './DoctorShell.jsx';

// Same API base as the legacy screens (api.js): same-origin /api by default, or window.SMARTCARE_API_URL.
const API = (window.SMARTCARE_API_URL || '/api').replace(/\/$/, '');

const isWaiting = (t) => t.status === 'Waiting' || t.status === 'Emergency';

export default function DoctorDashboard() {
  const [allTokens, setAllTokens] = useState([]);
  const [activeDoctor, setActiveDoctor] = useState({ id: 'doc-sharma', name: 'Dr. Arvind Sharma', room: '101', department_id: 'General Medicine', status: 'Available' });
  const [stats, setStats] = useState({ waiting: 0, current: 0, completed: 0 });
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [departments, setDepartments] = useState([]);

  useEffect(() => {
    const fetchDepts = async () => { try { const r = await fetch(API + '/departments'); if(r.ok) setDepartments(await r.json()); } catch(e) {} };
    fetchDepts();

    const fetchQueue = async () => {
      try {
        const res = await fetch(API + '/queue');
        if (res.ok) {
          const data = await res.json();
          const deptTokens = data.filter(t => t.department === activeDoctor.department_id);
          setAllTokens(deptTokens);
          setStats({
            waiting: deptTokens.filter(isWaiting).length,
            current: deptTokens.filter(t => t.status === 'Consultation').length,
            completed: deptTokens.filter(t => t.status === 'Completed').length,
          });
        }
      } catch(e) {}
    };
    fetchQueue();
    const iv = setInterval(fetchQueue, 3000);
    return () => clearInterval(iv);
  }, [activeDoctor.department_id, refreshTrigger]);

  // Emergency-priority patients are part of the waiting list and always come first.
  const waitingTokens = allTokens
    .filter(isWaiting)
    .sort((a, b) => (a.status === 'Emergency' ? 0 : 1) - (b.status === 'Emergency' ? 0 : 1));
  const activeDept = departments.find(d => d.name === activeDoctor.department_id);
  const room = activeDept ? activeDept.room : activeDoctor.room;
  const currentToken = allTokens.find(t => t.status === 'Consultation');
  
  const announceCall = (tokenNum, room) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(`Token ${tokenNum.split('').join(' ')}, please proceed to Room ${room}`);
      utter.rate = 0.95;
      window.speechSynthesis.speak(utter);
    }
  };

  const onCallNext = async () => {
    if (waitingTokens.length > 0) {
      try {
        const nextToken = waitingTokens[0].token;
        const res = await fetch(API + '/admin/queue/checkin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (sessionStorage.getItem('sc_jwt')||'') },
          body: JSON.stringify({ token: nextToken })
        });
        if (!res.ok) { alert("Failed. Please login as Staff first."); return; }
        announceCall(nextToken, room);
      } catch(e) {}
      setRefreshTrigger(r => r + 1);
    }
  };

  const onCompleteConsultation = async () => {
    if (currentToken) {
      try {
        const res = await fetch(API + '/admin/queue/' + currentToken.token + '/status', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (sessionStorage.getItem('sc_jwt')||'') },
          body: JSON.stringify({ status: 'Completed' })
        });
        if (!res.ok) { alert("Failed. Please login as Staff first."); return; }
        setRefreshTrigger(r => r + 1);
      } catch(e) {}
    }
  };

  const onNoShow = async () => {
    if (currentToken) {
      try {
        const res = await fetch(API + '/admin/queue/' + currentToken.token + '/status', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (sessionStorage.getItem('sc_jwt')||'') },
          body: JSON.stringify({ status: 'Cancelled' })
        });
        if (!res.ok) { alert("Failed. Please login as Staff first."); return; }
        setRefreshTrigger(r => r + 1);
      } catch(e) {}
    }
  };

  const onCallSpecific = async (tokenStr) => {
    try {
      const res = await fetch(API + '/admin/queue/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (sessionStorage.getItem('sc_jwt')||'') },
        body: JSON.stringify({ token: tokenStr })
      });
      if (!res.ok) { alert("Failed. Please login as Staff first."); return; }
      announceCall(tokenStr, room);
    } catch(e) {}
    setRefreshTrigger(r => r + 1);
  };

  const onCompleteSpecific = async (tokenStr) => {
    try {
      const res = await fetch(API + '/admin/queue/' + tokenStr + '/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (sessionStorage.getItem('sc_jwt')||'') },
        body: JSON.stringify({ status: 'Completed' })
      });
      if (!res.ok) { alert("Failed. Please login as Staff first."); return; }
      setRefreshTrigger(r => r + 1);
    } catch(e) {}
  };

  const onNoShowSpecific = async (tokenStr) => {
    try {
      const res = await fetch(API + '/admin/queue/' + tokenStr + '/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (sessionStorage.getItem('sc_jwt')||'') },
        body: JSON.stringify({ status: 'Cancelled' })
      });
      if (!res.ok) { alert("Failed. Please login as Staff first."); return; }
      setRefreshTrigger(r => r + 1);
    } catch(e) {}
  };
return (
    <DoctorShell active="doctor">
        <h2 className="t">Doctor Dashboard</h2>
        <p className="sub">Manage current patient consultations and your queue in Room {room}</p>

        <div className="stats" style={{ marginBottom: '20px' }}>
          <div className="card stat"><span>Waiting</span><b style={{ color: 'var(--warn)' }}>{stats.waiting}</b></div>
          <div className="card stat"><span>In Consultation</span><b style={{ color: 'var(--pri)' }}>{stats.current}</b></div>
          <div className="card stat"><span>Completed</span><b style={{ color: 'var(--ok)' }}>{stats.completed}</b></div>

          <div className="card stat" style={{ minWidth: '180px' }}>
            <span>Department</span>
            <select 
               className="ss" 
               value={activeDoctor.department_id}
               onChange={(e) => setActiveDoctor({...activeDoctor, department_id: e.target.value})}
               style={{ width: '100%', marginTop: '8px', padding: '6px', borderRadius: '4px' }}
            >
              {departments.length === 0 && <option value={activeDoctor.department_id}>{activeDoctor.department_id}</option>}
              {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          </div>

          <div className="card stat">
            <span>My Status</span>
            <select 
               className="ss" 
               value={activeDoctor.status}
               onChange={(e) => setActiveDoctor({...activeDoctor, status: e.target.value})}
               style={{ marginTop: '8px', padding: '4px', borderRadius: '4px', width: '100%' }}
            >
              <option>Available</option>
              <option>Busy</option>
              <option>Break</option>
            </select>
          </div>
        </div>

        <div className="card" style={{ marginBottom: '20px', padding: '30px', textAlign: 'center', border: '2px solid var(--pri)' }}>
          <h3 style={{ fontSize: '18px', marginBottom: '10px' }}>Current Patient</h3>
          {currentToken ? (
            <div>
              <div className="av" style={{ width: '80px', height: '80px', fontSize: '32px', margin: '0 auto 16px' }}>{currentToken.token.substring(0,2)}</div>
              <div className="big" style={{ fontSize: '48px', color: 'var(--pri)', fontWeight: 'bold' }}>{currentToken.token}</div>
              <p style={{ marginTop: '10px', color: 'var(--mute)' }}>Source: {currentToken.source}</p>
              
              <div className="grid2" style={{ marginTop: '24px' }}>
                <button className="btn block" onClick={onCompleteConsultation} style={{ background: 'var(--ok)', borderColor: 'var(--ok)' }}>&#10004; Complete Consultation</button>
                <button className="btn ghost block" onClick={onNoShow} style={{ color: 'var(--bad)', borderColor: 'var(--bad)' }}>&#10008; No Show / Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ padding: '20px 0' }}>
              <div className="av" style={{ width: '60px', height: '60px', fontSize: '24px', margin: '0 auto 16px', background: 'var(--soft)' }}>-</div>
              <div style={{ fontSize: '24px', color: 'var(--mute)' }}>No Patient in Room</div>
              <p style={{ marginTop: '10px', color: 'var(--mute)' }}>Click Call Next to bring the next waiting patient into the room.</p>
              
              <button className="btn block" onClick={onCallNext} disabled={waitingTokens.length === 0} style={{ marginTop: '20px', padding: '12px 30px', fontSize: '16px' }}>
                Call Next Patient ({stats.waiting} Waiting)
              </button>
            </div>
          )}
        </div>

        <div className="card wrap">
          <b>Waiting Queue ({stats.waiting})</b>
          <table className="tbl" style={{ marginTop: '12px' }}>
            <thead>
              <tr>
                <th>Token no.</th>
                <th>Status</th>
                <th>Time</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {waitingTokens.map(q => (
                <tr key={q.token}>
                  <td><b>{q.token}</b></td>
                  <td><span className={`pill ${q.status === 'Emergency' ? 'emergency' : 'waiting'}`}>{q.status}</span></td>
                  <td>{q.time}</td>
                  <td>
                    <button className="btn" onClick={() => onCallSpecific(q.token)} style={{ padding: '4px 8px', fontSize: '12px', marginRight: '6px' }}>Call Next</button>
                    <button className="btn" onClick={() => onCompleteSpecific(q.token)} style={{ padding: '4px 8px', fontSize: '12px', background: 'var(--ok)', borderColor: 'var(--ok)', marginRight: '6px' }}>Complete</button>
                    <button className="btn ghost" onClick={() => onNoShowSpecific(q.token)} style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--bad)', borderColor: 'var(--bad)' }}>No Show</button>
                  </td>
                </tr>
              ))}
              {waitingTokens.length === 0 && (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', padding: '20px', color: 'var(--mute)' }}>No patients currently waiting in your queue.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

    </DoctorShell>
  );
}
