# SmartCare – OPD Token & Queue Management (MERN)

React (Vite) + Node.js/Express + MongoDB. Online token fee: Razorpay (ya practice/demo payment).
Optional: Groq AI chatbot, TinyFish web search, Fetch.ai Python agents.

## Folder structure (sab code in 3 folders me)

```
SmartCare/
├─ README.md
├─ client/      React + Vite frontend (build hone ke baad server hi isse serve karta hai)
│   ├─ src/                 React shell + Doctor Dashboard
│   └─ public/legacy/       SmartCare screens (api.js, script.js, chatbot.js, qr.js, kb.json)
├─ server/      Express API (http://localhost:5000/api)
│   ├─ src/                 config, routes, services, middleware, utils, db.js
│   ├─ agents/              (optional) Python Fetch.ai agents – Render pe zaroori nahi
│   ├─ tests/e2e.mjs        end-to-end API test
│   └─ .env.example
└─ database/    MongoDB layer: Mongoose models, connection, 15 default departments, seed script
    ├─ models/  Admin, Counter, Department, Notification, Otp, Patient, Payment, Token
    ├─ data/departments.js
    ├─ index.js (connectDB, bootstrap)  and  seed.js
    └─ .env.example
```

`server` hamesha DB ko `database/` folder se import karta hai (`server/src/db.js`). Mongoose ka sirf ek instance hai.
MongoDB server khud kisi folder me nahi hota – woh ek service hai (local `mongod` ya **MongoDB Atlas**). `database/` me uska poora code (models + seed) hai.

---

## Local pe chalana

Zaroori: Node 18.18+ aur ek MongoDB (local `mongod` ya Atlas URI).

```bash
cd server
cp .env.example .env          # phir .env edit karo (MONGODB_URI, JWT_SECRET, ADMIN_PASSWORD ...)
npm run setup                 # server + database + client ke saare packages install
npm run dev:all               # API http://localhost:5000  +  website http://localhost:5173
```

Local me sirf practice payment chahiye to `.env` me `PAYMENT_MODE=demo` rakho (Razorpay account nahi chahiye).

Pehli baar start par server khud 15 departments aur ek staff account (`ADMIN_USERNAME` / `ADMIN_PASSWORD`) bana deta hai.
Haath se seed: `cd database && npm install && npm run seed` (password reset: `npm run seed:reset-admin`).

Production jaisa chalana (ek hi port par): `cd server && npm run build && npm start` → http://localhost:5000

Test: server chalte hue `cd server && ADMIN_PASSWORD=<tumhara admin password> npm run test:e2e` (server `PAYMENT_MODE=demo` me ho).

---

## Render pe deploy (step by step)

### 1. MongoDB Atlas (free)
1. https://cloud.mongodb.com → free cluster → **Database Access** me user banao.
2. **Network Access → Add IP Address → Allow access from anywhere (0.0.0.0/0)** (Render ka IP badalta rehta hai).
3. **Connect → Drivers** se URI copy karo, aur end me database naam jodo:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/smartcare`

### 2. Code GitHub pe daalo
Pure `SmartCare/` folder ko repo me push karo (`client/`, `server/`, `database/`, `README.md` repo ke root me). **`.env` kabhi push mat karo** (`.gitignore` already hai).

### 3. Render: New → Web Service → apna repo chuno

| Setting | Value |
|---|---|
| Runtime | Node |
| Root Directory | *(khali chhodo)* |
| Build Command | `cd server && npm install && npm run build` |
| Start Command | `cd server && npm start` |
| Health Check Path | `/api/health` |

`npm run build` client ko build karta hai; Express wahi build serve karta hai, isliye **frontend + API ek hi URL** par hote hain (CORS ki zaroorat nahi, `window.SMARTCARE_API_URL` set karna nahi padta).

### 4. Environment variables (Render → Environment)

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Atlas URI (upar se) |
| `JWT_SECRET` | koi bhi 32+ random characters |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | 8+ characters (staff login ka password) |
| `ADMIN_NAME` | `Hospital Admin` |
| `SHOW_DEV_OTP` | `true`  ← SMS service jodi nahi hai, to OTP screen par dikhta hai (demo ke liye) |
| `PAYMENT_MODE` + `ALLOW_DEMO_PAYMENTS` | `demo` aur `true`  ← practice payment (koi asli paisa nahi). **Ya** neeche Razorpay keys do |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay dashboard se (`rzp_test_...` se test karo) |
| `RAZORPAY_WEBHOOK_SECRET` | webhook banate waqt jo secret daala (URL: `https://<tumhara-app>.onrender.com/api/payments/webhook`, events: `payment.captured`, `order.paid`, `payment.failed`) |
| `GROQ_API_KEY` *(optional)* | https://console.groq.com/keys – chatbot ke AI jawab |
| `TINYFISH_API_KEY` *(optional)* | web search fallback |

`PORT` aur `TRUST_PROXY` Render khud set ho jaate hain. Baaki sab optional hai (`server/.env.example` dekho).

### 5. Deploy ke baad
- `https://<app>.onrender.com/api/health` → `{"ok":true,"database":true,...}` aana chahiye.
- Website: `/`  •  Staff login: `/#/staff-login`  •  Doctor Console: `/doctor`
- Free plan par service 15 min idle rehne par so jaati hai; pehli request 30-60 sec le sakti hai.

### Zaroori baatein
- **Asli hospital use** ke liye: `SHOW_DEV_OTP` hata kar `server/src/services/otp.js` (`deliver()`) me SMS provider (MSG91/Twilio/Fast2SMS) jodo, aur demo payment band karke Razorpay live keys lagao.
- Agar `.env` / keys kabhi kisi zip ya repo me share ho gayi ho, to Razorpay, Groq, TinyFish aur MongoDB ki keys **rotate (naya banao)** kar do.
- Python agents (`server/agents`) optional hain aur Render ke Node service me nahi chalte. Unhe alag Render "Background/Web Service" (Python) ke roop me chalana ho to `cd server/agents && pip install -r requirements.txt && python run_all.py`, phir main service me `AGENT_URL=<agents ka URL>` do.

---

## Razorpay (test mode)
Test UPI `success@razorpay`, test card `4111 1111 1111 1111` (koi bhi future expiry/CVV, OTP `1234`). Slot payment ke dauran reserve rehta hai (`RESERVATION_MINUTES`, default 10). Verify aur webhook dono idempotent hain – ek payment par ek hi token banta hai.

## Kaise kaam karta hai
- **70/30 quota**: har department ke daily tokens me 70% online, 30% counter. MongoDB me atomic counters se enforce hota hai (do log aakhri token nahi le sakte). Token numbers (`GM-001`…) department + din ke hisaab se, raat 12 baje (IST) reset.
- Patient ka naam/age/phone kisi public endpoint se wapas nahi aata.
- MongoDB transactions use nahi hote, to simple `mongod` / Atlas free tier dono chalte hain.
- UI queue har 10 sec me refresh hoti hai.

## API (short)
Public: `GET /api/health`, `/api/departments`, `/api/queue`, `/api/queue/token/:token`, `/api/notifications`, `POST /api/bookings/online`, `/api/payments/{verify,cancel,webhook}`, `/api/patient-auth/*`, `/api/chat/{ask,search}`, `/api/agent/chat`
Staff (`Authorization: Bearer <jwt>`): `POST /api/auth/login`, `/api/admin/*` (counter booking, refunds, stats, check-in, emergency), `POST|PUT|DELETE /api/departments`, `PATCH /api/departments/:id/status`
