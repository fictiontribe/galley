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
#   start.sh people              a hosted install with Caddow and nobody signed up, on http://cms.localhost:4801
#                                (README.md, "Accounts"); prints a one-time Setup: link
#   start.sh media               the stand-in bucket on 4805 (its public files on 4806), for the media-bucket step;
#                                run it before "galley", which then reaches it as https://media.example.com
#   start.sh second              a second Galley with a home of its own, on a copy of Lowfield, on 4802
#                                (the themes step brings a theme into it)
#   start.sh stop                stop everything this script started (by PID)
#
# CAPTURE_DIR (default /tmp/galley-capture) holds home/, galley-home/, hosted-home/, logs/ and pids/.
# GALLEY_VERSION (default 0.3.1) is the galley-cms release to run.
# GALLEY_CLI, when set, is a built CLI to run instead of a release: the galley.mjs made by
#   GALLEY_CLI_DIST=<folder> node packages/cli/build.mjs   (README.md, "Pictures of what isn't released yet")
# The assistant: set ANTHROPIC_API_KEY in your own shell before "start.sh galley";
# it is passed to that one process and to nothing else. This script reads no key file.
# FAKES / WP_FAKES may point at copies of the test helpers (see README.md).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../../.." && pwd)
C=${CAPTURE_DIR:-/tmp/galley-capture}
V=${GALLEY_VERSION:-0.3.1}
# The command that runs the app. Split into words where it is used, on purpose.
if [ -n "$GALLEY_CLI" ]; then G="node $GALLEY_CLI"; else G="npx --yes galley-cms@$V"; fi
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
      [ -d "$H/sites/$s" ] || clean $G new "$s" --starter "$s" --no-start --dir "$H/sites"
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
  media)
    cd "$REPO"
    bg media MEDIA_FAKES="${MEDIA_FAKES:-$REPO/packages/core/test/media-storage/fakes}" node --import tsx "$HERE/serve-media.mts" 4805 4806
    sleep 4
    # What "start.sh galley" needs so the made-up names in the pictures reach the stand-in (media-names.mjs).
    printf 'export NODE_OPTIONS="--import=%s"\nexport CAPTURE_NAMES="media.example.com=4806/caddow-media,0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com=4805"\n' "$HERE/media-names.mjs" > "$C/media.env"
    cat "$C/logs/media.log" ;;
  galley)
    cd "$H"
    bg galley ${ANTHROPIC_API_KEY:+ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"} \
      GALLEY_DEPLOY_CLOUDFLARE_API="http://127.0.0.1:4791/client/v4" \
      GALLEY_DEPLOY_PROBE="http://127.0.0.1:4791/__probe?host={host}" \
      HOSTING_ENV="$C/hosting.env" MEDIA_ENV="$C/media.env" \
      sh -c 'if [ -f "$HOSTING_ENV" ]; then . "$HOSTING_ENV"; fi; if [ -f "$MEDIA_ENV" ]; then . "$MEDIA_ENV"; fi; exec $0 "$1" --no-open --port 4790' "$G" "$H/sites/caddow"
    echo "Galley starting (log: $C/logs/galley.log; its Open: line carries the token)" ;;
  hosted)
    [ "${#HOSTED_PASSWORD}" -ge 12 ] || { echo "Set HOSTED_PASSWORD (12 characters or more) to a throwaway password."; exit 1; }
    mkdir -p "$C/hosted-home/home"
    cd "$C/hosted-home"
    bg hosted GALLEY_HOME="$C/hosted-home" GALLEY_PUBLIC_URL="http://cms.localhost:4797" GALLEY_PASSWORD="$HOSTED_PASSWORD" \
      $G serve --host 127.0.0.1 --port 4797
    echo "Hosted install starting at http://cms.localhost:4797 (log: $C/logs/hosted.log)" ;;
  people)
    [ -f "$C/people/sites.json" ] || { echo "Make $C/people/sites.json first (README.md, Accounts)."; exit 1; }
    cd "$C/people"
    bg people GALLEY_HOME="$C/people" GALLEY_PUBLIC_URL="http://cms.localhost:4801" \
      $G serve --host 127.0.0.1 --port 4801
    sleep 15; grep -c "^Setup:" "$C/logs/people.log" >/dev/null && echo "People install up (its Setup: link is in $C/logs/people.log)" ;;
  second)
    # Another Galley with a home of its own, open on a copy of Lowfield: "the other computer" a theme is
    # brought into. Run "sites" first.
    mkdir -p "$C/second-home/sites"
    [ -d "$C/second-home/sites/lowfield" ] || git clone -q "$H/sites/lowfield" "$C/second-home/sites/lowfield"
    cd "$C/second-home"
    bg second GALLEY_HOME="$C/second-home" $G "$C/second-home/sites/lowfield" --no-open --port 4802
    echo "Second Galley starting (log: $C/logs/second.log; its Open: line carries the token)" ;;
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
