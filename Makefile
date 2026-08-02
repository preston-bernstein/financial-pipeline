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
	@echo "Syncing docker-compose.yml and .env.example to NAS..."
	rsync -az docker-compose.yml .env.example $(NAS_USER)@$(NAS_HOST):$(NAS_PATH)/
	@echo "Transferring images to NAS..."
	docker save financial-pipeline/migrate $(addprefix financial-pipeline/,$(SERVICES)) \
		| ssh $(NAS_USER)@$(NAS_HOST) $(DOCKER) load

deploy: push
	ssh $(NAS_USER)@$(NAS_HOST) "cd $(NAS_PATH) && $(DOCKER) compose up -d"

typecheck:
	npx tsc --noEmit

# Session seeding — runs browser locally on Mac (needs display), then streams the
# storageState into the NAS volume over ssh stdin.
# Requires: npx playwright install chromium (once)
# The session JSON holds live brokerage cookies: it lives only in a chmod-600
# mktemp file locally (deleted after transfer) and never touches NAS /tmp.
define seed_session
	@TMP=$$(mktemp) && chmod 600 $$TMP && \
	( SESSION_PATH=$$TMP npx tsx services/$(1)-adapter/src/index.ts --seed-session && \
	  cat $$TMP | ssh $(NAS_USER)@$(NAS_HOST) \
	    "$(DOCKER) run --rm -i -v $(VOLUME_PREFIX)_$(1)_session:/session alpine \
	      sh -c 'cat > /session/$(1).storageState.json && chmod 600 /session/$(1).storageState.json'" ) ; \
	rc=$$? ; rm -f $$TMP ; exit $$rc
endef

seed-betterment:
	@echo "Opening Betterment in local browser — log in, session auto-saves when dashboard loads."
	$(call seed_session,betterment)
	@echo "Betterment session seeded."

seed-vanguard:
	@echo "Opening Vanguard in local browser — log in, session auto-saves when accounts page loads."
	$(call seed_session,vanguard)
	@echo "Vanguard session seeded."

seed-fidelity:
	@echo "Opening Fidelity in local browser — log in, session auto-saves when portfolio page loads."
	$(call seed_session,fidelity)
	@echo "Fidelity session seeded."
