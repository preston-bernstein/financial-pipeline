FROM mcr.microsoft.com/playwright:noble AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/adapter-utils/package.json ./packages/adapter-utils/
COPY services/fidelity-adapter/package.json ./services/fidelity-adapter/
RUN npm ci --workspace=@financial-pipeline/fidelity-adapter

COPY packages/db ./packages/db
COPY packages/adapter-utils ./packages/adapter-utils
COPY services/fidelity-adapter ./services/fidelity-adapter

RUN npm run build --workspace=@financial-pipeline/db
RUN npm run build --workspace=@financial-pipeline/adapter-utils
RUN npm run build --workspace=@financial-pipeline/fidelity-adapter

FROM mcr.microsoft.com/playwright:noble
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/adapter-utils/dist ./packages/adapter-utils/dist
COPY --from=builder /app/services/fidelity-adapter/dist ./services/fidelity-adapter/dist

CMD ["node", "services/fidelity-adapter/dist/index.js"]
