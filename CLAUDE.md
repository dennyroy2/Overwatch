# Overwatch: rules for AI coding assistants

Search intelligence for missing-person cases. FastAPI backend streams ghost frames,
evidence and tasking requests over one WebSocket to a React/MapLibre/deck.gl screen.

## Folder ownership (only edit your own; ask the owner otherwise)
| Folder | Owner |
|---|---|
| `contracts/`, `backend/engine/`, `backend/api/`, `backend/agent/` | Rishaan (Akshat co-owns the tip parser in `backend/agent/`) |
| `frontend/` (except `frontend/src/panels/`), `backend/perception/` | Denny |
| `data/`, `scenario/` | Akshat |
| `benchmark/`, `backend/report/`, `frontend/src/panels/` | Varad |

Need a change in someone else's folder? Write it as a patch file in your own folder
and say so in the PR (see `backend/agent/server_hook.patch`).

## Hard rules
- **Coordinates are `[lon, lat]`** in every array (contracts, deck.gl, GeoJSON).
  Only `GeoPoint(lat=..., lon=...)` and MapLibre camera calls use named fields.
- **Contracts are the source of truth.** After any change to `contracts/models.py`:
  run `python -m scripts.export_openapi`, commit `contracts/openapi.json`, and tell
  Denny to run `make types`. Never hand-write TypeScript types for API objects.
- **The backend is the source of truth.** The frontend shows what arrives on the
  stream; it never adds evidence, requests or decisions locally.
- **The engine is `GhostEngine` in `backend/engine/ghost_engine.py`, exposed through
  `backend/engine/interface.py`.** The server (`make_engine()` in
  `backend/api/fake_stream.py`) and the benchmark both find it there. Keep the
  `SearchEngine` method signatures unchanged.
- **Ghost index is stable between frames.** `positions[i]` is the same ghost every
  frame; reused slots are listed in `GhostFrame.respawned`.
- **The AI explains, the maths decides, a human approves.** LLM calls live only in
  `backend/agent/`. Every LLM call has a non-LLM fallback and a timeout. The LLM
  never produces coordinates (places are resolved from `data/` only).
- **Never claim "found".** The engine can report a *possible match*; only an
  officer confirms (`POST /case/{id}/close` logs `found_confirmed`).
- No face recognition, no tracking of suspects, no real person's case data.
- Secrets live in `.env` (never committed). `ANTHROPIC_API_KEY` is optional.

## Engine changes
- Run `python -m pytest -q tests/test_engine.py` (includes a calibration guard rail).
- Re-run `python benchmark/run_benchmark.py --ghosts 5000` and report both strategies'
  numbers before claiming an improvement. Never tune against a single case set.

## Before committing
- `make test` passes (`python -m pytest -q`).
- One feature per branch (`<name>/<feature>`), PR into `main`, `main` always runs.
- Commit messages say what changed and why, in plain words.

## Useful commands
- `make api` server with fake evidence beats; `make api-live` without (for `scenario/`)
- `make watch` print the live stream; `make types` regenerate frontend types
- `OVERWATCH_ENGINE=stub` falls back to the old random-walk engine

## Domain numbers (urban dementia, Koester ISRID, Lost Person Behavior)
Distance from last-seen point: 25% within 0.3 km, 50% within 1.1 km, 75% within 3.2 km,
95% within 12.6 km. About half are found within ~30 m of a road or path.
