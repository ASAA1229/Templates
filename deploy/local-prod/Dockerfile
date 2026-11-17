# Production image for the ASAA Templates API and the bundled web server (local production deployment).
# Build context is the repository root:  docker build -f deploy/local-prod/Dockerfile .
FROM node:24-alpine
RUN apk add --no-cache git openssl
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false
COPY . .
RUN npm install --no-audit --no-fund && npm run build
ENV NODE_ENV=production
WORKDIR /app/apps/api
CMD ["node", "dist/server.js"]
