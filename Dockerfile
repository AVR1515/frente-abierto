# Dockerfile del servidor (Fase 8). Construye desde la raíz del monorepo porque
# /server depende del workspace /shared (los symlinks de npm workspaces viven en
# la raíz de node_modules, así que no conviene copiar solo server/node_modules).
# Pensado para un host con soporte de WebSockets persistentes (Fly.io, Railway,
# un VPS propio, etc.) — no funciona en hosting serverless sin WS.
#
# Build:  docker build -t frente-abierto-server .
# Run:    docker run -p 2567:2567 --env-file server/.env frente-abierto-server

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
COPY shared/package.json ./shared/package.json
RUN npm install

COPY shared ./shared
COPY server ./server
RUN npm run build --workspace server

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=2567

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist

EXPOSE 2567
CMD ["node", "server/dist/index.js"]
