FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/adapter-utils/package.json ./packages/adapter-utils/
COPY services/plaid-tap/package.json ./services/plaid-tap/
RUN npm ci --workspace=@financial-pipeline/plaid-tap

COPY packages/db ./packages/db
COPY packages/adapter-utils ./packages/adapter-utils
COPY services/plaid-tap ./services/plaid-tap

RUN npm run build --workspace=@financial-pipeline/db
RUN npm run build --workspace=@financial-pipeline/adapter-utils
RUN npm run build --workspace=@financial-pipeline/plaid-tap

FROM node:24-alpine
WORKDIR /app
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/adapter-utils/package.json ./packages/adapter-utils/package.json
COPY --from=builder /app/packages/adapter-utils/dist ./packages/adapter-utils/dist
COPY --from=builder /app/services/plaid-tap/dist ./services/plaid-tap/dist

CMD ["node", "services/plaid-tap/dist/index.js"]
