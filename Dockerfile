FROM node:20-alpine

# Install system dependencies for audio streaming and codecs
RUN apk add --no-cache ffmpeg curl ca-certificates

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm install --production

# Copy application source code
COPY . .

# Create volume mount directories
RUN mkdir -p /app/backend/data /app/models /app/recordings

ENV PORT=3300
ENV NODE_ENV=production

EXPOSE 3300

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3300/v1/llm/status || exit 1

CMD ["node", "backend/server.js"]
