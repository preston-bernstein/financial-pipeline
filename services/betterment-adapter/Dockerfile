FROM mcr.microsoft.com/playwright:noble AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/adapter-utils/package.json ./packages/adapter-utils/
COPY services/betterment-adapter/package.json ./services/betterment-adapter/
RUN npm ci --workspace=@financial-pipeline/betterment-adapter

COPY packages/db ./packages/db
COPY packages/adapter-utils ./packages/adapter-utils
COPY services/betterment-adapter ./services/betterment-adapter

RUN npm run build --workspace=@financial-pipeline/db
RUN npm run build --workspace=@financial-pipeline/adapter-utils
RUN npm run build --workspace=@financial-pipeline/betterment-adapter

FROM mcr.microsoft.com/playwright:noble
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/adapter-utils/dist ./packages/adapter-utils/dist
COPY --from=builder /app/services/betterment-adapter/dist ./services/betterment-adapter/dist

CMD ["node", "services/betterment-adapter/dist/index.js"]
