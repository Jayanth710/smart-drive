# Use an official Node.js runtime as base
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files and install deps
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript to JS
RUN npm run build

# Expose app port
EXPOSE 4000

# Run the app (compiled JS entrypoint)
CMD ["node", "dist/app.js"]
