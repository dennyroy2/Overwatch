"""Write contracts/openapi.json for frontend type generation (`make types`)."""
import json
from pathlib import Path

from backend.api.main import app

out = Path(__file__).resolve().parents[1] / "contracts" / "openapi.json"
out.write_text(json.dumps(app.openapi(), indent=2))
print(f"wrote {out}")
