.PHONY: install dev api web types test watch

install:
	pip install -r requirements.txt

# Backend + frontend together (frontend starts once Denny has set it up)
dev:
	@$(MAKE) -j2 api web

api:
	uvicorn backend.api.main:app --reload --port 8000

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
