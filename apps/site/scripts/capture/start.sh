#!/bin/sh
# Starts what the captures need, each with a clean environment and a throwaway
# home, so no real settings, keys or site lists are read or written. See README.md.
#
#   start.sh sites               make the two throwaway sites (Caddow, Lowfield) with the released CLI
#   start.sh host                the stand-in Cloudflare on 4791 (prints the key it accepts)
#   start.sh wordpress           the importer's stand-in WordPress site on 4792
#   start.sh galley              the released Galley on 4790, open on the Caddow site
#   start.sh stop                stop everything this script started (by PID)
#
# CAPTURE_DIR (default /tmp/galley-capture) holds home/, galley-home/, logs/ and pids/.
# GALLEY_VERSION (default 0.1.2) is the galley-cms release to run.
# The assistant: set ANTHROPIC_API_KEY in your own shell before "start.sh galley";
# it is passed to that one process and to nothing else. This script reads no key file.
# FAKES / WP_FAKES may point at copies of the test helpers (see README.md).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../../.." && pwd)
C=${CAPTURE_DIR:-/tmp/galley-capture}
V=${GALLEY_VERSION:-0.1.2}
H="$C/home"
mkdir -p "$H/sites" "$C/galley-home" "$C/logs" "$C/pids"
clean() { env -i PATH="$PATH" HOME="$H" GALLEY_HOME="$C/galley-home" "$@"; }
# In the background, as its own process (so its PID is the one recorded), with a log.
bg() { name=$1; shift; ( exec env -i PATH="$PATH" HOME="$H" GALLEY_HOME="$C/galley-home" "$@" ) > "$C/logs/$name.log" 2>&1 & echo $! > "$C/pids/$name.pid"; }
# A process and everything it started, children first (by PID, never by name).
stop_tree() { for c in $(pgrep -P "$1" 2>/dev/null); do stop_tree "$c"; done; kill "$1" 2>/dev/null || true; }

case "$1" in
  sites)
    for s in caddow lowfield; do
      [ -d "$H/sites/$s" ] || clean npx --yes "galley-cms@$V" new "$s" --starter "$s" --no-start --dir "$H/sites"
      # Versions are published as an invented person from the starter.
      git -C "$H/sites/$s" config user.name "Tobiah Rusk"
      git -C "$H/sites/$s" config user.email "tobiah@caddow.example"
    done ;;
  host)
    cd "$REPO"
    bg host FAKES="${FAKES:-$REPO/packages/core/test/deploy/fakes}" node --import tsx "$HERE/serve-host.mts" 4791
    sleep 4; cat "$C/logs/host.log" ;;
  wordpress)
    cd "$REPO/packages/import-wordpress"
    bg wordpress node --import tsx "${WP_FAKES:-$REPO/packages/import-wordpress/test}/serve-fake-site.ts" --port 4792 --posts 12 --pages 6 --elementor 2
    sleep 4; cat "$C/logs/wordpress.log" ;;
  galley)
    cd "$H"
    bg galley ${ANTHROPIC_API_KEY:+ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"} \
      GALLEY_DEPLOY_CLOUDFLARE_API="http://127.0.0.1:4791/client/v4" \
      GALLEY_DEPLOY_PROBE="http://127.0.0.1:4791/__probe?host={host}" \
      npx --yes "galley-cms@$V" "$H/sites/caddow" --no-open --port 4790
    echo "Galley starting (log: $C/logs/galley.log; its Open: line carries the token)" ;;
  stop)
    for f in "$C"/pids/*.pid; do
      [ -f "$f" ] || continue
      p=$(cat "$f")
      # npx runs Galley as a child (and Galley runs each site's preview): stop the whole tree.
      stop_tree "$p" && echo "stopped $(basename "$f" .pid) ($p)"
      rm -f "$f"
    done ;;
  *) sed -n '2,16p' "$0"; exit 1 ;;
esac
