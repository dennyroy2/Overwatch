"""`python -m backend.perception.emit --case <id> --clip <id>` posts a clip's evidence to the API at the right offsets,
so perception can run during the fake stream (or the scripted demo) without anyone wiring it in.

The first item is posted `offset_s` seconds after this command starts (use `--speed 2` to go twice as fast, `--dry-run`
to only print). The evidence's `time` is `--sim-start` plus its offset; without `--sim-start` it is the case's
last-seen time plus `--minutes-after` (95 by default, the scripted demo's drone moment). An evidence time at or after
the simulation clock is treated by the engine as "now", so a late `--sim-start` is harmless.
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timedelta
from typing import Callable

import httpx

from .replay import schedule_for_clip


def _parse_time(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def main(argv: list[str] | None = None, client: httpx.Client | None = None,
         sleep: Callable[[float], None] = time.sleep, out=sys.stdout) -> int:
    p = argparse.ArgumentParser(prog="backend.perception.emit", description=__doc__)
    p.add_argument("--case", required=True, help="case id to post evidence to")
    p.add_argument("--clip", required=True, help="clip id (the sidecar's name without .detections.json)")
    p.add_argument("--api", default="http://localhost:8000", help="API base URL")
    p.add_argument("--sim-start", default=None, help="ISO time the clip starts at, in simulation time")
    p.add_argument("--minutes-after", type=float, default=95.0, help="without --sim-start: minutes after last seen")
    p.add_argument("--speed", type=float, default=1.0, help="2 = twice as fast")
    p.add_argument("--dry-run", action="store_true", help="print what would be posted, post nothing")
    args = p.parse_args(argv)

    own = client is None
    client = client or httpx.Client(base_url=args.api, timeout=10.0)
    try:
        if args.sim_start:
            sim_start = _parse_time(args.sim_start)
        else:
            r = client.get(f"/report/{args.case}")
            if r.status_code == 404:
                print(f"error: the server does not know case {args.case}. Open the case first.", file=sys.stderr)
                return 2
            r.raise_for_status()
            seen = r.json()["case"].get("last_seen_time")
            if not seen:
                print("error: the case has no last_seen_time; pass --sim-start", file=sys.stderr)
                return 2
            sim_start = _parse_time(seen) + timedelta(minutes=args.minutes_after)

        schedule = schedule_for_clip(args.case, args.clip, sim_start)
        if not schedule:
            print(f"nothing to post: {args.clip} has no evidence in its sidecar", file=out)
            return 0
        begin = time.monotonic()
        for offset, ev in schedule:
            wait = offset / args.speed - (time.monotonic() - begin)
            if wait > 0:
                sleep(wait)
            if args.dry_run:
                print(f"[{offset:5.1f}s] would post {ev.kind} {ev.id}: {ev.summary}", file=out)
                continue
            r = client.post("/evidence", content=ev.model_dump_json(), headers={"Content-Type": "application/json"})
            if r.status_code == 404:
                print(f"error: the server does not know case {args.case}", file=sys.stderr)
                return 2
            r.raise_for_status()
            print(f"[{offset:5.1f}s] posted {ev.kind} {ev.id}: {ev.summary}", file=out)
        return 0
    except httpx.TransportError as e:
        print(f"error: could not reach the API at {args.api} ({e.__class__.__name__}). Is `make api` running?", file=sys.stderr)
        return 3
    finally:
        if own:
            client.close()


if __name__ == "__main__":
    raise SystemExit(main())
