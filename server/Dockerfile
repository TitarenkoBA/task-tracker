FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.mjs lib.mjs ./
ENV HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
CMD ["node", "index.mjs"]
