FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.14.0 --activate
WORKDIR /app
COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsup.config.ts ./
COPY src/ src/
RUN pnpm build
RUN pnpm prune --prod

FROM node:24-alpine
RUN corepack enable && corepack prepare pnpm@9.14.0 --activate
WORKDIR /app
RUN addgroup -S flowtask && adduser -S flowtask -G flowtask
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER flowtask
ENTRYPOINT ["node", "dist/index.js"]
CMD ["--help"]
