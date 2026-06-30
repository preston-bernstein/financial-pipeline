NAS_HOST ?= YOUR_NAS_IP
NAS_USER ?= YOUR_NAS_USER
NAS_PATH ?= YOUR_NAS_PATH
DOCKER   ?= /usr/local/bin/docker
PLATFORM  = linux/amd64

SERVICES = plaid-tap betterment-adapter vanguard-adapter fidelity-adapter materializer llm-enricher mcp-server
DB_PKG   = packages/db

VOLUME_PREFIX ?= financial-pipeline

.PHONY: build push deploy typecheck seed-betterment seed-vanguard seed-fidelity

build:
	docker buildx build --platform $(PLATFORM) -t financial-pipeline/migrate -f $(DB_PKG)/Dockerfile . --load
	@for svc in $(SERVICES); do \
		docker buildx build --platform $(PLATFORM) -t financial-pipeline/$$svc -f services/$$svc/Dockerfile . --load; \
	done

push: build
	@echo "Transferring images to NAS..."
	docker save financial-pipeline/migrate $(addprefix financial-pipeline/,$(SERVICES)) \
		| ssh $(NAS_USER)@$(NAS_HOST) $(DOCKER) load

deploy: push
	ssh $(NAS_USER)@$(NAS_HOST) "cd $(NAS_PATH) && $(DOCKER) compose up -d"

typecheck:
	npx tsc --noEmit

# Session seeding — runs browser locally on Mac (needs display), then pushes to NAS volume.
# Requires: npx playwright install chromium (once)
seed-betterment:
	@echo "Opening Betterment in local browser — log in, session auto-saves when dashboard loads."
	SESSION_PATH=/tmp/betterment.storageState.json \
	  npx tsx services/betterment-adapter/src/index.ts --seed-session
	scp /tmp/betterment.storageState.json $(NAS_USER)@$(NAS_HOST):/tmp/
	ssh $(NAS_USER)@$(NAS_HOST) \
	  "$(DOCKER) run --rm \
	    -v $(VOLUME_PREFIX)_betterment_session:/session \
	    -v /tmp:/src alpine sh -c \
	    'cp /src/betterment.storageState.json /session/betterment.storageState.json'"
	@echo "Betterment session seeded."

seed-vanguard:
	@echo "Opening Vanguard in local browser — log in, session auto-saves when accounts page loads."
	SESSION_PATH=/tmp/vanguard.storageState.json \
	  npx tsx services/vanguard-adapter/src/index.ts --seed-session
	scp /tmp/vanguard.storageState.json $(NAS_USER)@$(NAS_HOST):/tmp/
	ssh $(NAS_USER)@$(NAS_HOST) \
	  "$(DOCKER) run --rm \
	    -v $(VOLUME_PREFIX)_vanguard_session:/session \
	    -v /tmp:/src alpine sh -c \
	    'cp /src/vanguard.storageState.json /session/vanguard.storageState.json'"
	@echo "Vanguard session seeded."

seed-fidelity:
	@echo "Opening Fidelity in local browser — log in, session auto-saves when portfolio page loads."
	SESSION_PATH=/tmp/fidelity.storageState.json \
	  npx tsx services/fidelity-adapter/src/index.ts --seed-session
	scp /tmp/fidelity.storageState.json $(NAS_USER)@$(NAS_HOST):/tmp/
	ssh $(NAS_USER)@$(NAS_HOST) \
	  "$(DOCKER) run --rm \
	    -v $(VOLUME_PREFIX)_fidelity_session:/session \
	    -v /tmp:/src alpine sh -c \
	    'cp /src/fidelity.storageState.json /session/fidelity.storageState.json'"
	@echo "Fidelity session seeded."
