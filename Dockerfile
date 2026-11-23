# Hosted Galley: the web UI and the single-file CLI bundle, on a slim Node
# runtime with git. Run with GALLEY_PASSWORD set; data lives in /data.
#
#   docker build -t galley .
#   docker run -p 4400:4400 -p 4410-4429:4410-4429 -e GALLEY_PASSWORD=... \
#     -e GALLEY_PUBLIC_URL=https://cms.example.com -v galley-data:/data galley
#
# Previews: every site's preview and its live-site view are served on ports
# 4410–4429 (GALLEY_PREVIEW_PORTS), so publish that range as it is. Behind
# HTTPS those ports need TLS too — see packages/server/README.md.

# ── build ─────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
ENV CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /src

# The whole workspace at once: every package's manifest must be present for a
# frozen install, and the list of packages grows over time.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @galley/web build \
 && pnpm --filter galley-cms build \
 && test -f packages/cli/dist/galley.mjs \
 && test -f packages/cli/dist/web/index.html

# ── runtime ───────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
# NODE_ENV stays unset on purpose: sites install their devDependencies (their
# framework usually lives there) when the preview starts.
ENV GALLEY_HOME=/data \
    GALLEY_HOST=0.0.0.0 \
    GALLEY_PORT=4400 \
    GALLEY_PREVIEW_PORTS=4410-4429 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

COPY --from=build /src/packages/cli/dist/ /opt/galley/
RUN mkdir -p /data && chown node:node /data

USER node
WORKDIR /data
VOLUME ["/data"]
# The app, and the fixed range the preview proxies are allocated from (2 per open preview).
EXPOSE 4400 4410-4429

# /api/meta is the one route that answers without signing in; loopback is always an allowed host.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.GALLEY_PORT || 4400) + '/api/meta').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

ENTRYPOINT ["tini", "--", "node", "/opt/galley/galley.mjs"]
CMD ["serve"]
