FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production BIND_HOST=0.0.0.0 PORT=8787 STATE_DIR=/app/.state
COPY --chown=node:node *.mjs package.json ./
COPY --chown=node:node public/ ./public/
COPY --chown=node:node README.md CONTRACT.md ./
COPY --chown=node:node docs/COVERAGE.md docs/WORKDAY.md docs/INVESTIGATIONS.md ./docs/
RUN mkdir -p /app/.state && chown node:node /app/.state
USER node
EXPOSE 8787
CMD ["node", "server.mjs"]
