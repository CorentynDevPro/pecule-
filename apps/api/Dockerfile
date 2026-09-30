# Construit depuis la racine du dépôt (voir docker-compose.yml).
# esbuild produit un seul fichier autonome : l'image finale ne contient ni node_modules ni sources.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w apps/api

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/api/dist ./dist
COPY apps/api/migrations ./migrations
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
