# Stage 1: Build the monorepo application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package configurations
COPY package*.json ./
COPY shared/package*.json ./shared/
COPY server/package*.json ./server/
COPY client/package*.json ./client/

# Install all monorepo dependencies
RUN npm ci

# Copy codebase
COPY . .

# Run build across workspaces (compiles TS and bundles Vite UI)
RUN npm run build

# Stage 2: Lightweight production runner image
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment flags
ENV NODE_ENV=production
ENV PORT=3001

# Copy built artifacts and dependencies
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/shared/package*.json ./shared/
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/package*.json ./server/
COPY --from=builder /app/server/node_modules ./server/node_modules
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/client/package*.json ./client/

# Expose port 3001
EXPOSE 3001

# Run from server directory where the db/data lives
WORKDIR /app/server

CMD ["node", "dist/index.js"]
