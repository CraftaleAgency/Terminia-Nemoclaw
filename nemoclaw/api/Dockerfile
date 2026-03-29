FROM node:22-alpine
WORKDIR /app

# Install API dependencies
COPY nemoclaw/api/package*.json ./
RUN npm install --production

# Copy API source
COPY nemoclaw/api/ .

# Copy skills for bandi sync
COPY skills/ /app/skills/

# Install skill dependencies (supabase-js used by _shared)
RUN cd /app/skills/_shared && npm install --production 2>/dev/null || true

EXPOSE 3100
CMD ["node", "--experimental-strip-types", "server.ts"]
