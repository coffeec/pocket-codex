FROM node:22-bookworm-slim AS build

ARG CLOUDCLI_COMMIT=27eaf0146a46aa8a55178f3d394360ff7465420f

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY landlock-wrapper.c /tmp/landlock-wrapper.c
RUN cc -O2 -Wall -Wextra -Werror /tmp/landlock-wrapper.c -o /tmp/pocket-codex-landlock
COPY upstream-27eaf0146a46.tar.gz /tmp/cloudcli-upstream.tar.gz
RUN echo "1895c6a64742e41f64af142c90a5357138e6a0bd86152e82ebfd34d464d5be50  /tmp/cloudcli-upstream.tar.gz" \
        | sha256sum -c - \
    && tar -xzf /tmp/cloudcli-upstream.tar.gz -C /src \
    && rm /tmp/cloudcli-upstream.tar.gz

COPY patches /tmp/pocketcodex-patches
RUN for patch in /tmp/pocketcodex-patches/*.patch; do \
        git apply --check --ignore-space-change "$patch" \
        && git apply --ignore-space-change "$patch"; \
    done \
    && npm ci --no-audit --no-fund \
    && VITE_IS_PLATFORM=true VITE_POCKETCODEX_MODE=true VITE_BASE_PATH=/agent/ npm run build \
    && npm prune --omit=dev

FROM node:22-bookworm-slim

ARG CLOUDCLI_COMMIT=27eaf0146a46aa8a55178f3d394360ff7465420f

LABEL org.opencontainers.image.source="https://github.com/siteboon/claudecodeui" \
      org.opencontainers.image.revision="${CLOUDCLI_COMMIT}" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates git openssh-client procps \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOME=/home/node \
    HOST=0.0.0.0 \
    SERVER_PORT=3001 \
    DATABASE_PATH=/home/node/.cloudcli/auth.db \
    WORKSPACES_ROOT=/workspaces \
    VITE_IS_PLATFORM=true \
    VITE_POCKETCODEX_MODE=true \
    POCKETCODEX_MODE=true \
    POCKET_CODEX_PATH=/usr/local/bin/pocket-codex-landlock

COPY --from=build --chown=node:node /src/package.json /src/package-lock.json /app/
COPY --from=build --chown=node:node /src/dist /app/dist
COPY --from=build --chown=node:node /src/dist-server /app/dist-server
COPY --from=build --chown=node:node /src/public /app/public
COPY --from=build --chown=node:node /src/node_modules /app/node_modules
COPY --from=build /tmp/pocket-codex-landlock /usr/local/bin/pocket-codex-landlock
COPY entrypoint.sh /usr/local/bin/pocket-cloudcli-entrypoint
RUN chmod 0755 /usr/local/bin/pocket-cloudcli-entrypoint /usr/local/bin/pocket-codex-landlock \
    && mkdir -p /workspaces /home/node/.cloudcli \
    && chown -R node:node /workspaces /home/node/.cloudcli

USER node
WORKDIR /app
EXPOSE 3001
ENTRYPOINT ["/usr/local/bin/pocket-cloudcli-entrypoint"]
