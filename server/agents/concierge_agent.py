"""SmartCare Concierge: the agent patients and ASI:One talk to.

It understands a request, then delegates to three specialist agents over uAgents messaging:
  Triage agent   - symptoms -> department / urgency
  Queue agent    - live queue, room, wait time, token status
  Booking agent  - reserves the OPD token (and the fee, in demo payment mode)

Entry points: ASI:One / Agentverse chat protocol (mailbox) and a small REST endpoint used by the web chatbot."""
import os
import re
from datetime import datetime, timezone
from typing import Dict
from uuid import uuid4

from uagents import Agent, Context, Model, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement, ChatMessage, EndSessionContent, StartSessionContent, TextContent, chat_protocol_spec,
)

import knowledge
import llm
from common import (
    BookingRequest, BookingResponse, QueueRequest, QueueResponse, TriageRequest, TriageResponse,
    address_of, find_department, seed_of, ApiError,
)

USE_MAILBOX = os.getenv("USE_MAILBOX", "false").lower() == "true"
PORT = int(os.getenv("CONCIERGE_PORT", "8000"))

README = os.path.join(os.path.dirname(__file__), "README_AGENT.md")
concierge = Agent(
    name="smartcare-concierge",
    seed=seed_of("concierge"),
    port=PORT,
    mailbox=USE_MAILBOX,
    endpoint=None if USE_MAILBOX else [f"http://localhost:{PORT}/submit"],
    description="Books hospital OPD tokens, finds the right department for symptoms and tracks live queues (SmartCare).",
    publish_agent_details=True,
    readme_path=README if os.path.exists(README) else None,
)

TRIAGE, QUEUE, BOOKING = address_of("triage"), address_of("queue"), address_of("booking")
TIMEOUT = 20

HELP = (
    "I'm the SmartCare assistant. I can:\n"
    "- find the right department: \"I have chest pain\", \"mere bachche ko bukhar hai\"\n"
    "- show live OPD info: \"Cardiology queue\", \"departments\"\n"
    "- track a token: \"status GM-048\"\n"
    "- explain the app: \"what is the next step after registration?\", \"payment failed\", \"how do refunds work\"\n"
    "- book an OPD token: \"book appointment for skin rash\"\n"
    "- ask me anything else (general knowledge, studies, coding, health information...)\n"
    "I don't diagnose. In an emergency call 108 / 112."
)

sessions: Dict[str, dict] = {}  # session id -> {"stage", "data"}; in memory only, patient details are never persisted


class ChatRequest(Model):
    message: str
    session_id: str = "web"


class ChatReply(Model):
    reply: str
    done: bool = False


async def ask(ctx: Context, addr: str, msg: Model, resp_type):
    res, status = await ctx.send_and_receive(addr, msg, response_type=resp_type, timeout=TIMEOUT)
    if res is None or not isinstance(res, resp_type):
        raise ApiError("One of my helper agents did not answer in time. Please try again.")
    return res


def _clean_phone(s: str):
    p = re.sub(r"[^\d+]", "", s)
    return p if re.fullmatch(r"\+?\d{10,13}", p) else None


FIELDS = ["name", "age", "phone", "address"]
PROMPTS = {
    "name": "What is the patient's full name?",
    "age": "Patient's age?",
    "phone": "Mobile number (10 digits)?",
    "address": "Patient's address?",
}


def validate(field: str, text: str):
    t = text.strip()
    if field == "name":
        return t if 2 <= len(t) <= 80 else None
    if field == "age":
        m = re.search(r"\d{1,3}", t)
        return int(m.group()) if m and 0 <= int(m.group()) <= 120 else None
    if field == "phone":
        return _clean_phone(t)
    return t if 1 <= len(t) <= 300 else None


def start_collect(s: dict, d: dict) -> str:
    """Begin collecting patient details, unless the department cannot take an online booking anyway."""
    if d["status"] == "Unavailable" or d["onlineLeft"] <= 0:
        s.update(stage=None, data={})
        why = "is not available right now" if d["status"] == "Unavailable" else "has no online tokens left today"
        return f"{d['name']} {why}. You can take a counter token at the hospital (Room {d['room']})."
    s["data"] = {"department": d["name"]}
    s["stage"] = "collect"
    return f"Booking {d['name']} (Room {d['room']}, {d['waiting']} waiting). {PROMPTS['name']}"


