"""Run all four agents in one process (local development / demo).

    python run_all.py

Each agent can also be started alone (python triage_agent.py ...) and deployed to Agentverse."""
from uagents import Bureau

from booking_agent import booking
from concierge_agent import PORT, concierge
from queue_agent import queue
from triage_agent import triage

if __name__ == "__main__":
    bureau = Bureau(port=PORT, endpoint=[f"http://localhost:{PORT}/submit"])
    for a in (triage, queue, booking, concierge):
        bureau.add(a)
    bureau.run()
