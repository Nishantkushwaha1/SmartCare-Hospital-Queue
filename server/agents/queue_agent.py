"""Queue Agent: live department / token information from the SmartCare API (no personal data)."""
import re

from uagents import Agent, Context

from common import ApiError, QueueRequest, QueueResponse, api, find_department, seed_of

queue = Agent(name="smartcare-queue", seed=seed_of("queue"), port=8002, endpoint=["http://localhost:8002/submit"])


def eta(waiting: int, minutes_each: int = 6) -> str:
    return "no wait" if waiting <= 0 else f"about {waiting * minutes_each} min"


async def lookup(req: QueueRequest) -> QueueResponse:
    try:
        if req.token:
            tok = req.token.strip().upper()
            if not re.fullmatch(r"[A-Z]{2,3}-\d{3,5}", tok):
                return QueueResponse(ok=False, text="A token looks like GM-048. Please check the number.")
            t = await api("GET", f"/queue/token/{tok}")
            est = (t.get("estimate") or {}).get("text") or "n/a"
            return QueueResponse(
                ok=True, data=t,
                text=f"Token {t['token']} ({t['department']}): status {t['status']}, Room {t['room']}, "
                     f"{t.get('ahead', 0)} patient(s) ahead, estimated time {est}.",
            )
        d = await find_department(req.department)
        if not d:
            depts = await api("GET", "/departments")
            lines = [f"{x['name']}: Room {x['room']}, {x['waiting']} waiting, {x['onlineLeft']} online tokens left" for x in depts]
            return QueueResponse(ok=True, text="Today's OPDs:\n" + "\n".join(lines), data={"departments": depts})
        fee = f"Rs {d['fee']}" if d["fee"] else "Free"
        return QueueResponse(
            ok=True, data=d,
            text=f"{d['name']} (OPD {d['status']}): Room {d['room']}, {d['timing']}. Now serving {d['currentToken'] or 'nobody yet'}, "
                 f"{d['waiting']} waiting ({eta(d['waiting'])}). Fee {fee}. Tokens left: {d['onlineLeft']} online, {d['offlineLeft']} at counter.",
        )
    except ApiError as e:
        return QueueResponse(ok=False, text=str(e))


@queue.on_message(model=QueueRequest, replies={QueueResponse})
async def on_queue(ctx: Context, sender: str, msg: QueueRequest):
    await ctx.send(sender, await lookup(msg))


if __name__ == "__main__":
    queue.run()
