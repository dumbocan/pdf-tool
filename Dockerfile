FROM node:22-bookworm-slim

# OCR support (tesseract + Spanish + poppler for PDF->image) so scanned
# invoices work inside the container on any Docker host (Linux/macOS/Windows).
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends tesseract-ocr tesseract-ocr-spa poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod --ignore-scripts
COPY src ./src
COPY bin ./bin
COPY scripts ./scripts

ENV NODE_ENV=production
EXPOSE 3000
USER node

# Default: the HTTP server (used by Laia / the mail sidecars). To scan a folder
# of invoices instead, run:
#   docker run -v /ruta/facturas:/facturas pdf-tool node bin/pdf-tool.mjs facturas /facturas --ocr
CMD ["node", "src/server.js"]
