FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci

COPY . .

EXPOSE 3000

CMD ["node", "server/index.js"]