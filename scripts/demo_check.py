"""Plays the Margaret scenario against the running server and says, in plain words,
whether each demo beat happened. No dashboard needed.

    make api-live                     (window 1, leave running)
    python -m scripts.demo_check      (window 2)
"""
import asyncio
import json
import math
import re
import subprocess
import sys
import time

import httpx
import websockets

API = "http://localhost:8000"
PARK = (53.5335, -113.5380)          # Emily Murphy Park, by the river (lat, lon)


def km(a_lat, a_lon, b_lat, b_lon):
    dx = (a_lon - b_lon) * 111.32 * math.cos(math.radians(a_lat))
    return math.hypot(dx, (a_lat - b_lat) * 111.32)


async def main() -> None:
    scenario = json.load(open("scenario/margaret.json"))
    ls = scenario["case"]["last_seen"]
    cid = httpx.post(f"{API}/case", json=scenario["case"]).json()["case_id"]
    print(f"case {cid}: playing the Margaret scenario (about 50 seconds)\n")
    seen = {"drone": None, "ground": None, "hot_at_park": False, "stories": set(), "updates": 0,
            "match": None, "alerts": []}
    template = re.compile(r"^\d+% of the remaining possibilities")
    shown = set()
    async with websockets.connect(f"ws://localhost:8000/stream/{cid}", max_size=None) as ws:
        proc = subprocess.Popen([sys.executable, "scenario/run_scenario.py", "--case", cid],
                                stdout=subprocess.DEVNULL)
        t0, last = time.time(), -10
        while time.time() - t0 < 55:
            msg = json.loads(await ws.recv())
            el = time.time() - t0
            if msg["type"] == "evidence" and msg["data"]["kind"] != "note":
                print(f"[{el:3.0f}s] card: {msg['data']['summary'][:80]}")
            elif msg["type"] == "alert":
                a = msg["data"]
                seen["alerts"].append(a)
                print(f"[{el:3.0f}s] public alert area v{a['version']}: {a['area_km2']} km², "
                      f"covers {a['covers']:.0%}. {a['reason'][:110]}")
            elif msg["type"] == "found":
                f = msg["data"]
                seen["match"] = f
                print(f"[{el:3.0f}s] ALERT: {f['note']} "
                      f"({km(f['location']['lat'], f['location']['lon'], *PARK):.2f} km from the park)")
            elif msg["type"] == "tasking":
                r = msg["data"]
                key = "drone" if r["asset"].startswith("Drone") else "ground"
                first = seen[key] is None or seen[key]["id"] != r["id"]
                seen["updates"] += 0 if first else 1
                seen[key] = r
                tag = "request" if first else "request updated (AI wording)"
                print(f"[{el:3.0f}s] {tag}: {r['asset']}, covers {r['expected_gain']:.0%}, {r['duration_min']:.0f} min")
                for reason in r["reasons"]:
                    print(f"         - {reason}")
            elif msg["type"] == "ghosts" and msg["data"]["clusters"] and el - last >= 5:
                last = el
                c = msg["data"]["clusters"][0]
                lat, lon = c["center"]["lat"], c["center"]["lon"]
                d_park, d_ls = km(lat, lon, *PARK), km(lat, lon, ls["lat"], ls["lon"])
                where = ("at Emily Murphy Park" if d_park < 0.4 else
                         "near the last-seen corner" if d_ls < 0.4 else f"{d_ls:.1f} km from last seen")
                if d_park < 0.4:
                    seen["hot_at_park"] = True
                print(f"[{el:3.0f}s] hot spot: {c['probability']:.0%} {where}")
                story = c.get("story") or ""
                seen["stories"].add(story)
                gist = re.sub(r"\d+%", "", story)
                if story and gist not in shown:
                    shown.add(gist)
                    print(f"         story: {story}")
        proc.wait(timeout=10)

    ai_reasons = seen["updates"] > 0
    ai_story = any(s and not template.match(s) for s in seen["stories"])
    checks = [
        ("Hot spot moved to Emily Murphy Park after the bus sighting", seen["hot_at_park"]),
        ("Drone 2 request appeared", seen["drone"] is not None),
        ("Ground Team 1 request appeared after the drone clue", seen["ground"] is not None),
        ("Possible-match alert raised at the park (awaiting officer confirmation)",
         seen["match"] is not None and km(seen["match"]["location"]["lat"],
                                          seen["match"]["location"]["lon"], *PARK) < 0.4),
        ("Public alert area suggested, with a second wave after the bus sighting (no spam)",
         1 < len(seen["alerts"]) <= 3),
        ("Claude rewrote the request reasons", ai_reasons),
        ("Claude wrote at least one hot-spot story", ai_story),
    ]
    print()
    for name, ok in checks:
        print(("PASS  " if ok else "FAIL  ") + name)


asyncio.run(main())
