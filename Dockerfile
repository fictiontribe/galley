# syntax=docker/dockerfile:1
#
# One hosted install: this app for ONE site, with its whole state in /data.
# See docs/cloud-install.md for running it (a reverse proxy in front, three
# hostnames, one volume).
#
#   docker build -t galley .
#   docker run --rm -p 4400:4400 -v galley-data:/data \
#     -e GALLEY_PUBLIC_URL=http://localhost:4400 galley
#
# It needs BuildKit, Docker's default builder (the buildx plugin; on Debian's
# and Ubuntu's own docker.io package, install docker-buildx beside it): the
# old builder stops at the build stage's `--platform=$BUILDPLATFORM`.
#
# Built for linux/amd64 and linux/arm64. The bundle is plain JavaScript, so it
# is built once on the builder's own architecture and copied into each
# runtime image:
#
#   docker buildx build --platform linux/amd64,linux/arm64 -t <name>:<version> .
#
# On a machine too small to build the workspace inside Docker, build the
# bundle outside and pack that instead (the runtime image is the same):
#
#   pnpm --filter @galley/web build && pnpm --filter galley-cms build
#   docker build --build-arg BUNDLE=prebuilt -t galley .

ARG NODE_VERSION=22
# Which stage the bundle comes from: "build" (inside Docker) or "prebuilt" (packages/cli/dist from outside).
ARG BUNDLE=build

# ── build ─────────────────────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS build
ENV CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /src

# The whole workspace is the context (every manifest must be present for a
# frozen install), but only what the bundle is made of is installed: the
# command line with the server and engine behind it, the web UI, and the site
# kit and overlay the bundle embeds.
COPY . .
RUN pnpm install --frozen-lockfile \
      --filter galley \
      --filter "galley-cms..." \
      --filter "@galley/web..." \
      --filter "@galley/astro..." \
      --filter "@galley/overlay..."
RUN pnpm --filter @galley/web build \
 && pnpm --filter galley-cms build \
 && test -f packages/cli/dist/galley.mjs \
 && test -f packages/cli/dist/web/index.html \
 && test -d packages/cli/dist/starters \
 && mkdir /out && cp -R packages/cli/dist/. /out/

# ── prebuilt: a bundle built outside Docker ───────────────────────────────
FROM scratch AS prebuilt
COPY packages/cli/dist/ /out/

FROM ${BUNDLE} AS bundle

# ── runtime ───────────────────────────────────────────────────────────────
# Debian rather than Alpine on purpose: the previewed site installs its own
# packages inside this image, and prebuilt native modules (sharp, esbuild,
# rollup) are published for glibc first.
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

# git and ssh: the site is a repository, reached with the install's own
# deploy key. tini: PID 1 that forwards the stop signal and reaps the
# preview's children. corepack: sites that pin pnpm or yarn get it on first
# use. (setpriv, which the entrypoint drops root with, is part of the base image.)
# /run/galley: a folder for GALLEY_SOCKET, the server's own (a named volume
# mounted there takes this over), which the proxy's container reaches as group
# node — see GALLEY_SOCKET_MODE below.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && mkdir -p /data && chown node:node /data \
 && mkdir -p /run/galley && chown node:node /run/galley && chmod 750 /run/galley

# NODE_ENV stays unset on purpose: the site's framework usually sits in its
# devDependencies, which a "production" install would skip.
#
# HOME is inside the data folder so that everything written at run time —
# package caches included — lands on the one volume, or in /tmp: the root
# filesystem can then be mounted read-only with a tmpfs at /tmp
# (docker-compose.yml does, like every compose file `galley host recipe` writes).
#
# GALLEY_SOCKET_MODE=0660: a socket, when GALLEY_SOCKET is set, lets group node
# in as well as user node, so that a proxy in another container can connect by
# running with that group (gid 1000). In this image node is the only account in
# that group. Outside it the server can't know that, so its default is 0600.
ENV GALLEY_HOME=/data \
    HOME=/data/home \
    GALLEY_HOST=0.0.0.0 \
    GALLEY_PORT=4400 \
    GALLEY_SOCKET_MODE=0660 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY --from=bundle --chown=root:root /out/ /opt/galley/
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/galley-entrypoint

# The server never runs as root: docker/entrypoint.sh drops to "node" before
# it starts — the site's own build and preview run here, as code by design.
# No USER line on purpose: some hosts mount the volume owned by root and offer
# no way to pick the user, and the entrypoint needs one moment as root to hand
# /data over. Where the user can be set (docker-compose.yml: `user: node`),
# root is never involved at all.
WORKDIR /data
VOLUME ["/data"]
# One port. The preview and the live comparison are reached through it by
# hostname (docs/cloud-install.md), so nothing else is ever published.
EXPOSE 4400

# /healthz answers without signing in and says nothing about the install.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.GALLEY_PORT || 4400) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# SIGTERM (docker stop) reaches the server through tini: it stops the preview,
# closes open connections and exits.
STOPSIGNAL SIGTERM
ENTRYPOINT ["tini", "--", "galley-entrypoint", "node", "/opt/galley/galley.mjs"]
CMD ["serve"]
