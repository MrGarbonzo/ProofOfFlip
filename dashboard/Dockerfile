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

# Install all dependencies
RUN npm install

# Build shared then dashboard
RUN npm run build -w shared && npm run build -w dashboard

WORKDIR /app/dashboard

EXPOSE 3000

CMD ["node", "dist/index.js"]
