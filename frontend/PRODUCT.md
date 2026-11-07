# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

- **Backend:** Python 3.11, FastAPI, uvicorn, Pydantic v2, NumPy, OSMnx + NetworkX (street/trail graph), rasterio (elevation), Ultralytics YOLO + YOLO-World, OpenCLIP (optional), and an LLM API for parsing and narration.
- **Frontend:** React + TypeScript + Vite, deck.gl (GPU particles and trails), MapLibre GL (3D terrain and buildings), Tailwind + shadcn/ui, Framer Motion, Zustand.
- **Types:** Pydantic models → OpenAPI → openapi-typescript generates the TypeScript types, so frontend and backend can't drift.

## Users

- **Search officer / incident commander (primary, and the user this screen is built for):** runs a missing-person search from an operations-centre screen, under pressure. Needs one view of where the person probably is, what has been covered, and where to send the drone next, and makes every deployment decision.
- **Drone pilot (secondary, not designed for in this build):** needs a clear next flight path and instant alerts when something is spotted.
- **Volunteer reviewing footage (secondary, not designed for in this build):** wants to stop scrubbing hours of video, and instead ask something like "where did we see anything red?" and jump straight to it.

## Product Purpose

Overwatch is an AI search commander for missing-person searches. It watches drone footage, finds people and the clues they leave behind, keeps a live map of where the person most likely is, and tells the team where to fly next.

## Positioning

Overwatch doesn't only detect things in footage. It turns what the drone sees into a continuously updated estimate of where the person probably is, and into a specific recommendation for where to fly next.

## Operating Context

Used during missing-person searches by a team working from live drone footage, with the search manager coordinating, the pilot flying, and volunteers reviewing footage.

## Capabilities and Constraints

- Detects people and the clues they leave behind in live drone footage.
- Maintains a live map of where the person most likely is, and of what has been covered.
- Recommends the next flight path and alerts the pilot when something is spotted.
- Lets reviewers search footage in natural language and jump to the matching moment.

**Hard guardrails (confirmed; the UI and its copy must reflect them):**

- The AI never declares a person "found" and never controls a drone. Every deployment needs a human Approve. A possible match reads "Possible match, awaiting officer confirmation", never "Found!" on its own.
- No face recognition, ever. Perception detects people, clothing and gear only.
- Fictional case only ("Margaret, 79"). No real person's data.
- The screen is a view of the backend, not a source of truth: nothing appears on it that did not arrive from the stream.

## Brand Commitments

- **Name:** Overwatch.
- **Pitch:** "We're building an AI search commander for missing-person rescues. It watches live drone footage, spots people and the clues they leave behind, and keeps a live map of where they probably are. Then it tells the team exactly where to fly next. Basically giving search and rescue a brain."

## Evidence on Hand

None yet. The project has no footage, detection accuracy figures, search outcomes, partner agencies, or testimonials. Future work must not fabricate any of these.

## Product Principles

1. **One screen for the commander.** Where the person probably is, what has been covered, and where to fly next must be answerable from a single view.
2. **Recommend, don't just report.** Every output should move the team toward a next action.
3. **Likelihood, not certainty.** The map shows where the person probably is, and should never present an estimate as a known location.
4. **Each role gets only what it needs.** The commander, pilot, and footage reviewer have different jobs, so each gets the information that serves theirs.
5. **Findings lead back to the footage.** A reviewer should be able to go straight from a question to the moment in the video that answers it.

## Accessibility & Inclusion

Target WCAG 2.1 AA: AA contrast on every text and meaningful graphic (checked against the darkest surface), visible keyboard focus, and reduced-motion support. Primary device is a desktop or laptop running Chrome, shown on a projector. Mobile is out of scope for this build.
