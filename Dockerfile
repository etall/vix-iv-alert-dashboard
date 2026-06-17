FROM node:24-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js README.md .env.example ./
COPY src ./src
COPY public ./public

ENV PORT=8787
EXPOSE 8787

CMD ["npm", "start"]
