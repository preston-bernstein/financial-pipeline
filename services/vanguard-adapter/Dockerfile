FROM mcr.microsoft.com/playwright:noble AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/adapter-utils/package.json ./packages/adapter-utils/
COPY services/vanguard-adapter/package.json ./services/vanguard-adapter/
RUN npm ci --workspace=@financial-pipeline/vanguard-adapter

COPY packages/db ./packages/db
COPY packages/adapter-utils ./packages/adapter-utils
COPY services/vanguard-adapter ./services/vanguard-adapter

RUN npm run build --workspace=@financial-pipeline/db
RUN npm run build --workspace=@financial-pipeline/adapter-utils
RUN npm run build --workspace=@financial-pipeline/vanguard-adapter

FROM mcr.microsoft.com/playwright:noble
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/adapter-utils/dist ./packages/adapter-utils/dist
COPY --from=builder /app/services/vanguard-adapter/dist ./services/vanguard-adapter/dist

CMD ["node", "services/vanguard-adapter/dist/index.js"]
