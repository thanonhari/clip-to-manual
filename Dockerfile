# ======================================================================
# ClipToManual - Multi-stage Production Dockerfile
# ======================================================================
FROM node:22-bookworm-slim

# Install system utilities: python3, ffmpeg, curl for yt-dlp
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    ca-certificates \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests
COPY package*.json tsconfig.json .oxlintrc.json AGENTS.md ./

# Install dependencies
RUN npm ci

# Copy source files
COPY src/ ./src/
COPY manuals/ ./manuals/

# Verify quality gate during build
RUN npm run check
RUN npm test

# Build production bundle
RUN npm run build

# Expose Web Server port
EXPOSE 3100

# Environment defaults
ENV PORT=3100
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3100/api/stats || exit 1

# Start server
CMD ["node", "dist/index.js"]
