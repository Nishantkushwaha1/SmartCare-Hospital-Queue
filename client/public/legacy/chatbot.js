// SmartCare Assistant: floating chatbot (English + Hinglish).
// It is an on-device, rule-based assistant that reads the live app state (queue, departments, rooms).
// It never reveals other patients' personal details. When its rules cannot answer (or the user types
// "search <question>"), it asks the server for TinyFish web-search results; the TinyFish API key stays on
// the server and only the typed question is sent. If TinyFish is not configured, the bot works as before.
const BOT={open:false,flow:null,msgs:[]};
const nrm=s=>s.toLowerCase().replace(/[^a-z0-9\s\-]/g," ").replace(/\s+/g," ").trim();

// symptom / alias -> department (checked after exact department names)
const SYM=[
 [/accident|ambulance|unconscious|bleeding|casualty|critical|emergency/,"Emergency"],
 [/chest|heart|cardio|blood pressure|\bbp\b|palpitation|seene/,"Cardiology"],
 [/neuro|migraine|headache|head ache|sir dard|seizure|fits|stroke|paralysis|nerve|dizz|chakkar/,"Neurology"],
 [/ortho|bone|fracture|joint|knee|ghutna|haddi|shoulder|sprain/,"Orthopedics"],
 [/pediatric|paediatric|child|kid|baby|infant|bachcha|baccha|bachche|newborn/,"Pediatrics"],
 [/derma|skin|rash|itch|khujli|pimple|acne|allerg|chamdi|hair fall/,"Dermatology"],
 [/\bent\b|ear|kaan|nose|naak|throat|gala|sinus|tonsil/,"ENT"],
 [/gyn|pregnan|garbh|period|maternity|antenatal|women/,"Gynecology"],
 [/ophthal|eye|aankh|vision|cataract|glasses|chashma/,"Ophthalmology"],
 [/dental|dentist|tooth|teeth|daant|gum|cavity/,"Dental"],
 [/radiolog|x-?ray|\bmri\b|\bct\b|scan|ultrasound|sonograph/,"Radiology"],
 [/patholog|blood test|urine|\blab\b|sample|sugar test/,"Pathology"],
 [/surg|operation|hernia|appendix|gallbladder|piles/,"Surgery"],
 [/physio|rehab|exercise|back pain|kamar|spine|neck pain|therapy/,"Physiotherapy"],
 [/fever|bukhar|cold|cough|khansi|sardi|stomach|pet dard|body ache|weakness|vomit|diarrh|general|physician|medicine/,"General Medicine"]];
