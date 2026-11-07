# Overwatch

Search intelligence for missing-person cases. Overwatch simulates thousands of "ghost" versions of a missing person moving through the real city, lets every piece of evidence eliminate the ghosts that can't be real, and asks the officer in charge to send drones or teams where the evidence points.

> Built at natHacks 2026. This README will grow as the project does.

## Quick start
```bash
python -m venv .venv && source .venv/bin/activate
make install
make api          # API on http://localhost:8000  (docs at /docs)
make watch        # in a second terminal: prints the live stream
make test
```

## How the pieces connect
```
LLM agent ─────┐
Perception ────┼─► POST /evidence ─► Ghost engine ─► WS /stream/{case_id} ─► Frontend
Scenario ──────┘                          └─► tasking requests ─► POST /decision
```
- **Contracts:** `contracts/models.py` is the single source of truth for every object. Do not change it without telling the team.
- **Frontend types:** `make types` regenerates `frontend/src/types/api.ts` from the contracts.
- **Engine interface:** `backend/engine/interface.py` (`SearchEngine`). Today `StubEngine` (random walk) drives the stream; the real particle filter replaces it with no other code changes.

## API
| Method | Path | Body / notes |
| --- | --- | --- |
| POST | `/case` | `SubjectProfile` → returns it with `case_id` |
| POST | `/evidence` | `Evidence` (must reference an existing `case_id`) |
| POST | `/decision` | `Decision` on a tasking request |
| GET | `/report/{case_id}` | Full case record |
| WS | `/stream/{case_id}` | Messages: `{"type": "ghosts" \| "evidence" \| "tasking" \| "log" \| "found", "data": ...}` |

`ghosts.data.positions` is `[[lon, lat, weight], ...]`, pushed ~5×/s.

Stream settings (env vars): `OVERWATCH_GHOSTS` (default 5000), `OVERWATCH_FPS` (5), `OVERWATCH_SIM_SPEED` (sim minutes per tick, 0.5), `OVERWATCH_FAKE_BEATS` (1; set to 0, or run `make api-live`, to turn off the built-in fake evidence when the scenario or real officers post evidence). Any posted sighting or clue triggers new tasking requests.

## Folder ownership
| Folder | Owner |
| --- | --- |
| `contracts/`, `backend/engine/`, `backend/agent/`, `backend/api/` | Rishaan |
| `frontend/`, `backend/perception/` | Denny |
| `data/`, `scenario/` | Akshat |
| `benchmark/`, `backend/report/`, `frontend/src/panels/` | Varad |

## Map data
`backend/engine/graph.py` loads `data/graphs/<name>.graphml`. If missing, it downloads the Edmonton demo area (downtown + river valley) walk network from OpenStreetMap via OSMnx and caches it.
