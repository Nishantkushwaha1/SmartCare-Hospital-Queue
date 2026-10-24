"""Booking Agent: books an online OPD token through the SmartCare API.

Rules it enforces:
- a paid department is never reserved until the patient has agreed to pay (confirm_payment);
- in PAYMENT_MODE=demo the agent completes the practice payment; with real Razorpay it hands the patient
  to the web app instead (card / UPI details must never pass through an agent)."""
from uagents import Agent, Context

from common import WEB, ApiError, BookingRequest, BookingResponse, api, find_department, seed_of

booking = Agent(name="smartcare-booking", seed=seed_of("booking"), port=8003, endpoint=["http://localhost:8003/submit"])


def ticket_text(t: dict) -> str:
    est = (t.get("estimate") or {}).get("text") or "n/a"
    return f"Token {t['token']} confirmed: {t['department']}, Room {t['room']}, {t.get('ahead', 0)} ahead, estimated time {est}."


async def book(req: BookingRequest) -> BookingResponse:
    try:
        d = await find_department(req.department)
        if not d:
            return BookingResponse(ok=False, status="failed", text=f"I could not find the department '{req.department}'.")
        if d["status"] == "Unavailable":
            return BookingResponse(ok=False, status="failed", text=f"{d['name']} OPD is not available right now.")
        if d["onlineLeft"] <= 0:
            return BookingResponse(ok=False, status="failed",
                                   text=f"Online tokens for {d['name']} are full. Please take a counter token at Room {d['room']}.")
        fee = int(d["fee"] or 0)
        if fee and not req.confirm_payment:
            return BookingResponse(ok=True, status="payment_required", fee=fee,
                                   text=f"{d['name']} has a registration fee of Rs {fee}.")
        health = await api("GET", "/health")
        if fee and health.get("paymentMode") != "demo":
            return BookingResponse(ok=True, status="handoff", fee=fee,
                                   text=f"Please complete the Rs {fee} payment securely in the app: {WEB}/#/register")
        res = await api("POST", "/bookings/online", json={
            "departmentId": d["id"], "name": req.name, "age": req.age, "phone": req.phone, "address": req.address})
        if res.get("free"):
            return BookingResponse(ok=True, status="booked", ticket=res["ticket"], text=ticket_text(res["ticket"]))
        paid = await api("POST", "/payments/demo/confirm", json={"orderId": res["order"]["id"], "method": "UPI"})
        return BookingResponse(ok=True, status="booked", fee=fee, ticket=paid["ticket"],
                               text=ticket_text(paid["ticket"]) + f" (demo payment of Rs {fee} recorded)")
    except ApiError as e:
        return BookingResponse(ok=False, status="failed", text=str(e))


@booking.on_message(model=BookingRequest, replies={BookingResponse})
async def on_booking(ctx: Context, sender: str, msg: BookingRequest):
    ctx.logger.info(f"booking request for {msg.department}")  # never log patient details
    await ctx.send(sender, await book(msg))


if __name__ == "__main__":
    booking.run()
