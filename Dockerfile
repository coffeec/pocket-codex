FROM node:22-bookworm-slim

ARG CODEX_VERSION=0.144.5
ARG CC_SWITCH_VERSION=v5.9.1
ARG TTYD_VERSION=1.7.7

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash ca-certificates curl git openssh-client procps \
    && curl -fsSL \
        "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64" \
        -o /tmp/ttyd \
    && echo "8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55  /tmp/ttyd" \
        | sha256sum -c - \
    && install -m 0755 /tmp/ttyd /usr/local/bin/ttyd \
    && npm install --global "@openai/codex@${CODEX_VERSION}" \
    && curl -fsSL \
        "https://github.com/SaladDay/cc-switch-cli/releases/download/${CC_SWITCH_VERSION}/cc-switch-cli-linux-x64-musl.tar.gz" \
        -o /tmp/cc-switch.tar.gz \
    && tar -xzf /tmp/cc-switch.tar.gz -C /usr/local/bin cc-switch \
    && chmod 0755 /usr/local/bin/cc-switch \
    && rm -rf /var/lib/apt/lists/* /tmp/cc-switch.tar.gz /tmp/ttyd

COPY entrypoint.sh /usr/local/bin/codex-agent-entrypoint
COPY web /app/web
RUN chmod 0755 /usr/local/bin/codex-agent-entrypoint

USER node
WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/codex-agent-entrypoint"]
