"""The package must import without pulling in torch, ultralytics, sahi or cv2 (they load inside functions)."""
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
MODULES = ["frames", "detect", "clothing", "geolocate", "sidecar", "emit", "replay", "precompute", "paths"]
HEAVY = ["torch", "ultralytics", "sahi", "cv2"]


def test_importing_every_module_loads_no_heavy_dependency():
    code = (
        "import sys\n"
        "import backend.perception\n"
        + "".join(f"import backend.perception.{m}\n" for m in MODULES)
        + f"heavy = [m for m in {HEAVY!r} if m in sys.modules]\n"
        "print(','.join(heavy))\n"
    )
    out = subprocess.run([sys.executable, "-c", code], cwd=REPO, capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "", f"imported at module load: {out.stdout.strip()}"
