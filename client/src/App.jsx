import React, { useEffect, useRef, useState } from 'react';
import DoctorDashboard from './components/DoctorDashboard.jsx';
import LabReportView from './components/LabReportView.jsx';

function LegacyApp() {
  const mounted = useRef(false);
  const [failed, setFailed] = useState(null);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;

    const files = [
      '/legacy/qr.js',
      '/legacy/api.js',
      '/legacy/script.js',
      '/legacy/lab.js', // Lab Report + Feedback screens (patient) and Lab Desk (staff)
      '/legacy/chatbot.js?v=5', // ?v= forces browsers to drop the old cached chatbot
    ];

    const load = (src) => new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-smartcare="${src}"]`);
      if (existing) {
        resolve();
        return;
      }
      const el = document.createElement('script');
      el.src = src;
      el.async = false;
      el.dataset.smartcare = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.body.appendChild(el);
    });

    (async () => {
      try {
        for (const file of files) await load(file);
      } catch (err) {
        console.error(err);
        setFailed(err.message);
      }
    })();
  }, []);

  return (
    <>
      <div id="smartcare-mount" aria-live="polite" />
      {failed && (
        <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
          <h2>SmartCare failed to start</h2>
          <p>{failed}</p>
          <p>Check that the SmartCare server is running and the client was built (npm run build).</p>
        </div>
      )}
    </>
  );
}

export default function App() {
  const [hash, setHash] = useState(window.location.hash);
  
  useEffect(() => {
    const handleHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);
  
  const path = window.location.pathname;
  
  // Doctor Console is separate
  const isLabRoute = hash === '#/doctor-lab' || hash === '#/doctor-lab/';
  const isDoctorRoute = isLabRoute || path === '/doctor' || hash === '#/doctor' || hash === '#/doctor/';

  // Ensure normal staff/admin entry routes hit the legacy app's Staff Login
  if (path === '/admin' || path === '/admin-dash' || path === '/staff') {
    window.location.replace('/#/staff');
    return null;
  }
  
  // Ensure reception routes hit the legacy app's scanner
  if (path === '/reception' || path === '/scan') {
    window.location.replace('/#/scan');
    return null;
  }

  // Hide the legacy app instead of unmounting it so the script.js router 
  // doesn't fallback to destroying the React #root div.
  return (
    <>
      {isDoctorRoute && (
        <div style={{ display: 'block' }}>
          {isLabRoute ? <LabReportView /> : <DoctorDashboard />}
        </div>
      )}
      <div style={{ display: isDoctorRoute ? 'none' : 'block' }}>
        <LegacyApp />
      </div>
    </>
  );
}
