FROM node:20-bullseye-slim

ENV NODE_ENV=production
ENV PORT=3000
ENV NODE_OPTIONS="--max-old-space-size=460"

WORKDIR /usr/src/app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    python3 \
    make \
    g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-progress --no-audit

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]