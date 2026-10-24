"""Shared message models, config and the SmartCare API client used by every agent."""
import os
from typing import Any, Dict, Optional

import httpx
from dotenv import load_dotenv
from uagents import Model
from uagents.crypto import Identity

load_dotenv()

API = os.getenv("SMARTCARE_API", "http://localhost:5000/api").rstrip("/")
WEB = os.getenv("SMARTCARE_WEB", "http://localhost:5173").rstrip("/")
SEED = os.getenv("AGENT_SEED_PHRASE", "smartcare-dev-seed-change-me")
ASI1_API_KEY = os.getenv("ASI1_API_KEY", "").strip()
ASI1_MODEL = os.getenv("ASI1_MODEL", "asi1-mini")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
GROQ_BASE_URL = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")


def seed_of(role: str) -> str:
    return f"{SEED}::{role}"


def address_of(role: str) -> str:
    """Deterministic agent address, so agents can find each other without a registry lookup."""
    return Identity.from_seed(seed_of(role), 0).address


# ---------------------------------------------------------------- messages
class TriageRequest(Model):
    text: str


class TriageResponse(Model):
    department: str
    urgency: str  # routine | urgent | emergency
    reason: str
    source: str  # rules | groq | asi1


class QueueRequest(Model):
    department: str = ""
    token: str = ""


class QueueResponse(Model):
    ok: bool
    text: str
    data: Dict[str, Any] = {}


class BookingRequest(Model):
    department: str
    name: str
    age: int
    phone: str
    address: str
    confirm_payment: bool = False  # patient agreed to pay the fee (demo payment mode)


class BookingResponse(Model):
    ok: bool
    status: str  # booked | payment_required | handoff | failed
    text: str
    ticket: Dict[str, Any] = {}
    fee: int = 0


# ---------------------------------------------------------------- API client
class ApiError(Exception):
    pass


async def api(method: str, path: str, json: Optional[dict] = None, params: Optional[dict] = None) -> Any:
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.request(method, f"{API}{path}", json=json, params=params)
    except httpx.HTTPError as e:  # network down, refused, timeout
        raise ApiError("The hospital system is not reachable right now.") from e
    try:
        data = r.json()
    except ValueError:
        data = {}
    if r.status_code >= 400:
        raise ApiError(data.get("error") or f"Request failed ({r.status_code}).")
    return data


async def find_department(name: str) -> Optional[dict]:
    name = (name or "").strip().lower()
    if not name:
        return None
    depts = await api("GET", "/departments")
    for d in depts:
        if d["name"].lower() == name:
            return d
    for d in depts:
        if name in d["name"].lower() or d["name"].lower() in name:
            return d
    return None
