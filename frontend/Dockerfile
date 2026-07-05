FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-slim
WORKDIR /app

ENV NODE_ENV=production

# wkhtmltopdf for dossier PDF export (headless HTML → PDF, Docker-friendly)
RUN apt-get update && apt-get install -y --no-install-recommends \
    wkhtmltopdf \
    fonts-liberation \
    fonts-dejavu-core \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY public ./public

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --home /home/appuser appuser && \
    chown -R appuser:nodejs /app /home/appuser

ENV HOME=/home/appuser
ENV XDG_RUNTIME_DIR=/tmp

USER appuser

EXPOSE 3001

CMD ["npm", "run", "start"]
