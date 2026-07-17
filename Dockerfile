FROM node:22-bookworm-slim

ARG CODEX_VERSION=0.144.5
ARG CC_SWITCH_VERSION=v5.9.1
ARG TTYD_VERSION=1.7.7
ARG TTYD_ASSET_ID=159377628
ARG CC_SWITCH_ASSET_ID=478138435

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash ca-certificates curl git openssh-client procps tesseract-ocr tesseract-ocr-chi-sim \
    && curl -fsSL --retry 5 --retry-all-errors --connect-timeout 20 \
        -H "Accept: application/octet-stream" \
        "https://api.github.com/repos/tsl0922/ttyd/releases/assets/${TTYD_ASSET_ID}" \
        -o /tmp/ttyd \
    && echo "8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55  /tmp/ttyd" \
        | sha256sum -c - \
    && install -m 0755 /tmp/ttyd /usr/local/bin/ttyd \
    && npm install --global "@openai/codex@${CODEX_VERSION}" \
    && curl -fsSL --retry 5 --retry-all-errors --connect-timeout 20 \
        -H "Accept: application/octet-stream" \
        "https://api.github.com/repos/SaladDay/cc-switch-cli/releases/assets/${CC_SWITCH_ASSET_ID}" \
        -o /tmp/cc-switch.tar.gz \
    && echo "5a1d5aa92f7f58dac97aa4d50cd63c379ae2f3d113e0de0dc86183e19a18d3e1  /tmp/cc-switch.tar.gz" \
        | sha256sum -c - \
    && tar -xzf /tmp/cc-switch.tar.gz -C /usr/local/bin cc-switch \
    && chmod 0755 /usr/local/bin/cc-switch \
    && rm -rf /var/lib/apt/lists/* /tmp/cc-switch.tar.gz /tmp/ttyd

COPY entrypoint.sh /usr/local/bin/codex-agent-entrypoint
COPY web /app/web
RUN chmod 0755 /usr/local/bin/codex-agent-entrypoint

USER node
WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/codex-agent-entrypoint"]
