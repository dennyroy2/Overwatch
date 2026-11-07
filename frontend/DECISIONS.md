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
| 2026-11-06 | Visual direction taken from the brief (dark, map-first, amber accent, cyan for AI), not from Impeccable's random direction roll | Running `concept-seed` and picking from a dealt hand | Impeccable's own rule: a user- or brief-pinned direction beats the roll. The roadmap pins the world; the skill still shaped type, density and states (Operate mode) |
| 2026-11-06 | IBM Plex Sans + IBM Plex Mono, self-hosted via `@fontsource` | Geist (shadcn default), Inter | Roadmap suggests Plex; institutional and has clean tabular numerals. Impeccable lists Plex among overused faces, but the brief pins it, so the exception is deliberate |
| 2026-11-06 | Tokens live in `src/styles/tokens.css` only; Tailwind theme and shadcn variables bridge to them in `index.css`; `src/lib/tokens.ts` mirrors hex values for deck.gl and contrast checks | Editing shadcn's generated oklch variables directly | One place to change a colour. The JS mirror is the one duplication, needed because deck.gl takes JS colours; flagged in both files |
| 2026-11-06 | Amber (`#ffb224`) = human decisions, selection, probability. Cyan (`#5cd3e8`) = only AI-authored text/marks. Ghost colour never cyan | Second accent for status | Brief: one accent plus cyan for AI. Status colours (danger/success) are for state only |
| 2026-11-06 | 13px default UI size, 4/6/2px radii, shadow = offset + blur | Rounded 8-12px cards and 14-16px body | Dense, institutional look; Impeccable craft floor bans zero-offset halos |
| 2026-11-06 | Kept the subtle grid (`.bg-grid`), for empty canvas regions only | Removing it after the detector flagged "decorative grid" as advisory | The brief explicitly asks for a subtle grid; it is an advisory, not a ban |
| 2026-11-06 | `PRODUCT.md` moved from repo root into `frontend/`; Impeccable's project root is `frontend/` so `.impeccable/` and `DESIGN.md` land there too | Leaving it at the repo root | Hard rule 1: the root isn't ours |
| 2026-11-06 | Colour contrast measured (WCAG) on `#06080b`: text 17.1/9.3/6.3, amber 11.1, cyan 11.4, danger 6.9, success 10.5 | Trusting colours by eye | Roadmap done-when requires amber and cyan to pass on the darkest surface; `/styleguide` recomputes these live |
| 2026-11-06 | Rails float over the map (`absolute`, outside layout flow) and collapse to a 3rem icon strip with a pending-count badge and amber border/pulse when items wait | Hiding the rail fully | A closed rail must never hide a pending request (human-approval guardrail). Map never resizes, so no MapLibre re-layout |
| 2026-11-06 | Report slot is a placeholder in `components/shell/Slots.tsx`, not in `src/panels/` | Creating a stub `panels/ReportView.tsx` | Hard rule 1: panels/ is Varad's. Real import wired in step 24 once his file is on main (ask #9) |
| 2026-11-06 | Rail open/closed lives in local `useState` for now | Zustand `ui` slice now | **Superseded 2026-11-07:** moved to `store.ui.panels` in step 8 |
| 2026-11-06 | Dev-only `/?review=pip,report,collapsed,pending` previews hidden states | Temporary code edits to screenshot states | Lets states be reviewed without editing code; compiled out of production by `import.meta.env.DEV` |
| 2026-11-07 | Store slices: `caseProfile`, `connection`, `evidence`/`requests` (`{byId, order}`, upsert only), `log` (deduped by time+actor+action+detail), `clusters`, `ghostMeta`, `found`, `ui`. Ghost positions are NOT in the store | Putting ghosts in Zustand | 5k-10k points at 5 fps through React loses 60 fps; typed arrays in `stream/ghostBuffer.ts` instead |
| 2026-11-07 | Two swapping preallocated `Float32Array`s (`[lon, lat, weight]`) with capacity growth | One buffer, copy previous each frame | Step 14 interpolates previous -> current; swapping avoids a copy and any per-frame allocation |
| 2026-11-07 | Stream client is a module-level singleton (`stream/client.ts`); HMR dispose closes the socket | Socket in a `useEffect` | StrictMode mounts twice and the server restarts the fake case on every reconnect. Verified: 1 server-side `connection open` for a StrictMode page load |
| 2026-11-07 | Every (re)connect does GET /report first, then opens the WS | Open WS first, hydrate after | Server starts the fake case on the first socket, so hydrating first can't miss a beat; upsert-by-id makes ordering safe anyway |
| 2026-11-07 | If the server loses the case (report 404 or WS 4404) AND we created it (`openCase`), re-POST the stored profile (same `case_id`) and clear the screen; if we only attached (`attachCase`), show "Case not found" and stop | Always showing "Case not found", or reconnecting forever | The API keeps cases in memory, so a restart wipes them; without recreating, "restart then recovers" is impossible. Cleared first because the restarted fake case replays from zero with new ids, and the screen must match the backend. Verified end to end |
| 2026-11-07 | While reconnecting, the last known evidence and requests stay visible | Blanking the screen on disconnect | The officer keeps context; state resets only when the server confirms it lost the case |
| 2026-11-07 | Backoff 0.5s doubling to 5s, no jitter | Jitter | One client, no thundering herd |
| 2026-11-07 | `readRespawned()` reads `respawned` defensively, and a missing field means "all slots respawned" on the first frame after an `evidence` message | Hand-writing a `respawned` type | Hard rule 5. After ask #1 merges and `make types` runs, delete the helper and read the typed field |
| 2026-11-07 | `WithId<T>` + `hasId()` narrow the optional `id` at the store boundary; messages without an id are dropped | `as` casts | Generated types mark `id` optional because the server fills it by default |
| 2026-11-07 | Dev URL switches `?autostart=demo|unknown` and `?review=collapsed,pip,report` run once at module load | Running them in a component effect | An effect would run twice under StrictMode; module load can't |
| 2026-11-07 | Added Vitest (`npm test`) with tests for upsert and the respawn fallback | Waiting for step 9's geo test | The two behaviours the roadmap calls most painful to reverse deserve tests now; step 9 reuses the runner |
| 2026-11-07 | `lib/geo.ts` is the only coordinate converter: `toLonLat/fromLonLat` (deck.gl), `toLngLat/fromLngLat` (MapLibre), direct deck<->MapLibre, `metresToDegrees`, `degreesToMetres`, `offsetPoint`, `distanceMetres`, `isInEdmonton` | Inline `[p.lon, p.lat]` where needed | Hard rule 7. Mixing orders puts ghosts off Somalia; one file means one place to be wrong |
| 2026-11-07 | `npm run check:geo` greps for hand-built pairs (`.lon`, `.lng`, `lat:`, `lon:`, `lng:`) outside `geo.ts`, generated types and tests; verified it fails on a planted violation | Relying on code review | The roadmap's "quick grep" done-when becomes a repeatable check; run it in every merge checklist |
| 2026-11-07 | Metres per degree of latitude is 111,320, same as `backend/engine/interface.py` | A more precise geodesic formula | Matching the backend keeps frontend shapes and engine distances consistent; error is negligible at city scale |
| 2026-11-07 | `ghostBuffer.ts` copies the wire format `[lon, lat, weight]` by index (`p[0]`, `p[1]`) without calling geo helpers | Routing 5k points/frame through a converter | The wire format is already deck.gl order, so no conversion happens; a per-point function call would be pure cost in the hot path. Documented in that file's header |

