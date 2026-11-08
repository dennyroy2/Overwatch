.PHONY: install dev api api-live demo web types test watch

install:
	pip install -r requirements.txt

# Backend + frontend together (frontend starts once Denny has set it up)
dev:
	@$(MAKE) -j2 api web

api:
	uvicorn backend.api.main:app --reload --reload-dir backend/api --reload-dir backend/engine --reload-dir backend/agent --reload-dir backend/report --reload-dir contracts --port 8000

# Demo / judging: no auto-reload at all, so nothing restarts the server mid-demo
demo:
	OVERWATCH_FAKE_BEATS=0 uvicorn backend.api.main:app --port 8000

# Server without the built-in fake evidence (use with the scripted scenario)
api-live:
	OVERWATCH_FAKE_BEATS=0 uvicorn backend.api.main:app --reload --reload-dir backend/api --reload-dir backend/engine --reload-dir backend/agent --reload-dir backend/report --reload-dir contracts --port 8000

web:
	@if [ -f frontend/package.json ]; then cd frontend && npm run dev; else echo "frontend/ not set up yet"; fi

# Regenerate frontend TypeScript types from the shared contracts
types:
	python -m scripts.export_openapi
	npx --yes openapi-typescript contracts/openapi.json -o frontend/src/types/api.ts

# Print what arrives on the live stream (server must be running)
watch:
	python -m scripts.watch_stream

test:
	python -m pytest -q
