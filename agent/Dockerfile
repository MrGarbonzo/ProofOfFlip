FROM node:20-slim

ARG DOCKER_IMAGE=ghcr.io/proofofflip/agent:local
ENV DOCKER_IMAGE=$DOCKER_IMAGE

WORKDIR /app

# Copy workspace root files
COPY package.json ./
COPY tsconfig.base.json ./

# Copy shared package
COPY shared/package.json shared/
COPY shared/tsconfig.json shared/
COPY shared/src/ shared/src/

# Copy agent package
COPY agent/package.json agent/
COPY agent/tsconfig.json agent/
COPY agent/src/ agent/src/

# Install all dependencies
RUN npm install

# Build shared then agent
RUN npm run build -w shared && npm run build -w agent

# Create persistence directory
RUN mkdir -p /secretvm/data

WORKDIR /app/agent

EXPOSE 3001

CMD ["node", "dist/index.js"]
