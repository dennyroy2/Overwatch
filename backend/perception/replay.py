"""Step 33: the pure function teammates import. No network, reads only the committed sidecar."""
from __future__ import annotations

from datetime import datetime


def evidence_for_clip(case_id: str, clip_id: str, sim_start: datetime):
    """The throttled `Evidence` list for a clip, with `time` = sim_start + each frame's offset.
    Returns list[contracts.models.Evidence]. Implemented in step 33."""
    raise NotImplementedError("step 33")