NO_AI = (
    "I can help with SmartCare topics (departments, queues, tokens, booking, payments). For other questions the AI is not turned on yet: "
    "add a free GROQ_API_KEY (https://console.groq.com/keys) to server/.env (or the Render Environment tab) and restart."
)


async def general_reply(s: dict, text: str):
    """Any question the hospital rules do not cover: ask the LLM, remembering the last few turns of this chat."""
    hist = s.setdefault("hist", [])
    ans = await knowledge.general_answer(text, hist)
    if ans:
        hist += [{"role": "user", "content": text[:500]}, {"role": "assistant", "content": ans[:600]}]
        del hist[:-12]
    return ans


async def triage_then_queue(ctx: Context, text: str) -> str:
    tr = await ask(ctx, TRIAGE, TriageRequest(text=text), TriageResponse)
    if tr.urgency == "emergency":
        return f"EMERGENCY: {tr.reason}"
    q = await ask(ctx, QUEUE, QueueRequest(department=tr.department), QueueResponse)
    return f"Suggested department: {tr.department} ({tr.reason})\n{q.text}\nSay \"book\" to get an online token. This is guidance, not a diagnosis."


async def handle(ctx: Context, sid: str, text: str) -> str:
    s = sessions.setdefault(sid, {"stage": None, "data": {}})
    if len(sessions) > 500:  # keep memory bounded
        sessions.pop(next(iter(sessions)))
    t = text.strip()
    low = t.lower()

    if re.fullmatch(r"(cancel|stop|exit|quit|nahi|no)", low) and s["stage"]:
        s.update(stage=None, data={})
        return "Okay, cancelled. How else can I help?"

    # ---- booking conversation ----
    if s["stage"] == "dept":
        d = await find_department(t)
        if d is None:  # maybe symptoms instead of a department name
            tr = await ask(ctx, TRIAGE, TriageRequest(text=t), TriageResponse)
            if tr.urgency == "emergency":
                s.update(stage=None, data={})
                return f"EMERGENCY: {tr.reason}"
            d = await find_department(tr.department)
        if d is None:
            return "I could not find that department. Tell me a department name or the problem (e.g. \"skin rash\")."
        return start_collect(s, d)

    if s["stage"] == "collect":
        missing = next(f for f in FIELDS if f not in s["data"])
        v = validate(missing, t)
        if v is None:
            return f"That doesn't look right. {PROMPTS[missing]}"
        s["data"][missing] = v
        nxt = next((f for f in FIELDS if f not in s["data"]), None)
        if nxt:
            return PROMPTS[nxt]
        return await finish_booking(ctx, s, confirm=False)

    if s["stage"] == "pay":
        if re.fullmatch(r"(yes|y|haan|ha|pay|ok|confirm)", low):
            return await finish_booking(ctx, s, confirm=True)
        s.update(stage=None, data={})
        return "Okay, I have not booked anything. Anything else?"

    # ---- new requests ----
    tok = re.search(r"\b([A-Za-z]{2,3})-?(\d{3,5})\b", t)
    if tok and re.search(r"status|token|queue|where|kab|number|turn|track", low):
        q = await ask(ctx, QUEUE, QueueRequest(token=f"{tok.group(1)}-{tok.group(2)}".upper()), QueueResponse)
        return q.text

    if re.search(r"\b(hi|hello|hey|namaste|help)\b", low) and len(low) < 25:
        return HELP

    # clearly not about SmartCare / health (general knowledge, studies, coding...): straight to the LLM
    if knowledge.is_general(t):
        ans = await general_reply(s, t)
        return ans or (NO_AI if not llm.enabled() else "Sorry, I could not get an answer right now. Please try again.")

    # how-to / what-next questions: answered from the knowledge base (same one the web chatbot uses)
    last = s.get("last")
    if last and last.get("next") and re.fullmatch(r"(then|and then|next|what next|whats next|then what|aur|phir|phir kya|uske baad|uske baad kya|after that|aage)\??", low):
        nxt = next((e for e in knowledge.load() if e["id"] == last["next"]), None)
        if nxt:
            s["last"] = nxt
            return knowledge.plain(nxt["a"])
    faq = knowledge.confident(t)
    if faq:
        s["last"] = faq
        return knowledge.plain(faq["a"])

    if re.search(r"^book\b|\bappointments?\b|\bregist(er|ration)\b|\btoken (chahiye|lena|le)\b|\bget (a )?token\b|\bbook(ing)? (an? |the |my )?(appointment|token|opd|slot|doctor)", low):
        stripped = re.sub(r"\b(book|an?|the|my|appointment|token|please|for|me|i|want|to|need|register|get|online|opd)\b", " ", low).strip()
        d = await find_department(stripped) if stripped else None
        if d is None and len(stripped) > 3:
            tr = await ask(ctx, TRIAGE, TriageRequest(text=stripped), TriageResponse)
            if tr.urgency == "emergency":
                return f"EMERGENCY: {tr.reason}"
            d = await find_department(tr.department)
        s["data"] = {}
        if d:
            return start_collect(s, d)
        s["stage"] = "dept"
        return "Sure. Which department, or what is the problem (e.g. \"chest pain\")?"

    if re.search(r"\b(departments?|queue|waiting|wait|room|opd|doctors?|timings?|fees?|dept)\b", low):
        stripped = re.sub(r"\b(queue|waiting|wait|room|opd|doctor|timing|fee|dept|department|status|of|the|in|which|is|for|show|tell|me)\b", " ", low).strip()
        q = await ask(ctx, QUEUE, QueueRequest(department=stripped), QueueResponse)
        return q.text

    if len(low) >= 3:
        faq = knowledge.loose(t)
        if faq:
            s["last"] = faq
            return knowledge.plain(faq["a"])
        grounded = await general_reply(s, t)  # Groq / ASI:One, only if a key is set
        if grounded:
            return grounded
        if knowledge.looks_medical(t):
            return await triage_then_queue(ctx, t)
        return NO_AI if not llm.enabled() else "Sorry, I could not get an answer right now. Please try again."
    return HELP


