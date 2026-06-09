FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/db/package.json ./packages/db/
RUN npm ci --workspace=@financial-pipeline/db

COPY packages/db ./packages/db
RUN npm run build --workspace=@financial-pipeline/db

FROM node:24-alpine
WORKDIR /app/packages/db
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/packages/db/dist ./dist
COPY --from=builder /app/packages/db/migrations ./migrations

CMD ["node", "dist/migrate.js"]
