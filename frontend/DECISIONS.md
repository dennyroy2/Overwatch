# Decisions log (frontend + perception)

Format: date, decision, the alternative rejected, why.

## Contract cheat sheet (read from `main` @ a9e9db3, 2026-11-06)

### Endpoints
| Call | Body -> Response | Notes |
|---|---|---|
| `POST /case` | `SubjectProfile` -> `SubjectProfile` | Fills `last_seen` with 124 St & Jasper if missing. `case_id` is generated client-side by default; read it from the response. |
| `GET /report/{case_id}` | -> `Report {case, evidence[], requests[], log[]}` | Hydration source. **No ghosts, no clusters.** 404 if unknown. |
| `WS /stream/{case_id}` | server -> client only | Unknown case -> close code **4404**. First socket starts the fake case; last socket leaving cancels it; next connect restarts from zero. |
| `POST /evidence` | `Evidence` -> `Evidence` | Broadcasts an `evidence` msg and a `log` msg. 404 if unknown case. |
| `POST /decision` | `Decision` -> `{ok, status}` | Mutates request status, broadcasts **only a `log` msg** (see ask #10). |
| `GET /health` | -> `{ok, cases}` | |

### Stream envelope: `{type, data}`
| `type` | `data` | Fields the UI renders |
|---|---|---|
| `ghosts` | `GhostFrame` | `t` (sim clock), `positions[[lon,lat,weight]]` (weight 0..1, normalised to max), `alive_fraction`, `clusters[]` |
| `evidence` | `Evidence` | `id`, `kind`, `source`, `summary`, `time`, `location?`, `area?`, `radius_m?`, `reliability`, `confirmed`, `raw_text?`, `media_url?`, `detection_prob?` |
| `tasking` | `TaskingRequest` | `asset`, `target_area[]`, `route[]`, `expected_gain`, `duration_min`, `reasons[]`, `evidence_ids[]`, `alternatives[]`, `constraints_ok{}`, `status` |
| `log` | `LogEntry` | `time`, `actor`, `action`, `detail` |
| `found` | `FoundEvent` | `location`, `evidence_id?`, `note` (default "Possible match located. Awaiting officer confirmation.") |

### Optional fields (must null-check)
`SubjectProfile.last_seen`, `last_seen_time`; `Evidence.location`, `area`, `radius_m`, `raw_text`, `media_url`, `detection_prob`; `Cluster.story`; `FoundEvent.evidence_id`; `Decision.reason`. `GhostFrame.respawned` is **not in the contract yet** (ask #1): treat missing as "every slot respawned on the frame after an `evidence` message".

### Coordinates
Contract `GeoPoint` = `{lat, lon}`. Ghost `positions` = `[lon, lat, weight]`. deck.gl = `[lon, lat]`. MapLibre camera = `{lng, lat}`. All conversions go through `src/lib/geo.ts`.

### Things I confirmed by reading the code
- **Where `Cluster.evidence_ids` comes from:** produced by the engine in `_clusters()`. In the stub it is *every* evidence id so far, identical on all clusters (not causal). The real engine is meant to make it "why is this hot?". Cluster ids are `cl_{rank}`, so identity is by rank, not stable: `selectedClusterId` can jump to a different cluster if ranks swap.
- **Why the evidence store must upsert by `id`:** a typed tip arrives first as a raw `note`, then Rishaan's agent re-sends the structured version with the **same `id`**; appending would show two cards. Also `POST /evidence` currently *appends* to `hub.evidence`, so `/report` could contain two entries with one id after a re-post (ask #11). Hydration must therefore dedupe by `id` too (last wins).
- **Late joiners miss history:** the stream has no replay. Hydrate from `/report`, then apply live messages. Request `status` on hydrate comes from `/report`.
- **Fake beats** (sim seconds at the stream's own clock): 6s favourite_place, 14s sighting (+tasking), 24s searched_area, 34s drone_ai clue (+tasking). Beat evidence has `confirmed: true`, `time` = sim time. Ghost knobs: `OVERWATCH_GHOSTS` (5000), `OVERWATCH_FPS` (5), `OVERWATCH_SIM_SPEED` (0.5).
- **Resampling reshuffles indices** in the stub (`_resample` does `pos[idx]`), which is why the `respawned` guarantee is needed.

### Agreements (settled)
- **Tip flow:** frontend `POST /evidence` with `kind:"note"`, `source:"officer"`, `raw_text` verbatim, no location, `time`=now -> note card back through stream -> agent re-sends structured version with the same `id` -> store upserts. Until the agent exists the note comes back unchanged.
- **Ghost identity:** ghost count fixed; `positions[i]` is always the same slot; a dead ghost's slot is reused by a new ghost spawned from a survivor; `GhostFrame.respawned: list[int]` lists those slots; a fixed subset is sent if the backend runs more than it sends. Until it merges, fall back to "all slots respawned after an evidence message".
- **Perception** posts fully structured `clue`/`sighting` evidence itself (no parsing).

---

## Log

| Date | Decision | Rejected alternative | Why |
|---|---|---|---|
| 2026-11-06 | Ownership guard counts committed + staged + unstaged changes; untracked files only warn | Failing on any untracked file | Local untracked root files (roadmap, PRODUCT.md) would make the guard fail forever; untracked files can't reach a PR until added |
| 2026-11-06 | Guard has a `CHECK_OWNERSHIP_FILES` test hook | Temporarily editing `contracts/` to test the guard | Hard rule 1: never touch files outside our folders, even briefly |
| 2026-11-06 | `StreamMessage` alias is the union of the five `*Msg` schemas, defined in `types/index.ts` | Importing a generated `StreamMessage` | The contract's `StreamMessage` is an inline union in OpenAPI, so no named schema is generated; the union of the five `*Msg` types narrows on `type` exactly the same |
| 2026-11-06 | `narrowing.check.ts` holds an exhaustive `switch` with a `never` check | Trusting the alias by eye | If Rishaan adds a message type and I regenerate, `npm run typecheck` fails until I handle it |
| 2026-11-06 | Treat generated fields that have server defaults (`clusters?`, `confirmed?`, `reliability?`, `status?`, `mobility?`...) as possibly undefined in UI code | Assuming they are always present | openapi-typescript marks defaulted fields optional; the server does send them, but the types don't promise it |

