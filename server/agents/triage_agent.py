"""Triage Agent: symptoms (English / Hinglish) -> department + urgency.

Red-flag rules always run first and can never be downgraded by the LLM. If GROQ_API_KEY (or ASI1_API_KEY) is set, the LLM
refines the department for free-text descriptions; otherwise the keyword rules answer on their own."""
import json
import re

from uagents import Agent, Context

import llm
from common import TriageRequest, TriageResponse, seed_of

DEPARTMENTS = [
    "Emergency", "Cardiology", "Neurology", "Orthopedics", "Pediatrics", "Dermatology", "ENT",
    "Gynecology", "Ophthalmology", "Dental", "Radiology", "Pathology", "Surgery", "Physiotherapy",
    "General Medicine",
]

RED_FLAGS = re.compile(
    r"chest pain|seene mein dard|heart attack|can'?t breathe|cannot breathe|breathless|saans nahi|unconscious|behosh|"
    r"stroke|paralysis|seizure|fits|severe bleeding|bleeding heavily|accident|poison|overdose|suicid|snake bite|"
    r"not responding|choking",
    re.I,
)

RULES = [
    (r"chest|heart|cardio|blood pressure|\bbp\b|palpitation|seene", "Cardiology"),
    (r"neuro|migraine|headache|head ache|sir dard|seizure|fits|stroke|paralysis|nerve|dizz|chakkar", "Neurology"),
    (r"ortho|bone|fracture|joint|knee|ghutna|haddi|shoulder|sprain", "Orthopedics"),
    (r"pediatric|paediatric|child|kid|baby|infant|bachcha|baccha|bachche|newborn", "Pediatrics"),
    (r"derma|skin|rash|itch|khujli|pimple|acne|allerg|chamdi|hair fall", "Dermatology"),
    (r"\bent\b|\bear\b|kaan|nose|naak|throat|gala|sinus|tonsil", "ENT"),
    (r"gyn|pregnan|garbh|period|maternity|antenatal", "Gynecology"),
    (r"ophthal|\beye\b|aankh|vision|cataract|chashma", "Ophthalmology"),
    (r"dental|dentist|tooth|teeth|daant|gum|cavity", "Dental"),
    (r"x-?ray|\bmri\b|\bct\b|scan|ultrasound|sonograph", "Radiology"),
    (r"blood test|urine|\blab\b|sample|sugar test", "Pathology"),
    (r"surg|operation|hernia|appendix|gallbladder|piles", "Surgery"),
    (r"physio|rehab|back pain|kamar|spine|neck pain|therapy", "Physiotherapy"),
    (r"fever|bukhar|cold|cough|khansi|sardi|stomach|pet dard|body ache|weakness|vomit|diarrh|general|physician", "General Medicine"),
]

triage = Agent(name="smartcare-triage", seed=seed_of("triage"), port=8001, endpoint=["http://localhost:8001/submit"])


def by_rules(text: str) -> TriageResponse:
    if RED_FLAGS.search(text):
        return TriageResponse(
            department="Emergency", urgency="emergency", source="rules",
            reason="Your symptoms can be serious. Go to Emergency now (or call 108/112). Do not wait for an online token.",
        )
    t = text.lower()
    for pattern, dept in RULES:
        if re.search(pattern, t):
            return TriageResponse(department=dept, urgency="routine", source="rules", reason=f"Symptoms match {dept}.")
    return TriageResponse(department="General Medicine", urgency="routine", source="rules",
                          reason="Could not match a specialty, so General Medicine is the safest first stop.")


async def by_llm(text: str) -> TriageResponse | None:
    """Ask the LLM (Groq, else ASI:One) to pick one department. None on any problem so the rules answer instead."""
    if not llm.enabled():
        return None
    prompt = (
        "You route hospital OPD patients. Choose exactly ONE department from this list: "
        + ", ".join(DEPARTMENTS)
        + '. Reply ONLY with JSON: {"department": "...", "reason": "one short sentence"}. '
        "The patient may write in English or Hinglish. You are not diagnosing."
    )
    got = await llm.complete([{"role": "system", "content": prompt}, {"role": "user", "content": text[:500]}], temperature=0, timeout=12)
    if not got:
        return None
    raw, provider = got
    try:
        out = json.loads(re.search(r"\{.*\}", raw, re.S).group(0))
        dept = next((d for d in DEPARTMENTS if d.lower() == str(out.get("department", "")).lower()), None)
        if not dept or dept == "Emergency":  # emergencies are decided by the red-flag rules only
            return None
        return TriageResponse(department=dept, urgency="routine", source=provider, reason=str(out.get("reason", ""))[:200])
    except Exception:
        return None


async def classify(text: str) -> TriageResponse:
    ruled = by_rules(text)
    if ruled.urgency == "emergency":
        return ruled
    # Rules matched a specific specialty -> trust them. Only the unclear cases go to the LLM.
    if ruled.reason.startswith("Symptoms match"):
        return ruled
    return (await by_llm(text)) or ruled


@triage.on_message(model=TriageRequest, replies={TriageResponse})
async def on_triage(ctx: Context, sender: str, msg: TriageRequest):
    res = await classify(msg.text)
    ctx.logger.info(f"triage -> {res.department} ({res.urgency}, {res.source})")
    await ctx.send(sender, res)


if __name__ == "__main__":
    triage.run()
