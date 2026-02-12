# # Use an official Node.js runtime as base
# FROM node:18-alpine

# # Set working directory
# WORKDIR /app

# # Copy package files and install deps
# COPY package*.json ./
# RUN npm ci

# # Copy source code
# COPY . .

# # Build TypeScript to JS
# RUN npm run build

# # Expose app port
# EXPOSE 4000

# # Run the app (compiled JS entrypoint)
# CMD ["node", "dist/app.js"]


# ----------------------------
# Stage 1: Build Stage
# ----------------------------
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files and install ALL dependencies (including devDeps)
COPY package*.json ./
RUN npm ci

# Copy source code and build
COPY . .
RUN npm run build

# ----------------------------
# Stage 2: Production Stage
# ----------------------------
FROM node:18-alpine

WORKDIR /app

# Copy package files again to install ONLY production dependencies
COPY package*.json ./
# --omit=dev installs only dependencies needed to run the app
# && npm cache clean removes the installation cache files
RUN npm ci --omit=dev && npm cache clean --force

# Copy only the compiled code from the builder stage
# We ignore the original 'src' folder here
COPY --from=builder /app/dist ./dist

# Security best practice: Run as non-root user
USER node

# Expose app port
EXPOSE 4000

# Run the app
CMD ["node", "dist/app.js"]