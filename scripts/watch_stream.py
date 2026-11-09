"""Quick CLI check: opens a case and prints what arrives on the stream.

    python -m scripts.watch_stream          (server must be running on :8000)
"""
import asyncio
import json

import httpx
import websockets

API = "http://localhost:8000"


async def main() -> None:
    case = httpx.post(f"{API}/case", json={
        "name": "Margaret (fictional)", "age": 79, "condition": "dementia",
        "mobility": "low", "clothing": ["grey hooded jacket", "dark track pants"],
    }).json()
    print("case:", case["case_id"])
    async with websockets.connect(f"ws://localhost:8000/stream/{case['case_id']}") as ws:
        while True:
            msg = json.loads(await ws.recv())
            if msg["type"] == "ghosts":
                d = msg["data"]
                print(f"ghosts: {len(d['positions'])} pts, top cluster "
                      f"{d['clusters'][0]['probability']:.0%}" if d["clusters"] else "")
            else:
                print(msg["type"], "->", msg["data"].get("summary") or msg["data"].get("detail") or msg["data"].get("asset"))


if __name__ == "__main__":
    asyncio.run(main())
