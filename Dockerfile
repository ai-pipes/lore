FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ─────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# dist/cli.js is a self-contained bundle; migrations, prompt templates and the
# demo docs are read from disk at runtime.
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/prompts ./prompts
COPY --from=builder --chown=node:node /app/examples/demo-docs ./examples/demo-docs

RUN mkdir -p /app/storage && chown node:node /app/storage
USER node

EXPOSE 4737 4738

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4737/health/ready || exit 1

CMD ["node", "dist/cli.js", "serve"]
