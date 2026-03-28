FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3100
CMD ["node", "--experimental-strip-types", "server.ts"]
