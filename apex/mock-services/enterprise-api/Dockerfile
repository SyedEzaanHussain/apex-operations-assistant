FROM node:20-alpine
WORKDIR /app
COPY server.js .
USER node
EXPOSE 4010
HEALTHCHECK CMD wget -qO- http://localhost:4010/health || exit 1
CMD ["node", "server.js"]