async def finish_booking(ctx: Context, s: dict, confirm: bool) -> str:
    d = s["data"]
    br = await ask(ctx, BOOKING, BookingRequest(
        department=d["department"], name=d["name"], age=d["age"], phone=d["phone"], address=d["address"],
        confirm_payment=confirm), BookingResponse)
    if br.status == "payment_required":
        s["stage"] = "pay"
        return f"{br.text} Reply YES to pay Rs {br.fee} and confirm the token (practice payment), or NO to cancel."
    s.update(stage=None, data={})
    if br.status == "booked":
        return f"{br.text}\nShow this token at the room. You can track it by saying \"status {br.ticket.get('token', '')}\"."
    return br.text


async def safe_handle(ctx: Context, sid: str, text: str) -> str:
    try:
        return await handle(ctx, sid, text)
    except ApiError as e:
        return str(e)
    except Exception:
        ctx.logger.exception("handler failed")
        return "Sorry, something went wrong on my side. Please try again."


# ------------------------------------------------------------ ASI:One / Agentverse chat protocol
chat_proto = Protocol(spec=chat_protocol_spec)


@chat_proto.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id))
    text = " ".join(c.text for c in msg.content if isinstance(c, TextContent)).strip()
    if any(isinstance(c, StartSessionContent) for c in msg.content) and not text:
        reply = HELP
    elif not text:
        return
    else:
        reply = await safe_handle(ctx, sender, text)
    await ctx.send(sender, ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=[TextContent(type="text", text=reply)]))


@chat_proto.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    ctx.logger.debug(f"ack from {sender[:12]}")


concierge.include(chat_proto, publish_manifest=True)


# ------------------------------------------------------------ REST (web chatbot -> backend -> here)
@concierge.on_rest_post("/chat", ChatRequest, ChatReply)
async def on_rest_chat(ctx: Context, req: ChatRequest) -> ChatReply:
    sid = "web:" + re.sub(r"[^\w\-]", "", req.session_id)[:60]
    return ChatReply(reply=await safe_handle(ctx, sid, req.message[:500]))
