FROM node:20-slim

WORKDIR /app

# Copy workspace root files
COPY package.json ./
COPY tsconfig.base.json ./

# Copy shared package
COPY shared/package.json shared/
COPY shared/tsconfig.json shared/
COPY shared/src/ shared/src/

# Copy dashboard package
COPY dashboard/package.json dashboard/
COPY dashboard/tsconfig.json dashboard/
COPY dashboard/src/ dashboard/src/
COPY dashboard/public/ dashboard/public/

# Install secretvm-cli globally (needed for /api/deploy-agent)
# Must clone + build manually because the repo lacks a "prepare" script,
# so `npm install -g git+...` skips the TypeScript build step.
# Use npm pack to create a tarball, then install from it — avoids the
# npm 7+ symlink issue where `npm install -g .` links to the source dir.
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/* \
    && git clone https://github.com/scrtlabs/secretvm-cli.git /tmp/secretvm-cli \
    && cd /tmp/secretvm-cli \
    && npm install \
    && npm run build \
    && npm pack \
    && npm install -g secretvm-cli-*.tgz \
    && rm -rf /tmp/secretvm-cli

# Install all dependencies
RUN npm install

# Build shared then dashboard
RUN npm run build -w shared && npm run build -w dashboard

WORKDIR /app/dashboard

ARG DOCKER_IMAGE=local-dev
ENV DOCKER_IMAGE=$DOCKER_IMAGE

EXPOSE 3000

CMD ["node", "dist/index.js"]
