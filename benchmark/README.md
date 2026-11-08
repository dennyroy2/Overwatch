# Benchmark: does Overwatch find people with less searching?

Simulated missing-person cases on the real Edmonton street network, searched two ways:
**standard practice** vs **where Overwatch's ghosts point**. Simulation only, not real incidents.

## Result (GhostEngine, 5,000 ghosts, 2 independent sets of 200 cases)

| | Overwatch | Standard search |
|---|---|---|
| Median area searched before finding the person | **0.65 km²** | 0.87 km² |
| Found within the first km² searched | **60%** | 52% |

- **25% less area** for the median case over all 400 cases (36% and 28% when each set is measured separately).
- **Value of a tip:** in the 240 cases with a witness sighting, entering it shrank the median area Overwatch needed by **62%**.

Slides and full numbers: `results/final/` (`pitch_chart.png`, `pitch_tip_chart.png`, `how_we_tested.md`, `summary.json`).

## Method

- **Map:** OpenStreetMap walking network for downtown Edmonton and the North Saskatchewan River valley (`data/graphs/edmonton_demo.graphml`), with 329 real cafés, parks and places of worship (`data/places/`) used as familiar places.
- **Cases** (`cases.py`): a profile (80% dementia), a last-seen point, 1 to 3 familiar places near home, and a report delay of 1 to 3 hours. About 60% of cases get a witness sighting with ~80 m of position noise.
- **Hidden true path** (`walker.py`): slow walking, tends to keep going straight, pulled toward familiar places, rarely backtracks, pauses. Walking parameters are randomly perturbed per case, so the engine never gets the exact behaviour for free.
- **Overwatch:** the evidence is fed to the engine in time order through `backend/engine/interface.py` (reset → step → apply → frame), exactly like a live search. Cells (100 m) are searched in order of ghost weight.
- **Standard search:** quick checks of each familiar place, then an expanding ring from the latest known location (the sighting if there is one). This is what a search manager does without Overwatch.
- **Fairness:** same cases, same cells and the same detection luck for both. Each pass over the right cell finds the person 80% of the time, and a missed person can be found on a later pass. Unfound cases count as "never" in every median.
- **Value of a tip:** each case with a sighting is re-run through the engine without it.

## Run it

```
python benchmark/run_benchmark.py --cases 200 --ghosts 5000 --seed 1 --out benchmark/results/seed1
python benchmark/run_benchmark.py --cases 200 --ghosts 5000 --seed 2 --out benchmark/results/seed2
python benchmark/pitch_assets.py --combine benchmark/results/seed1 benchmark/results/seed2
```

About 4.5 minutes per 200 cases on a laptop. `--no-tip-test` skips the tip comparison, and `--engine local` uses a simple stand-in engine (testing only). If a run used a placeholder engine, the slides get a red "NOT FOR PITCH" chip.

## Files

| File | Job |
|---|---|
| `run_benchmark.py` | Runs the cases and both strategies, writes `results.csv`, `summary.json`, `chart.png` |
| `cases.py` | Builds each fictional case with contract `Evidence` objects |
| `walker.py` | How the simulated person moves on the street graph |
| `engine_adapter.py` | The only place that talks to the engine |
| `graph.py` | Loads the street graph and places |
| `pitch_assets.py` | Pitch slides (IBM Plex, app design tokens) and the "How we tested it" text |

## Limits

The person stops moving once the search starts, search cost is measured in area (converted to team-hours at a stated 0.5 km²/h), and terrain doesn't change detection. Walking behaviour is our model of dementia wandering, not fitted to real Alberta incident data. These are the next things to improve.
