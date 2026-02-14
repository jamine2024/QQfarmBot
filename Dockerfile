FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV DATA_DIR=/data/admin
ENV WEB_DIST_DIR=/app/apps/admin-web/dist

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .
EXPOSE 8787
CMD ["node", "apps/admin-server/dist/index.js"]
