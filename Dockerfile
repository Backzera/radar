# Compiled LOCAL preview, not the Cloudflare production runtime. See docs/production.md.
FROM node:22.16-bookworm-slim
LABEL org.opencontainers.image.description="Market Radar compiled local preview; not a public production server"
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev --include=optional --no-audit --no-fund
COPY . .
RUN npm run build
EXPOSE 5173
CMD ["node","--import","./scripts/sites-env.mjs","./node_modules/wrangler/bin/wrangler.js","dev","--config","dist/server/wrangler.json","--local","--persist-to",".wrangler/state","--ip","0.0.0.0","--port","5173","--inspector-port","0"]
