NAS_HOST ?= YOUR_NAS_IP
NAS_USER ?= YOUR_NAS_USER
NAS_PATH ?= YOUR_NAS_PATH
DOCKER   ?= /usr/local/bin/docker
PLATFORM  = linux/amd64

SERVICES = plaid-tap betterment-adapter vanguard-adapter fidelity-adapter materializer mcp-server
DB_PKG   = packages/db

.PHONY: build push deploy typecheck

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
