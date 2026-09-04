FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV APP_DATA_DIR=/app/data
ENV DKG_HOME=/dkg-home

COPY package*.json ./
RUN npm ci --omit=dev
RUN npm install -g @origintrail-official/dkg@10.0.14

COPY --from=build /app/dist ./dist
COPY examples ./examples
COPY scripts ./scripts
RUN chmod +x ./scripts/start-with-dkg.sh ./scripts/init-dkg-volume.sh

RUN mkdir -p /app/data
VOLUME ["/app/data", "/dkg-home"]

EXPOSE 8080
EXPOSE 9200
CMD ["sh", "./scripts/start-with-dkg.sh"]
