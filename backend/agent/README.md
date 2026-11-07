# Tip parser (backend/agent)

Free-text tip → draft `Evidence` card (`confirmed=false`, the officer confirms it).

```python
from backend.agent.tip_parser import parse_tip
card = parse_tip("Bus driver saw her get off at the Emily Murphy Park stop around 2:35", case)
```

`case` is the `SubjectProfile` (dict or model). It is used to anchor times to the case and as a tie-breaker for places.

## How it works

1. **Extract** the facts as words: kind, source, place words, time, reliability.
   - `ANTHROPIC_API_KEY` set → Claude extracts (`OVERWATCH_LLM_MODEL`, default `claude-haiku-5-5`, 8 s timeout).
   - No key, or the call fails → keyword rules. The demo never depends on wifi.
2. **Resolve** the place words with `gazetteer.py`, which uses only `data/places/edmonton_places.geojson` and the street graph. It handles named places ("Hawrelak Park"), bus stops ("the Emily Murphy Park stop"), intersections ("124 St & Jasper", "109 and Jasper"), "the coffee shop on 109 St", and plain streets (wide radius). The LLM never produces coordinates, so it can't invent a location.
3. **Return** an `Evidence`. If no place matched, `location` is empty and the result carries a warning so the officer can pick it on the map.

Times: "2:35", "around two", "3 pm", "20 minutes ago". They are anchored to the case day and never before `last_seen_time` for sightings, clues or searches.

## Try it

```bash
py -m backend.agent.tip_cli "Saw her near 124 St and 107 Ave about 10 minutes ago"     # preview, no server
py -m backend.agent.tip_cli --case <case_id> --post "..."                               # send to /evidence
py -m backend.agent.tip_cli --case <case_id> --post                                     # interactive
py -m pytest backend/agent -q
```

## Not done (Rishaan's call)

- No API route yet. The dashboard command bar needs something like `POST /tip {case_id, text}` in `backend/api/` that calls `parse_tip` and broadcasts the card.
- The confirm flow (re-POST the same `id` with `confirmed=true`) is ask #3 in `frontend/ASKS.md`.
