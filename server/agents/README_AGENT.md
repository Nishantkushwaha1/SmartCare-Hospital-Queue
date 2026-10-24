# SmartCare Concierge

![domain:healthcare](https://img.shields.io/badge/domain-healthcare-blue) ![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)

**SmartCare Concierge** is a multi-agent assistant for hospital OPD queues. Talk to it in English or Hinglish.

**What it can do**
- *Find the right department:* "mere bachche ko bukhar hai", "I have a skin rash". Emergency red flags (chest pain, stroke signs, heavy bleeding...) are caught by fixed rules and sent to Emergency / 108 instead of a queue.
- *Show live OPD info:* room, doctor timing, patients waiting, estimated wait, fee, tokens left. Example: "Cardiology queue".
- *Track a token:* "status GM-048".
- *Book an online OPD token:* "book appointment for fever". It asks name, age, phone and address, then books (and asks before any fee).

**How it works.** The Concierge delegates over uAgents messages to a Triage agent (symptoms to department, optional ASI:One LLM), a Queue agent (live data) and a Booking agent (reserves the token through the SmartCare API). It never diagnoses, does not store patient details, and does not handle card details: with real Razorpay the patient finishes payment in the web app.

Example: *"book appointment for chest pain"* -> Emergency advice. *"book general medicine"* -> asks details -> token confirmed with room and estimated time.
