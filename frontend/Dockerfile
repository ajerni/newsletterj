FROM node:20-slim AS deps
WORKDIR /app
ENV PUPPETEER_SKIP_CHROME_DOWNLOAD=true
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-slim
WORKDIR /app

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROME_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# System Chromium for dossier PDF export (Puppeteer)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-dejavu-core \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY public ./public

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser && \
    chown -R appuser:nodejs /app

USER appuser

EXPOSE 3001

CMD ["npm", "run", "start"]
