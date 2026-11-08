# How we tested it

We built a benchmark that runs 400 simulated missing-person cases (two independent sets of 200) on the real Edmonton walking network (OpenStreetMap, downtown and the river valley) with 329 real cafés, parks and places of worship as familiar places. In each case a simulated person (80% with dementia) leaves a last-seen point and walks for 1 to 3 hours: slowly, tending to keep going straight, drawn toward familiar places, with pauses. Their true path is hidden from the search, and its walking behaviour is randomly varied, so the engine never gets the exact answer for free. About 60% of cases include a noisy witness sighting partway through.

We compare two ways of searching the same 100 m cells with the same detection luck: standard practice (check each familiar place, then an expanding ring from the latest known location) and searching where Overwatch's ghosts say the person most likely is. Each pass over the right cell finds the person 80% of the time, and a missed person can be found on a later pass.

**Result:** Overwatch found 60% of people within the first km² searched, vs 52% for standard search. The median case needed 0.65 km² vs 0.87 km², 25% less area (36% and 28% in the two sets measured separately).

**Value of a tip:** in the 240 cases with a witness sighting, entering it shrank the median area Overwatch needed by 62% (66% and 62% in the two sets separately).

This is a simulation, not data from real incidents. The code is in `benchmark/` and reruns with one command: `python benchmark/run_benchmark.py`.
