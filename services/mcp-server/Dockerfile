FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/adapter-utils/package.json ./packages/adapter-utils/
COPY services/mcp-server/package.json ./services/mcp-server/
RUN npm ci --workspace=@financial-pipeline/mcp-server

COPY packages/db ./packages/db
COPY packages/adapter-utils ./packages/adapter-utils
COPY services/mcp-server ./services/mcp-server

RUN npm run build --workspace=@financial-pipeline/db
RUN npm run build --workspace=@financial-pipeline/adapter-utils
RUN npm run build --workspace=@financial-pipeline/mcp-server

FROM node:24-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/adapter-utils/package.json ./packages/adapter-utils/package.json
COPY --from=builder /app/packages/adapter-utils/dist ./packages/adapter-utils/dist
COPY --from=builder /app/services/mcp-server/dist ./services/mcp-server/dist

CMD ["node", "services/mcp-server/dist/index.js"]
