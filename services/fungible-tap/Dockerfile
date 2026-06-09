FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/adapter-utils/package.json ./packages/adapter-utils/
COPY services/fungible-tap/package.json ./services/fungible-tap/
RUN npm ci --workspace=@financial-pipeline/fungible-tap

COPY packages/db ./packages/db
COPY packages/adapter-utils ./packages/adapter-utils
COPY services/fungible-tap ./services/fungible-tap

RUN npm run build --workspace=@financial-pipeline/db
RUN npm run build --workspace=@financial-pipeline/adapter-utils
RUN npm run build --workspace=@financial-pipeline/fungible-tap

FROM node:24-alpine
WORKDIR /app
RUN npm ci --omit=dev --workspace=@financial-pipeline/fungible-tap --ignore-scripts || true
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/adapter-utils/dist ./packages/adapter-utils/dist
COPY --from=builder /app/services/fungible-tap/dist ./services/fungible-tap/dist

CMD ["node", "services/fungible-tap/dist/index.js"]
