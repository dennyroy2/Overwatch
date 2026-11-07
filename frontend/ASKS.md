# Asks: things Denny needs from teammates (do not build them ourselves)

Build against a local adapter or fallback in `frontend/` or `backend/perception/`
until the owner ships it. Mirror each open ask in the relevant PR description.

| # | Who | What | Why the frontend needs it | Status |
|---|---|---|---|---|
| 1 | Rishaan | Merge `GhostFrame.respawned` and the stable-slot guarantee into the fake stream and the engine; tell Denny so he can run `make types` | Smooth motion, trails, dissolve, kill/keep (steps 14, 16, 35, 36) | Open |
| 2 | Rishaan | Edit fields on `Decision` (e.g. `edited_asset`, `edited_area`) | Approve / **Edit** / Reject (step 22) | Open |
| 3 | Rishaan | The officer's one-tap confirm: is it re-posting the same `id` to `POST /evidence` with `confirmed: true`? | "Officer confirms with one tap" (Section 3; step 19) | Open |
| 4 | Rishaan / Akshat | Who calls `backend.perception.replay.evidence_for_clip(...)` on drone approval or at the scripted time | Firing the drone clue in the demo (step 33) | Open |
| 5 | Rishaan | Optionally a separate install target for `backend/perception/requirements.txt` | Keeps torch optional for everyone else | Open |
| 6 | Rishaan | Agree the demo ghost count after step 18's measurements | 60 fps on the demo laptop | Open |
| 7 | Akshat | Demo clip + flight-path file on Drive, in the agreed format | Geolocation and PiP (steps 25, 31, 34) | Open |
| 8 | Akshat | Demo timeline beat times | Choreographing camera moves to evidence (step 39) | Open |
| 9 | Varad | Commit the `frontend/src/panels/ReportView.tsx` stub with props `{ caseId: string; onClose: () => void }` | The report slot (steps 7, 24) | Open |
| 10 | Rishaan | `POST /decision` should also broadcast the updated `TaskingRequest` (new `status`) as a `tasking` message, not just a `log` entry | Step 22 says the card state must come from the stream. Right now only a log line is sent, so the card cannot reliably show approved/rejected. Until then I derive it from the `log` entry (`action: "decision"`, detail `"<asset>: approved"`), which is fragile | Open |
| 11 | Rishaan | `POST /evidence` should upsert by `id` in `hub.evidence` (currently appends) | Agent re-sends structured notes with the same `id`; `/report` would otherwise return duplicates. Frontend dedupes by `id` on hydrate as a fallback | Open |