// whole-word match, so the department "ENT" is not found inside the word "department"
function nameIn(t,n){return new RegExp("\\b"+n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b").test(t)}
function deptFrom(t){
 for(const d of DEPTS){if(nameIn(t,d.n))return KB.lastDept=d}
 for(const [re,n] of SYM){if(re.test(t)){const d=dep(n);if(d.n)return KB.lastDept=d}}
 // follow-ups like "and its fee?" / "uska room?" reuse the department we just talked about
 if(KB.lastDept&&/\b(it|its|that|there|same|uska|uski|uske|wahan|wahi)\b/.test(t))return KB.lastDept;
 return null}


// ---------- "Out of syllabus" questions ----------
// The local rules above are greedy (words like "where", "time", "data", "book" would hijack any question), so a
// message that is clearly NOT about SmartCare / health goes straight to the AI instead of the rules.
const STRONG_RE=/\b(smartcare|smart care|hospital|opd|tokens?|parcha|queue|appointments?|apointment|registration|register|booking|department|departments|dept|vibhag|doctors?|specialist|fees?|refund|refunds|payment|razorpay|qr|otp|helpline|ambulance|pharmacy|counter|notifications?|my turn|patients ahead|mera number|kab aayega)\b|\b[a-z]{2,3}-?\d{3}\b|^book\b|\b(which|my|konsa|kaun\s?sa)\s+room\b|\broom\s+(no|number)\b/;
const SYMPTOM_RE=/\b(chest pain|heart|cardio|blood pressure|bp|palpitations?|migraine|headache|head ache|sir dard|seizures?|fits|stroke|paralysis|dizzy|dizziness|chakkar|fracture|joint pain|knee pain|ghutna|haddi|sprain|rash|itching|itch|khujli|pimples?|acne|skin|hair fall|allergy|allergic|bukhar|fever|cough|khansi|sardi|cold|vomit|vomiting|diarrh\w*|stomach ache|pet dard|body ache|sore throat|ear ?ache|toothache|tooth pain|daant|pregnan\w*|garbh|period pain|eye pain|aankh|cataract|back pain|kamar dard|neck pain|bleeding|unconscious|breathless\w*|saans|infection|swelling|injury|accident|symptoms?|medicine|dawai|tablet)\b/;
const deptRes=()=>(typeof DEPTS!=="undefined"?DEPTS:[]).map(d=>new RegExp("\\b"+d.n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b"));
const WEAK_RE=/\b(room|rooms|wait|waiting|status|pay|online|offline|timing|timings|time|alert|alerts|book|slot|turn|number)\b/;
const SMALLTALK_RE=/^(hi|hii+|hello|hey|namaste|namaskar|good (morning|afternoon|evening|night)|thanks|thank you|shukriya|dhanyavad|ok|okay|ok thanks|bye|goodbye|ok bye|alvida|help)\b/;
function isGeneral(raw){
 const t=nrm(raw);const n=t.split(" ").filter(Boolean).length;
 if(n<3)return false;                                   // "hi", "thanks", "departments" ... stay local
 if(SMALLTALK_RE.test(t)&&n<=4)return false;
 if(STRONG_RE.test(t)||SYMPTOM_RE.test(t)||deptRes().some(r=>r.test(t)))return false;
 const k=kbFind(t);if(k&&k.s>=5)return false;           // the knowledge base knows this one
 if(WEAK_RE.test(t)&&n<=5)return false;                 // short and mentions room/wait/pay...: let the rules try first
 return true}
// Everything the rules cannot answer goes to an AI that can: Groq (server) -> Fetch.ai agent -> TinyFish web search.
// Each provider is tried at most ONCE per question (no ping-pong loops): Groq -> agent -> web search -> fallback text.
async function botNext(q,fallback,tried){
 tried=tried||[];
 if(!tried.includes("groq")&&await groqEnabled())return botGroq(q,fallback,tried);
 if(!tried.includes("agent")&&await agentEnabled())return botAgent(q,fallback,tried);
 if(!tried.includes("web")){tried.push("web");return botWeb(q,fallback)}
 BOT.msgs.push({h:fallback?fallback[0]:"The AI is not available right now.",chips:fallback&&fallback[1]});botRender()}
function botAI(q,fallback){return botNext(q,fallback,[])}

// ---------- Knowledge base: answers "how does this app work" questions (English + Hinglish, typo tolerant) ----------
// Source of truth is /legacy/kb.json (also read by the Python agents). Matching: keyword phrases + similarity to
// example questions, with stemming and 1-2 letter typo tolerance. Falls through to the old rules / agent / web search.
const KB={list:[],last:null,lastDept:null};
fetch("/legacy/kb.json").then(r=>r.ok?r.json():[]).then(j=>{KB.list=Array.isArray(j)?j:[]}).catch(()=>{});
const KSTOP=new Set("a an the is are am was i me my to of for in on at it do does did can could will would should shall please pls plz like so just tell about and or be been this that there".split(" "));
const kstem=w=>w.length>4?w.replace(/(ing|ed|es|ly|s)$/,""):w;
const ktoks=s=>nrm(s).split(" ").filter(w=>w&&!KSTOP.has(w)).map(kstem);
function klev(a,b){if(a===b)return 0;if(Math.abs(a.length-b.length)>2)return 9;const d=[];for(let i=0;i<=a.length;i++)d[i]=[i];for(let j=1;j<=b.length;j++)d[0][j]=j;
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[a.length][b.length]}
const keq=(a,b)=>a===b||(Math.min(a.length,b.length)>=5&&klev(a,b)<=1)||(Math.min(a.length,b.length)>=9&&klev(a,b)<=2);
function kscore(e,q){
 let best=0,n=0;
 for(const p of e.kw){const pt=ktoks(p);if(!pt.length)continue;
  if(pt.every(w=>q.some(x=>keq(x,w)))){const v=pt.length>1?4+2*pt.length:3;if(v>best)best=v;n++}}
 let ex=0;
 for(const x of e.ex||[]){const et=ktoks(x);const m=et.filter(w=>q.some(y=>keq(y,w))).length;
  if(m>=2){const v=6*m/Math.max(et.length,q.length);if(v>ex)ex=v}}
 return best+Math.min(2,(n-1)*0.5>0?(n-1)*0.5:0)+ex}
function kbFind(raw){
 if(!KB.list.length)return null;const q=ktoks(raw);if(!q.length)return null;
 let top=null;for(const e of KB.list){const v=kscore(e,q);if(!top||v>top.s)top={e,s:v}}
 return top&&top.s>0?top:null}
function kbHtml(e){
 let h=esc(e.a).replace(/\[\[(#\/[a-z\-]+)\|([^\]]+)\]\]/g,(m,hr,l)=>link(hr,l)).replace(/\n/g,"<br>");
 if(e.me&&S.me){const m=mine();h+="<br><br><b>For you:</b> "+esc(e.me.replace("{t}",m.t).replace("{d}",m.d).replace("{room}",dep(m.d).room||"–").replace("{ahead}",ahead()).replace("{est}",est()))}
 return h}
function kbAns(e){KB.last=e;return[kbHtml(e),e.chips||undefined]}
function kbFollow(t){
 if(!KB.last||!KB.last.next)return null;
 if(!/^(then|and then|next|what next|whats next|then what|aur|phir|phir kya|uske baad|uske baad kya|and after that|after that|ok then|ok and then|aage|what after that)$/.test(t))return null;
 const e=KB.list.find(x=>x.id===KB.last.next);return e?kbAns(e):null}

const link=(h,l)=>`<a class="blink" href="${h}">${l}</a>`;
const stat=d=>d.st==="Available"?"available now":d.st==="Busy"?"currently busy":"not available right now";
function deptInfo(d){return `<b>${esc(d.n)}</b> (OPD ${stat(d)})<br>Room number: <b>${esc(d.room)}</b><br>Timing: ${esc(d.tm)}<br>Now serving: ${curTok(d.n)} &middot; Waiting: ${waiting(d.n)}<br>Registration fee: ${d.fee?"₹"+d.fee:"Free"}<br>Tokens left: ${left(d,"online")} online, ${left(d,"offline")} at counter`}
function status(){if(!S.me)return `You have not booked a token yet.<br>${link("#/register","Book a token")}`;const m=mine(),a=ahead();
 return `Your token: <b>${m.t}</b><br>Department: ${esc(m.d)}<br>Room number: <b>${esc(dep(m.d).room||"–")}</b><br>Now serving: ${curTok(m.d)}<br>Patients ahead: ${a}<br>Estimated time: ${est()}<br>${link("#/queue","Open My Queue")}`}

const CHIPS=["Book appointment","My token status","Departments","Which department?","OPD timings","Which room?","Ask AI agent"];
function reply(raw){
 const t=nrm(raw);
 // ---- booking flow ----
 if(BOT.flow){
  if(/^(cancel|stop|exit|quit|back|nahi|no)$/.test(t)){BOT.flow=null;return["Okay, booking cancelled. How else can I help?",CHIPS]}
  const f=BOT.flow;
  if(f.step==="dept"){const d=deptFrom(t);if(!d)return["I could not find that department. Please pick one from the list or tell me the problem (for example \"chest pain\").",dn()];
   BOT.flow=null;
   if(left(d,"online")){S.pre=d.n;return[`Online tokens are booked on the booking page. <b>${esc(d.n)}</b>: fee <b>${d.fee?"₹"+d.fee:"Free"}</b>, Room ${esc(d.room)}. ${d.fee?"You can pay by UPI, card or net banking there.":"No payment is needed."}<br>${link("#/register",d.fee?"Pay &amp; book token":"Book token")}`,["Departments"]]}
   return[`Online tokens for <b>${esc(d.n)}</b> are full. Please take a counter (offline) token at the hospital: ${esc(d.n)}, Room ${esc(d.room)}.`,["Departments"]]}}
 // ---- smalltalk ----
 if(/^(hi|hii+|hello|hey|namaste|namaskar|good (morning|afternoon|evening))\b/.test(t))return["Hello! I'm the SmartCare Assistant. I can book an online appointment, check your token and queue, and tell you the department and room number for your problem.",CHIPS];
 if(/\b(thanks|thank you|shukriya|dhanyavad|ok thanks)\b/.test(t))return["You're welcome. Get well soon!"];
 if(/^(bye|goodbye|ok bye|alvida)\b/.test(t))return["Take care. Goodbye!"];
 // ---- another token (shows only status + room, never personal data) ----
 const tk=t.match(/\b([a-z]{2,3})-?(\d{3})\b/);
 if(tk){const id=(tk[1]+"-"+tk[2]).toUpperCase(),q=S.queue.find(x=>x.t===id);
  if(id===mine().t)return[status()];
  return q?[`Token <b>${id}</b><br>Status: ${pill(q.s)}<br>Room number: ${esc(dep(q.d).room||"–")}<br>Department: ${esc(q.d)}`]:[`I could not find token ${id}. Please check the number.`]}

 // ---- how-to / what-next questions (knowledge base) ----
 const fu=kbFollow(t);if(fu)return fu;
 const kb=kbFind(t);if(kb&&kb.s>=7)return kbAns(kb.e);
 // ---- payment / fees / offline ----
 if(/\b(pay|payment|fee|fees|charge|charges|cost|price|upi|cash|paisa|paise|rupee|rupees|offline|counter)\b/.test(t)){
  const d=deptFrom(t);
  if(d)return[`Registration fee for <b>${esc(d.n)}</b>: <b>${d.fee?"₹"+d.fee:"Free"}</b>. Online tokens are paid by UPI, card or net banking while booking. Counter tokens are paid at the counter.<br>${link("#/register","Open Token Booking")}`];
  return[`<b>Online tokens (70%):</b> pay the registration fee by UPI, card or net banking while booking.<br><b>Counter / offline parcha (30%):</b> booked by the hospital admin at the counter. Tell your department and pay in cash, UPI or card.<br>Fees: ${DEPTS.map(x=>`${esc(x.n)} ${x.fee?"₹"+x.fee:"Free"}`).join(", ")}.`,["Book appointment"]]}
 // ---- my token / queue status ----
 if(/(my|mera|meri|mere).*(token|appointment|turn|number|queue)|queue|ahead|position|kitne log|kab.*(number|turn|aayega)|my turn|waiting time|how long|\beta\b|estimated|status|wait/.test(t))return[status()];
 // ---- book ----
 if(/book|appointment|apointment|register|registration|new token|get token|token (le|lena|chahiye|nikal)|token/.test(t)){
  BOT.flow={step:"dept"};
  return["Sure, let's book your online appointment. Which department do you need? You can also describe the problem (for example \"skin rash\") and I will pick the department.",dn()]}
 // ---- doctor / which department ----
 if(/doctor|\bdr\b|specialist|physician|which department|konsa|kaun.*(vibhag|department)/.test(t)){
  const d=deptFrom(t);if(d)return[`For this, please consult <b>${esc(d.n)}</b> in <b>Room ${esc(d.room)}</b>.<br>${deptInfo(d)}`];
  return["Tell me the problem (for example \"chest pain\" or \"skin rash\") and I will tell you the department and the room number to consult.",["chest pain","skin rash","tooth pain","fever"]]}
 // ---- room ----
 if(/room|cabin|kahan|kaha|where|location|floor/.test(t)){
  const d=deptFrom(t);if(d)return[`${esc(d.n)} is in <b>Room ${esc(d.room)}</b>.`];
  const m=mine();return[`Your department (${esc(m.d)}) is in <b>${roomOf(m.d)}</b>. Ask me about any other department, for example "Cardiology room".`]}
 // ---- departments ----
 const d=deptFrom(t);
 if(d){const named=DEPTS.some(x=>nameIn(t,x.n));return[(named?"":`For this problem, please consult <b>${esc(d.n)}</b> in <b>Room ${esc(d.room)}</b>.<br>`)+deptInfo(d),["Book "+d.n]]}
 if(/department|dept|specialit|opd|vibhag/.test(t)&&!/timing|hours|time/.test(t))return[`We have ${DEPTS.length} departments:<br>${DEPTS.map(x=>`${esc(x.n)} (Room ${esc(x.room)})`).join("<br>")}<br>Ask me about any one of them.`,dn().slice(0,6)];
 // ---- info ----
 if(/notif|alert|sms|message|update/.test(t)){const u=S.notes.slice(0,3).map(n=>`&bull; ${esc(n.m)}`).join("<br>");return[`You get notifications for appointment confirmation, token updates, queue status, OPD availability and room changes.<br>${u}<br>${link("#/alerts","Open Notifications")}`]}
 if(/\bqr\b|scan|barcode/.test(t))return[`Use <b>Generate QR</b> to create the QR code for your token, and <b>Scan QR</b> at the room to check in.<br>${link("#/genqr","Generate QR")} ${link("#/scan","Scan QR")}`];
 if(/timing|hours|open|close|khulta|time/.test(t))return["OPD: Mon to Sat, 8:00 AM to 4:00 PM. Token counter opens at 7:30 AM; online registration from 6:00 AM. Emergency: 24 hours."];
 if(/ambulance|108|helpline|contact|phone|call|address/.test(t))return["Helpline: 1800-000-0000. Emergency / ambulance: 108. Email: help@smartcare.example."];
 if(/privacy|personal|data|secure/.test(t))return["Your privacy is protected. Queue screens show only the token, room number and department. Name, phone, address and email are never shown."];
 if(/pharmacy|medicine free|dawai/.test(t))return["Essential medicines are free at the hospital pharmacy on showing the parcha."];
 if(/help|what can you|kya kar/.test(t))return["I can: book an online appointment, show your token and queue status, tell you the department and room number for your problem, and explain notifications and QR. Type \"ai\" followed by a question to ask the AI, or \"search\" to look something up on the web.",CHIPS];
 {const lo=kbFind(t);if(lo&&lo.s>=3.5)return kbAns(lo.e)}
 return Object.assign(["Sorry, I did not understand that. I can help with appointments, tokens, queue status, departments and room numbers.",CHIPS],{web:true})}

// ---------- UI ----------
function botRender(){
 const box=$("#botmsgs");if(!box)return;
 box.innerHTML=BOT.msgs.map(m=>`<div class="bm ${m.me?"me":"bot"}">${m.me?esc(m.h):m.h}</div>${m.chips?`<div class="bchips">${m.chips.map(c=>`<button data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div>`:""}`).join("");
 box.scrollTop=box.scrollHeight;
 box.querySelectorAll("[data-c]").forEach(b=>b.onclick=()=>botSend(b.dataset.c));
 box.querySelectorAll("a.blink").forEach(a=>a.addEventListener("click",()=>{if(matchMedia("(max-width:820px)").matches)botToggle(false)}))}
// ---------- Fetch.ai AI agents (via our server -> uAgents Concierge) ----------
// Multi-agent system (Concierge + Triage + Queue + Booking). "agent <text>" starts agent mode, "exit" leaves it.
// Unanswered questions also go to the agent first (when the server has AGENT_URL set), then to web search.
const AG={ok:null,on:false,sid:(()=>{try{let v=sessionStorage.getItem("sc_agent_sid");if(!v){v="web-"+Math.random().toString(36).slice(2,12)+Date.now().toString(36);sessionStorage.setItem("sc_agent_sid",v)}return v}catch(e){return "web-"+Math.random().toString(36).slice(2,14)}})()};
async function agentEnabled(){if(AG.ok!==null)return AG.ok;
 try{const r=await fetch(apiBase()+"/health");AG.ok=!!(await r.json()).agent}catch(e){return false}
 return AG.ok}
async function agentAsk(message){
 const res=await fetch(apiBase()+"/agent/chat",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({message,sessionId:AG.sid})});
 let d=null;try{d=await res.json()}catch(e){}
 if(!res.ok)throw new Error((d&&d.error)||"The AI agent is not available.");
 return d.reply}
const agentHtml=t=>`<b>SmartCare AI Agent</b><br>`+esc(t).replace(/\n/g,"<br>")
async function botAgent(q,fallback,tried){
 tried=tried||[];tried.push("agent");
 const m={h:"Asking the AI agents&hellip;"};BOT.msgs.push(m);botRender();
 try{m.h=agentHtml(await agentAsk(q));m.chips=AG.on?["exit agent"]:undefined}
 catch(e){AG.on=false;if(fallback){BOT.msgs.pop();return botNext(q,fallback,tried)}m.h=esc(e.message||"The AI agent is not available.")}
 botRender()}
// ---------- Groq AI (via our server, GroqCloud LLM grounded on kb.json) ----------
const GQ={ok:null};
async function groqEnabled(){if(GQ.ok!==null)return GQ.ok;
 try{const r=await fetch((window.SMARTCARE_API_URL||"/api").replace(/\/$/,"")+"/health");GQ.ok=!!(await r.json()).groq}catch(e){return false}
 return GQ.ok}
const AIH=[];  // last few question/answer pairs, so follow-ups like "and in simple words?" work
async function groqAsk(q){
 const res=await fetch((window.SMARTCARE_API_URL||"/api").replace(/\/$/,"")+"/chat/ask",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({q,history:AIH.slice(-6)})});
 let d=null;try{d=await res.json()}catch(e){}
 if(!res.ok)throw new Error((d&&d.error)||"The AI assistant is not available.");
 return d.reply}
const groqHtml=t=>`<b>SmartCare AI</b> <small>(Groq)</small><br>`+esc(t).replace(/\n/g,"<br>")+`<br><small>General information only, not medical advice. In an emergency call 108.</small>`;
async function botGroq(q,fallback,tried){
 tried=tried||[];tried.push("groq");
 const m={h:"Thinking&hellip;"};BOT.msgs.push(m);botRender();
 try{
  if(!await groqEnabled()){BOT.msgs.pop();if(fallback){return botNext(q,fallback,tried)}m.h="The AI is not turned on yet. Add a free GROQ_API_KEY in server/.env (https://console.groq.com/keys) and restart the server.";BOT.msgs.push(m);botRender();return}
  const ans=await groqAsk(q);AIH.push({role:"user",content:q},{role:"assistant",content:ans.slice(0,600)});while(AIH.length>12)AIH.shift();
  m.h=groqHtml(ans)}
 catch(e){if(fallback){BOT.msgs.pop();return botNext(q,fallback,tried)}m.h=esc(e.message||"The AI assistant is not available.")}
 botRender()}
// ---------- TinyFish web search (via our server) ----------
const WEB={ok:null};
const apiBase=()=>(window.SMARTCARE_API_URL||"/api").replace(/\/$/,"");
async function webEnabled(){if(WEB.ok!==null)return WEB.ok;
 try{const r=await fetch(apiBase()+"/health");WEB.ok=!!(await r.json()).tinyfish}catch(e){return false}
 return WEB.ok}
async function webSearch(q){
 const res=await fetch(apiBase()+"/chat/search",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({q})});
 let d=null;try{d=await res.json()}catch(e){}
 if(!res.ok)throw new Error((d&&d.error)||"Web search failed.");
 return d}
function webHtml(d){
 const rs=(d.results||[]).filter(r=>/^https?:\/\//i.test(r.url));
 if(!rs.length)return "I could not find web results for that. Try different words, or ask me about appointments, tokens and departments.";
 return `<b>From the web</b> (TinyFish search)<br>`+rs.map(r=>`<a class="blink" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>${r.snippet?`<br><small>${esc(r.snippet)}</small>`:""}${r.site?`<br><small><i>${esc(r.site)}</i></small>`:""}`).join("<br>")
  +`<br><small>General information only, not medical advice. In an emergency call 108.</small>`}
async function botWeb(q,fallback){
 const m={h:"Searching the web&hellip;"};BOT.msgs.push(m);botRender();
 try{
  if(!await webEnabled()){m.h=fallback?fallback[0]:"Web search is not turned on for this server.";m.chips=fallback&&fallback[1]}
  else m.h=webHtml(await webSearch(q))}
 catch(e){m.h=fallback?fallback[0]:esc(e.message||"Web search failed. Please try again.");m.chips=fallback&&fallback[1]}
 botRender()}
async function botSend(text){text=text.trim();if(!text)return;
 BOT.msgs.forEach(m=>delete m.chips);BOT.msgs.push({me:true,h:text});botRender();
 if(AG.on&&/^(exit|exit agent|quit|bye)$/i.test(text)){AG.on=false;BOT.msgs.push({h:"Left agent mode. I'm back to the regular assistant.",chips:CHIPS});botRender();return}
 const ag=text.match(/^(?:ask\s+)?(?:ai\s+)?agent\b[\s:,-]*(.*)$/i);
 if(ag||AG.on){
  if(!await agentEnabled()){BOT.msgs.push({h:"The AI agent is not turned on for this server. Set AGENT_URL in server/.env and start the agents.",chips:CHIPS});botRender();return}
  AG.on=true;botAgent((ag&&ag[1])||"hello",null);return}
 const gq=!BOT.flow&&text.match(/^(?:ask\s+)?(?:groq|ai)\b[\s:,-]+(.{2,})$/i);
 if(gq){botGroq(gq[1].slice(0,500),null);return}
 const ex=!BOT.flow&&text.match(/^(?:web\s+)?(?:search|google)\s+(?:for\s+|about\s+)?(.{3,})$/i);
 if(ex){botWeb(ex[1].slice(0,200),null);return}
 // not about SmartCare / health at all (general knowledge, studies, coding, ...): straight to the AI
 if(!BOT.flow&&isGeneral(text)){botAI(text.slice(0,500),["I could not find an answer to that right now. I can help with appointments, tokens, queue status, departments and room numbers.",CHIPS]);return}
 let r;try{r=reply(text.replace(/^Book (?=[A-Z])/,"book "))}catch(e){r=["Something went wrong. Please try again."]}
 if(r.web){botAI(text.slice(0,500),r);return}
 setTimeout(()=>{BOT.msgs.push({h:r[0],chips:r[1]});botRender()},350)}
// ---------- Voice input ----------
// Tap the mic and speak in ANY language: the clip is recorded in the browser, sent to our server (Whisper on Groq,
// /api/chat/transcribe) which detects the language and returns the text. The text appears in the box and is sent like a
// typed message, so the rules, AI answers and "search ..." all work by voice. Recording stops by itself when you go quiet
// (or tap the mic again). If the server has no GROQ_API_KEY, it falls back to the browser's own speech recognition
// (Chrome / Edge / Safari; one language at a time, use the EN / हि button).
// Set VOICE.autosend=false if you would rather review/edit the text and press Send yourself.
const VOICE={mode:null,on:false,busy:false,cancel:false,autosend:true,rec:null,stream:null,ctx:null,timer:null,err:null,
 SR:window.SpeechRecognition||window.webkitSpeechRecognition,
 lang:(()=>{try{return localStorage.getItem("sc_voice_lang")||"en-IN"}catch(e){return "en-IN"}})()};
function voiceUI(state){ // state: false | "listen" | "busy"
 const mic=$("#botmic"),inp=$("#botin");if(!mic||!inp)return;
 mic.classList.toggle("rec",state==="listen");mic.classList.toggle("busy",state==="busy");
 mic.setAttribute("aria-pressed",state==="listen");
 mic.setAttribute("aria-label",state==="listen"?"Stop listening":"Speak your question");
 inp.placeholder=state==="listen"?"Listening… speak now":state==="busy"?"Understanding your voice…":"Type your question…"}
function voiceNote(h){BOT.msgs.push({h});botRender()}
function micErr(e){const n=e&&e.name;
 if(n==="NotAllowedError"||n==="SecurityError"||n==="PermissionDeniedError")return "Microphone access is blocked. Tap the lock icon in the address bar, allow the Microphone for this site, and try again.";
 if(n==="NotFoundError"||n==="DevicesNotFoundError")return "No microphone was found. Please connect one and try again.";
 if(n==="NotReadableError")return "The microphone is being used by another app. Close it and try again.";
 return "Could not start the microphone. Please try again."}
function voiceCleanup(){
 clearInterval(VOICE.timer);VOICE.timer=null;
 if(VOICE.stream){VOICE.stream.getTracks().forEach(t=>t.stop());VOICE.stream=null}
 if(VOICE.ctx){try{VOICE.ctx.close()}catch(e){}VOICE.ctx=null}}
function voiceStop(cancel){VOICE.cancel=!!cancel;const r=VOICE.rec;if(!r)return;
 try{if(VOICE.mode==="server")r.stop();else cancel?r.abort():r.stop()}catch(e){}}
function voiceDeliver(text){ // put the words in the box, then send them
 const inp=$("#botin");inp.value=text;
 if(VOICE.autosend)setTimeout(()=>{if(inp.value.trim()===text){inp.value="";botSend(text)}},450);else inp.focus()}

// ---- engine 1: record here, transcribe on the server (any language) ----
async function recStart(){
 let stream;
 try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}})}
 catch(e){voiceNote(micErr(e));return}
 const types=["audio/webm;codecs=opus","audio/webm","audio/mp4","audio/ogg;codecs=opus"];
 const mt=types.find(t=>MediaRecorder.isTypeSupported(t))||"";
 let rec;try{rec=new MediaRecorder(stream,mt?{mimeType:mt}:undefined)}catch(e){stream.getTracks().forEach(t=>t.stop());voiceNote("This browser cannot record audio.");return}
 VOICE.stream=stream;VOICE.rec=rec;VOICE.cancel=false;
 const chunks=[],t0=Date.now();let heard=false,lastVoice=0,an=null,buf=null;
 try{const AC=window.AudioContext||window.webkitAudioContext;VOICE.ctx=new AC();VOICE.ctx.resume&&VOICE.ctx.resume().catch(()=>{});
  an=VOICE.ctx.createAnalyser();an.fftSize=1024;VOICE.ctx.createMediaStreamSource(stream).connect(an);buf=new Uint8Array(an.fftSize)}catch(e){an=null}
 rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
 rec.onstop=async()=>{
  voiceCleanup();VOICE.on=false;VOICE.rec=null;
  if(VOICE.cancel){voiceUI(false);return}
  const blob=new Blob(chunks,{type:rec.mimeType||mt||"audio/webm"});
  if(!heard||blob.size<1500){voiceUI(false);voiceNote("I did not hear anything. Tap the mic and try again.");return}
  await voiceSend(blob)};
 // stop by itself: 1.5 s of quiet after speech, nothing heard for 7 s, or 25 s in total
 VOICE.timer=setInterval(()=>{
  const now=Date.now();
  if(an&&VOICE.ctx&&VOICE.ctx.state==="running"){
   an.getByteTimeDomainData(buf);let sum=0;for(let i=0;i<buf.length;i++){const v=(buf[i]-128)/128;sum+=v*v}
   if(Math.sqrt(sum/buf.length)>0.02){heard=true;lastVoice=now}
   if(heard&&now-lastVoice>1500)return voiceStop(false);
   if(!heard&&now-t0>7000)return voiceStop(false)}
  else{heard=true}   // cannot measure loudness here: the person taps the mic again to stop
  if(now-t0>25000)voiceStop(false)},100);
 rec.start();VOICE.on=true;voiceUI("listen")}
async function voiceSend(blob){
 VOICE.busy=true;voiceUI("busy");
 try{
  const res=await fetch(apiBase()+"/chat/transcribe",{method:"POST",headers:{"Content-Type":blob.type||"audio/webm",Accept:"application/json"},body:blob});
  let d=null;try{d=await res.json()}catch(e){}
  if(!res.ok)throw new Error((d&&d.error)||"Could not understand the audio.");
  const text=String(d.text||"").trim();
  if(!text)voiceNote("I could not make out any words. Please speak a little louder and try again.");
  else voiceDeliver(text)}
 catch(e){voiceNote(esc(e.message||"Voice recognition failed. Please try again."))}
 finally{VOICE.busy=false;voiceUI(false)}}

// ---- engine 2 (fallback): the browser's own speech recognition, one language at a time ----
function srStart(){
 const inp=$("#botin"),base=inp.value.trim();
 const rec=new VOICE.SR();VOICE.rec=rec;VOICE.cancel=false;VOICE.err=null;
 rec.lang=VOICE.lang;rec.interimResults=true;rec.continuous=false;rec.maxAlternatives=1;
 rec.onstart=()=>{VOICE.on=true;voiceUI("listen")};
 rec.onresult=e=>{let t="";for(let i=0;i<e.results.length;i++)t+=e.results[i][0].transcript;inp.value=(base+" "+t).trim()};
 rec.onerror=e=>{VOICE.err=e.error;
  if(e.error==="not-allowed"||e.error==="service-not-allowed")voiceNote("Microphone access is blocked. Tap the lock icon in the address bar, allow the Microphone for this site, and try again.");
  else if(e.error==="no-speech")voiceNote("I did not hear anything. Tap the mic and try again.");
  else if(e.error==="audio-capture")voiceNote("No microphone was found. Please connect one and try again.");
  else if(e.error==="network")voiceNote("This browser's voice recognition could not reach its speech service. Please check your internet, or type your question.")};
 rec.onend=()=>{VOICE.on=false;VOICE.rec=null;voiceUI(false);
  const v=inp.value.trim();
  if(VOICE.autosend&&!VOICE.cancel&&!VOICE.err&&v){inp.value="";botSend(v)}else if(BOT.open)inp.focus()};
 try{rec.start()}catch(e){VOICE.on=false;voiceUI(false)}}

function voiceStart(){
 if(VOICE.busy)return;
 if(VOICE.on){voiceStop(false);return}
 if(!window.isSecureContext){voiceNote("Voice input needs a secure page. Open the site with https:// (or localhost).");return}
 if(VOICE.mode==="server")recStart();else if(VOICE.mode==="browser")srStart()}
function voiceLangUI(){const b=$("#botlang");if(!b)return;const hi=VOICE.lang==="hi-IN";b.textContent=hi?"हि":"EN";
 b.title=hi?"Voice language: Hindi (tap for English)":"Voice language: English / Hinglish (tap for Hindi)";
 b.setAttribute("aria-label",b.title)}
function voiceLang(){if(VOICE.on)voiceStop(true);VOICE.lang=VOICE.lang==="hi-IN"?"en-IN":"hi-IN";
 try{localStorage.setItem("sc_voice_lang",VOICE.lang)}catch(e){}voiceLangUI()}
// pick the engine once the page knows what the server can do
async function voiceInit(){
 const canRec=!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia&&window.MediaRecorder);
 let srv=false;try{srv=canRec&&await groqEnabled()}catch(e){}
 VOICE.mode=srv?"server":VOICE.SR?"browser":null;
 const m=$("#botmic"),l=$("#botlang");
 if(!VOICE.mode){m&&m.remove();l&&l.remove();return}
 if(m)m.hidden=false;
 if(l)l.hidden=VOICE.mode!=="browser";   // the language button is only needed without server-side detection
 voiceLangUI()}
function botToggle(o){BOT.open=o===undefined?!BOT.open:o;if(!BOT.open&&VOICE.on)voiceStop(true);const p=$("#botpanel");p.hidden=!BOT.open;$("#botfab").setAttribute("aria-expanded",BOT.open);
 if(BOT.open){if(!BOT.msgs.length)BOT.msgs.push({h:"Hello! I'm the <b>SmartCare Assistant</b>. Ask me about appointments, tokens, queue status, departments or room numbers.",chips:CHIPS});botRender();$("#botin").focus()}}
(function mountBot(){
 const w=document.createElement("div");w.id="bot";
 w.innerHTML=`<button id="botfab" class="botfab" aria-label="Open chatbot" aria-expanded="false" aria-controls="botpanel"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9 11h.01M12 11h.01M15 11h.01"/></svg></button>
 <section id="botpanel" class="botpanel" hidden aria-label="SmartCare Assistant"><header><div><b>SmartCare Assistant</b><small>Appointments, queue help &amp; AI answers</small></div><button id="botx" aria-label="Close chatbot">&times;</button></header>
 <div id="botmsgs" class="botmsgs" aria-live="polite"></div>
 <form id="botf" class="botf" autocomplete="off"><input id="botin" placeholder="Type your question…" aria-label="Message"><button type="button" id="botlang" class="botlang" hidden aria-label="Voice language">EN</button><button type="button" id="botmic" class="botmic" hidden aria-label="Speak your question" aria-pressed="false"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/></svg></button><button class="btn" aria-label="Send">Send</button></form></section>`;
 document.body.appendChild(w);
 $("#botfab").onclick=()=>botToggle();$("#botx").onclick=()=>botToggle(false);
 $("#botmic").onclick=voiceStart;$("#botlang").onclick=voiceLang;voiceInit();
 $("#botf").onsubmit=e=>{e.preventDefault();const i=$("#botin");const v=i.value;i.value="";botSend(v)};
 addEventListener("keydown",e=>{if(e.key==="Escape"&&BOT.open)botToggle(false)})})();