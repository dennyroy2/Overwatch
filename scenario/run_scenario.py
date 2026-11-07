"""Play a demo scenario: open the case, then send each evidence card on time.

    py scenario\run_scenario.py                      (uses scenario/margaret.json)
    py scenario\run_scenario.py --case case_abc123   (add cards to an existing case)
"""
import argparse
import json
import time
from datetime import datetime, timedelta
from pathlib import Path

import httpx

API = "http://localhost:8000"
DEFAULT_FILE = Path(__file__).parent / "margaret.json"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", default=DEFAULT_FILE)
    parser.add_argument("--case", help="existing case_id (skip creating one)")
    args = parser.parse_args()

    scenario = json.loads(Path(args.file).read_text(encoding="utf-8"))

    # 1. Open the case (or use the one the dashboard already opened)
    if args.case:
        case_id = args.case
    else:
        case_id = httpx.post(f"{API}/case", json=scenario["case"]).json()["case_id"]
    print("case:", case_id)

    # 2. Story clock starts when she was last seen
    last_seen = datetime.fromisoformat(scenario["case"]["last_seen_time"])

    # 3. Send each beat at its demo second
    start = time.monotonic()
    for beat in sorted(scenario["beats"], key=lambda b: b["at_s"]):
        wait = beat["at_s"] - (time.monotonic() - start)
        if wait > 0:
            time.sleep(wait)

        evidence = {k: v for k, v in beat.items() if k not in ("at_s", "minutes_after")}
        evidence["case_id"] = case_id
        evidence["confirmed"] = True
        evidence["time"] = (last_seen + timedelta(minutes=beat["minutes_after"])).isoformat()

        r = httpx.post(f"{API}/evidence", json=evidence)
        r.raise_for_status()
        print(f"[{beat['at_s']:>3}s] {beat['kind']:16s} {beat['summary']}")


if __name__ == "__main__":
    main()