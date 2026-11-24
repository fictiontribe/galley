#!/bin/sh
# Starts what the captures need, each with a clean environment and a throwaway
# home, so no real settings, keys or site lists are read or written. See README.md.
#
#   start.sh sites               make the two throwaway sites (Caddow, Lowfield) with the released CLI
#   start.sh host                the stand-in Cloudflare on 4791 (prints the key it accepts)
#   start.sh wordpress           the importer's stand-in WordPress site on 4792
#   start.sh hosting             the stand-in Fly.io and Cloudflare for "Host the editor online"
#                                (scripts/rehearse-hosting.mjs, on 4793/4794; a fake install on 4796)
#   start.sh galley              the released Galley on 4790, open on the Caddow site
#                                (pointed at the hosting stand-ins too, if "hosting" ran first)
#   start.sh hosted              a hosted install (galley serve) on http://cms.localhost:4797 with no
#                                site, for its sign-in and first run; needs HOSTED_PASSWORD (12+ characters)
#   start.sh stop                stop everything this script started (by PID)
#
# CAPTURE_DIR (default /tmp/galley-capture) holds home/, galley-home/, hosted-home/, logs/ and pids/.
# GALLEY_VERSION (default 0.3.0) is the galley-cms release to run.
# The assistant: set ANTHROPIC_API_KEY in your own shell before "start.sh galley";
# it is passed to that one process and to nothing else. This script reads no key file.
# FAKES / WP_FAKES may point at copies of the test helpers (see README.md).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../../.." && pwd)
C=${CAPTURE_DIR:-/tmp/galley-capture}
V=${GALLEY_VERSION:-0.3.0}
H="$C/home"
mkdir -p "$H/sites" "$C/galley-home" "$C/logs" "$C/pids"
# One npm cache for every npx below, inside the throwaway home.
clean() { env -i PATH="$PATH" HOME="$H" npm_config_cache="$H/.npm" GALLEY_HOME="$C/galley-home" "$@"; }
# In the background, as its own process (so its PID is the one recorded), with a log.
bg() { name=$1; shift; ( exec env -i PATH="$PATH" HOME="$H" npm_config_cache="$H/.npm" GALLEY_HOME="$C/galley-home" "$@" ) > "$C/logs/$name.log" 2>&1 & echo $! > "$C/pids/$name.pid"; }
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
  hosting)
    cd "$REPO"
    mkdir -p "$C/hosting"
    bg hosting node --import tsx scripts/rehearse-hosting.mjs --fly-port 4793 --cloudflare-port 4794 --install-port 4796 --evidence "$C/hosting/evidence.json" --app-home "$C/galley-home"
    sleep 6
    # The variables it prints for the app (the fakes' addresses and the fake Fly.io's made-up key), for
    # "start.sh galley". Not its CLOUDFLARE_API_TOKEN: the app would use that for putting the site online
    # too, and the stand-in Cloudflare on 4791 (the "host" above) takes its own key.
    sed -nE "s/^  ((GALLEY_HOSTING_[A-Z_]*|FLY_API_TOKEN)=.*)$/export \1/p" "$C/logs/hosting.log" > "$C/hosting.env"
    sed -n '1,4p' "$C/logs/hosting.log" ;;
  galley)
    cd "$H"
    bg galley ${ANTHROPIC_API_KEY:+ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"} \
      GALLEY_DEPLOY_CLOUDFLARE_API="http://127.0.0.1:4791/client/v4" \
      GALLEY_DEPLOY_PROBE="http://127.0.0.1:4791/__probe?host={host}" \
      HOSTING_ENV="$C/hosting.env" \
      sh -c 'if [ -f "$HOSTING_ENV" ]; then . "$HOSTING_ENV"; fi; exec npx --yes "galley-cms@$0" "$1" --no-open --port 4790' "$V" "$H/sites/caddow"
    echo "Galley starting (log: $C/logs/galley.log; its Open: line carries the token)" ;;
  hosted)
    [ "${#HOSTED_PASSWORD}" -ge 12 ] || { echo "Set HOSTED_PASSWORD (12 characters or more) to a throwaway password."; exit 1; }
    mkdir -p "$C/hosted-home/home"
    cd "$C/hosted-home"
    bg hosted GALLEY_HOME="$C/hosted-home" GALLEY_PUBLIC_URL="http://cms.localhost:4797" GALLEY_PASSWORD="$HOSTED_PASSWORD" \
      npx --yes "galley-cms@$V" serve --host 127.0.0.1 --port 4797
    echo "Hosted install starting at http://cms.localhost:4797 (log: $C/logs/hosted.log)" ;;
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
