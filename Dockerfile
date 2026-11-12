# Small, boring, and production-shaped: install only what runs, drop root,
# and let the platform health-check /healthz.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY shared ./shared
COPY server ./server
COPY client ./client
USER node
EXPOSE 8080
# --trust-proxy makes per-IP limits read X-Forwarded-For, which is what a
# platform load balancer sets. Without it every player looks like one address.
CMD ["node", "server/index.js", "--trust-proxy"]
