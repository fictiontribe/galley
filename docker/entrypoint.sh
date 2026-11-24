#!/bin/sh
# Starts the server as the unprivileged "node" user, whatever the host did
# with the volume.
#
# Started as node already (docker-compose.yml sets `user:`; so does
# `docker run --user node`): nothing to do, root is never involved.
#
# Started as root (hosts that mount a fresh volume owned by root and give no
# way to choose the user): hand the data folder to node once, then give up
# root and every capability for good before the server — and the site's own
# build and preview after it — run.
set -eu

DATA="${GALLEY_HOME:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA"
  # Only when the folder isn't node's yet: a restart must not walk a large checkout.
  if [ "$(stat -c %u "$DATA")" != "$(id -u node)" ]; then
    chown -R node:node "$DATA"
  fi
  exec setpriv --reuid=node --regid=node --init-groups --no-new-privs --inh-caps=-all --bounding-set=-all -- "$@"
fi

exec "$@"
