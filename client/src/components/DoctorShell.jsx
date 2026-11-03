import React from 'react';

// Same menu as the staff panel (NAV_STAFF in public/legacy/script.js) so the doctor can reach every staff screen.
export const NAV = [
  ["emergency", "Emergency"],
  ["staff", "Staff Dashboard"],
  ["doctor", "Doctor Console"],
  ["doctor-lab", "Lab Report"],
  ["admin", "Admin Overview"],
  ["counter", "Counter Booking"],
  ["sparcha", "Print Parcha"],
  ["scan", "Scan QR"],
  ["live", "Live Queue"],
  ["depts", "Departments"],
  ["doctors", "OPD Status"],
  ["analytics", "Analytics"],
  ["labdesk", "Lab Desk"],
  ["alerts", "Notifications"],
  ["feedbacks", "Patient Feedback"],
];

// Sidebar + top bar shared by the doctor screens. `active` is the NAV key to highlight.
export default function DoctorShell({ active, children }) {
  return (
    <div className="app">
      <aside className="side">
        <a className="logo" href="/#/"><i>+</i>SmartCare</a>

        {NAV.map(([r, l]) => {
          let c = r === active ? 'on' : '';
          if (r === 'emergency') c += (c ? ' ' : '') + 'emgred';
          const props = { key: r, href: `/#/${r}` };
          if (c) props.className = c;
          if (r === 'alerts') props.id = 'navbell';
          return <a {...props}>{l}</a>;
        })}
        <div className="sp"></div>
        <a href="/#/">Home</a>
      </aside>

      <main className="main">
        <div className="top">
          <a className="bellbtn" id="bell" href="/#/alerts" aria-label="Notifications">Notifications</a>
          <button id="th" aria-label="Toggle theme">Theme</button>
          <div className="av">D</div>
          <b>Dr. Sharma</b>
        </div>
        {children}
      </main>
    </div>
  );
}
