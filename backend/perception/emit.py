"""Step 33: `python -m backend.perception.emit --case <id> --clip <id>` posts the clip's evidence to the API."""
from __future__ import annotations

import argparse


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="backend.perception.emit", description=__doc__)
    p.add_argument("--case", required=True, help="case id to post evidence to")
    p.add_argument("--clip", required=True, help="clip id (the sidecar's name without .detections.json)")
    p.add_argument("--api", default="http://localhost:8000", help="API base URL")
    p.parse_args(argv)
    raise NotImplementedError("step 33")


if __name__ == "__main__":
    raise SystemExit(main())
