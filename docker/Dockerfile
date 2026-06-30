FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY tsconfig.json tsup.config.ts ./
COPY src/ src/
RUN corepack enable && pnpm build && pnpm prune --prod

FROM node:24-alpine
WORKDIR /app

RUN addgroup -S flowtask && adduser -S flowtask -G flowtask

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

USER flowtask

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node dist/index.js doctor > /dev/null 2>&1 || exit 1

ENTRYPOINT ["node", "dist/index.js"]
CMD ["--help"]
