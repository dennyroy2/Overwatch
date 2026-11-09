# Handover for the README and the video (frontend and perception)

From Denny, step 42. Everything here is measured and written down in `frontend/DECISIONS.md`; copy freely, but keep the
caveats in the last section.

## Pictures (this folder)

| File | What it shows |
|---|---|
| `01-new-case.jpg` | The empty screen: Alberta, the New case sheet |
| `02-case-opens.jpg` | The case opens: fly-in to the last-seen point, the ghosts spreading |
| `03-evidence-arrives.jpg` | Evidence cards on the left, pins on the map, the probability rings |
| `04-drone-request.jpg` | A drone tasking request with its reasons and the Approve, Edit, Reject choice |
| `05-drone-approved.jpg` | Approved: the route draws, the drone feed opens with detections |
| `06-possible-match.jpg` | The system reports a possible match and waits for an officer |
| `07-why-mode.jpg` | "Why?" mode: the map dims, cyan arcs lead to the evidence behind a cluster, a typed story |
| `08-replay.jpg` | The time bar scrubbed back: the screen shows the moment as it was |
| `09-close-search.jpg` | Only an officer can say the subject was located |
| `10-report.jpg` | The search report |
| `possible-match.gif` | 7.5 seconds around the possible match (800 px wide, 4 MB) |

## Lines for the README: the screen

Overwatch's screen is a React 19 + TypeScript app (Vite) with MapLibre GL for the 3D map (terrain, buildings) and
deck.gl for 5,000 "ghosts" (possible positions of the missing person) drawn as a glow layer. State is Zustand. It is a view
of the backend's stream, not a source: it never invents evidence, requests or decisions; it only POSTs what an
officer does and shows what comes back over one WebSocket.

What it does: the ghosts redistribute when evidence arrives (ghosts replaced by a clue fade out where they stood);
selecting an evidence card shows which ghosts it removed, kept and brought in; "Why?" mode explains a cluster in words
with arcs to the evidence behind it; the time bar records the whole search and can be scrubbed and replayed (requests,
approvals, routes, the possible-match banner and the drone feed all follow the replay clock); a drone request is approved
by an officer, then the route draws and the drone feed opens; the report opens when the search is closed.

Performance (real Chrome, 1920x1080, 5,000 ghosts with trails, density layer, drone feed and Why mode on, 5 minutes):
median 120 fps with the headless frame cap lifted (minimum 92), no long tasks, 0.1 to 0.3 ms of script per frame,
memory about 230 to 250 MB. Not measured on the demo laptop.

Resilience: three identical demo runs in both modes, 0 console errors; the API killed mid-demo shows "Reconnecting",
then a toast, and the case reopens from the start with no page reload.

## Lines for the README: perception (`backend/perception/`)

Offline, on the demo's drone clip: frames are sampled at 2 per second; a pretrained **YOLO11m** (Ultralytics, COCO,
people only) runs on 320 px tiles enlarged to 1024 (**sliced inference, SAHI**) plus one whole-frame pass; each person
box is scored against the missing person's clothing (the profile's words, for example "grey hooded jacket") by
**YOLO-World** (open vocabulary) on the person's crop and an HSV colour check that works for greys and darks; a flat-ground
pinhole model with the drone's pitch, heading, altitude and field of view turns a box into a ground position and states
its own error (about 75 m for this clip, because the flight file's position is approximate); a throttle keeps one
reading per person and writes a JSON sidecar and crop images. The screen plays the sidecar over the video. **No face
recognition** and no tracking of anyone; the demo subject is fictional. The AI explains, the maths decides, a human
approves: perception only feeds the drone panel, and the case's drone clue comes from the scenario.

Numbers (23 labelled frames of the demo pack, 90 labelled people, median box 21 x 36 px, matched at IoU 0.3):
whole-frame detection at the clip's size finds 3 of 90 people (3%); sliced inference finds **55 of 90 (61%) with 55 of 57
boxes real (96% precision)**, and the lying subject in **21 of 21** frames where she is visible. On the clip's 29 sampled
frames it draws 45 boxes where whole-frame detection drew 4. The clue score separates the subject (0.68 to 1.00) from every
bystander (highest 0.33, including a light-grey hoodie lookalike) at a 0.45 threshold. The 33 people still missed are tiny
(median short side 12 px).

Datasets: the 23 labelled frames and the demo footage come from the **SARD** (Search and Rescue Image Dataset for Person
Detection) material the team downloaded; credit its authors and check the licence terms before publishing. **WiSARD**
(Wilderness Search and Rescue Dataset) was not used. No model was trained or fine-tuned by us: detection uses
Ultralytics' pretrained YOLO11m, clothing uses pretrained YOLO-World.

## Caveats to keep (please do not drop these)

- The recall numbers are on the demo's own frames, not a held-out set. The held-out test and the optional fine-tune
  (step 29) were **not done**, so do not claim generalisation.
- The system reports a **possible match** only; an officer confirms. It never declares someone found.
- Geolocation is a flat-ground estimate with a stated error of about 75 m, not a survey.
- The footage MP4 is not in the repository (it is large); the detections JSON and crops are.

## Backup video

A silent screen recording of one full built-in demo run (58 s, 1920x1080, H.264, 21 MB): `overwatch-demo-backup.mp4`.
It is not committed (too large for the repository); ask Denny for the file. It is meant as a fallback only. The real recording, with narration, is Akshat's.
