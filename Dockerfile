FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4174 \
    POSTLY_DISABLE_ENV_FILE=1 \
    POSTLY_DATA_DIR=/var/lib/postly \
    PUBLIC_MEDIA_STORAGE_DIR=/var/lib/postly/media

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/dist/client ./dist/client

RUN mkdir -p /var/lib/postly && chown node:node /var/lib/postly

USER node
VOLUME ["/var/lib/postly"]
EXPOSE 4174

CMD ["npm", "start"]
