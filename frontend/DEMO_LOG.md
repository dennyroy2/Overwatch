# Demo log: what the demo does, and what running it many times showed

`npm run demo:log` plays the whole demo in real Chrome, several times, and writes everything it can observe to
`demo-logs/<stamp>/` (git-ignored: raw files are large). `npm run demo:report -- demo-logs/<stamp>` rebuilds the
comparison, `REPORT.md`, from the raw logs. This file is the kept summary.

## How it works

- Each run starts its **own** API (port 8010) and the whole script one Vite (port 5198). Your `make dev` servers on 8000
  and 5173 are never touched, and the script refuses to start if its ports are taken. A run never sees another run's case.
- A scripted **officer** drives the screen like a person: opens the demo case, waits for a drone recommendation, reads it
  for 1.5 s and approves it, lets the drone feed play, waits for the possible-match banner, clicks every evidence card (each
  shows what it removed, kept and brought in), confirms the subject, and reads the report and fetches the PDF.
- Two modes: **`builtin`** is the API's own tips (what `make dev` does); **`scripted`** is `make api-live` plus the scenario's
  tips (the screen's own demo script) plus the drone clue delivered by perception's `emit` (the real demo's shape).
- Logged as timestamped JSON lines: every stream message (ghost frames summarised: sim time, count, replaced slots, alive
  fraction, clusters and their stories; every other message in full), every HTTP call, every change to the screen's state,
  performance each second (fps, work per frame, dissolving ghosts, JS heap, page size), long frames and long tasks, the
  camera, the drone feed (header, video time, held), console output and page errors, failed requests, the officer's actions
  and how long each wait took, a screenshot at the possible match, at the report and at the end, and the API's own log.

## What the demo does, and when (the same every run)

| | builtin | scripted |
|---|---|---|
| socket open, first ghost frame | 0.2 s, 0.3 s | 0.2 s, 0.3 s |
| tips (in order) | 6.5 s family favourite place; 15.0 s bus driver (blue jacket); 25.5 s ground team searched; 35.9 s drone clue (blue puffer) | 9.1 s daughter's last-seen; 15.1 s coffee shop; 25.1 s ground team searched; 35.1 s bus driver (grey hooded jacket); 43.6 s drone clue (perception's, 90%) |
| first drone recommendation | 15.0 s (after the bus driver) | 35.3 s (after the bus driver) |
| officer approves, feed opens | 16.6 s | 36.9 s |
| possible-match banner, feed held on the clue | 36.0 s, video 4.0 s | 43.7 s, video 4.0 s |
| report opens | 45.5 s | 54.8 s |
| ghosts replaced in the biggest single frame | 3,750 of 5,000 | 3,750 of 5,000 |

Spread between runs: milestones within 0.2 s of each other (builtin) and 0.3 s (scripted); identical counts of cards,
requests and log messages; the engine produced the same 3,750-ghost replacement every time.

## What running it many times found

1. **A duplicate drone clue (fixed).** In scripted mode two drone clues arrived 9 s apart: perception's `emit` (43.5 s) and the
   screen's own demo script, whose last tip is also a drone clue (52 s). The engine counted the same find twice, and the
   event order differed between runs (the late clue raced the officer's clicks). The demo script now skips its drone clue when
   a drone clue is already on screen. Re-run: 1 drone clue, 5 cards, identical event order in all runs. Ask #4 still stands
   for the real demo: pick ONE source for the drone clue (the scenario's beat 5 and perception's evidence would also double count).
2. **The PDF export crashes (not ours: ask #24 for Varad).** `GET /report/{id}/pdf` answers **500** whenever the report has an
   **odd number of drone crops**, which is exactly the demo (one crop). In `backend/report/generate_report.py`,
   `detections_section` pads a half-empty row with `[[""]]`, a list holding a string, and reportlab cannot lay a string out as
   a flowable (`'str' object has no attribute 'wrapOn'`). Changing `[[""]]` to `[""]` fixes it: checked on a copy in memory,
   the committed code fails and the one-character change builds the PDF with the real crop. The browser shows it as a CORS
   error because the 500 response carries no CORS headers. (Builtin mode has no crop, so its PDF works.)
3. **A cold-cache hitch (not fixed; for steps 39 and 40).** In 1 of the first 4 scripted runs, as the camera first arrived at
   the drone clue the page had three long tasks (up to 133 ms) and the frame rate dipped to 36 for a second. The log shows
   MapLibre fetching and decoding new terrain tiles at that moment; later runs had them cached and did not hitch. A first run
   in a new room could show it. Pre-warming the demo area's terrain at case open is the likely fix.

## Not problems (checked and clean)

- **No console errors, page errors or failed API calls** in builtin mode in any run; in scripted mode only the PDF one above.
- **One stream socket per run, no reconnects, no toasts**; the sim clock never went backwards; no duplicate evidence ids.
- **Frame rate**: 5th percentile 60 fps in every run; lowest second 58 (36 once, the hitch above); slowest frame of work 3.4 ms.
- **Memory is flat**: the JS heap sits at about 240 to 290 MB from 10 s to the end of every run (the first batch's
  "start to end" number was garbage-collection noise, so the report now compares medians early and late).
- **Stream cadence**: a ghost frame every 209 ms median, 333 ms at worst.
- About 280 to 300 map-tile requests are **cancelled** per run by the map library while the camera moves: normal, and
  counted separately so they are not mistaken for failures.

## Limits of this log

- It watches the browser and the API's output. It cannot see the GPU, so a visual glitch that does not change state or timing
  would not show; the screenshots are the check for that.
- The officer is a script: it is fast and always clicks the same things. A person will be slower and less regular.
- Both modes use the same laptop, Chrome version and screen size (1440 x 900); a projector or another browser is step 41's job.
