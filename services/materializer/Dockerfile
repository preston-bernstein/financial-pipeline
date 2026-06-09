FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/adapter-utils/package.json ./packages/adapter-utils/
COPY services/materializer/package.json ./services/materializer/
RUN npm ci --workspace=@financial-pipeline/materializer

COPY packages/db ./packages/db
COPY packages/adapter-utils ./packages/adapter-utils
COPY services/materializer ./services/materializer

RUN npm run build --workspace=@financial-pipeline/db
RUN npm run build --workspace=@financial-pipeline/adapter-utils
RUN npm run build --workspace=@financial-pipeline/materializer

FROM node:24-alpine
WORKDIR /app
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/adapter-utils/package.json ./packages/adapter-utils/package.json
COPY --from=builder /app/packages/adapter-utils/dist ./packages/adapter-utils/dist
COPY --from=builder /app/services/materializer/dist ./services/materializer/dist

CMD ["node", "services/materializer/dist/index.js"]
