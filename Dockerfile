FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
