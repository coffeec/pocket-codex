FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl openssh-client tesseract-ocr tesseract-ocr-chi-sim \
    && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node web /app/web
COPY LICENSE THIRD-PARTY-NOTICES.md /app/licenses/
COPY host/pocket-hostctl /usr/local/bin/hostctl
RUN chmod 0755 /usr/local/bin/hostctl

ENV NODE_ENV=production \
    WEB_HOST=0.0.0.0 \
    WEB_PORT=7682 \
    CODEX_WEB_DATA=/home/node/.codex-web \
    HOSTCTL_PATH=/usr/local/bin/hostctl

USER node
WORKDIR /app
EXPOSE 7682

ENTRYPOINT ["node", "/app/web/server.mjs"]
