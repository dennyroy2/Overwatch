"""Type a tip, see the evidence card, optionally send it to the server.

    py -m backend.agent.tip_cli --case case_abc "Bus driver saw her at the Emily Murphy Park stop at 2:35"
    py -m backend.agent.tip_cli --case case_abc --post "..."     # also POST it to /evidence
    py -m backend.agent.tip_cli --case case_abc --post           # interactive: one tip per line
    py -m backend.agent.tip_cli "..."                            # no server needed, preview only

Uses Claude if ANTHROPIC_API_KEY is set, otherwise keyword rules (add --no-llm to force rules).
Cards are sent unconfirmed (confirmed=false): the officer confirms them in the dashboard.
"""
from __future__ import annotations

import argparse
import json

import httpx

from backend.agent.tip_parser import parse_tip_verbose
from contracts.models import SubjectProfile


def load_case(api: str, case_id: str) -> SubjectProfile:
    r = httpx.get(f"{api}/report/{case_id}", timeout=5)
    r.raise_for_status()
    return SubjectProfile.model_validate(r.json()["case"])


def show(result) -> None:
    e = result.evidence
    loc = f"{e.location.lat:.5f}, {e.location.lon:.5f} (r={e.radius_m:.0f} m)" if e.location else "none"
    print(f"\n  {e.kind.upper()}  ·  {e.source}  ·  reliability {e.reliability:.2f}  ·  {result.method}")
    print(f"  {e.summary}")
    print(f"  when:  {e.time.isoformat(timespec='minutes')}")
    print(f"  where: {result.place_label or '-'}  [{loc}]")
    for w in result.warnings:
        print(f"  ! {w}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Parse a free-text tip into an Evidence card.")
    ap.add_argument("tip", nargs="*", help="tip text (leave out for interactive mode)")
    ap.add_argument("--case", help="case_id to attach the card to (needed for --post)")
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--post", action="store_true", help="send the card to POST /evidence")
    ap.add_argument("--no-llm", action="store_true", help="use keyword rules even if a key is set")
    ap.add_argument("--json", action="store_true", help="print the full card JSON")
    args = ap.parse_args()
    if args.post and not args.case:
        ap.error("--post needs --case")

    case = load_case(args.api, args.case) if args.case else None

    def handle(text: str) -> None:
        res = parse_tip_verbose(text, case, use_llm=False if args.no_llm else None)
        show(res)
        if args.json:
            print(json.dumps(res.evidence.model_dump(mode="json"), indent=2))
        if args.post:
            r = httpx.post(f"{args.api}/evidence", json=res.evidence.model_dump(mode="json"), timeout=5)
            r.raise_for_status()
            print(f"  -> sent to case {args.case} (id {res.evidence.id})")

    if args.tip:
        handle(" ".join(args.tip))
        return
    print("Type a tip and press Enter (empty line to quit).")
    while True:
        try:
            line = input("\ntip> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not line:
            break
        handle(line)


if __name__ == "__main__":
    main()
