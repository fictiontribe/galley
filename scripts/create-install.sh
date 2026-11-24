#!/bin/sh
# Creates ONE hosted install on this server: the editor for one site, as its
# own compose project with its own volume, behind the Caddy that every
# editor on this server shares. Ten sites are ten runs of this script, and
# ten installs that share nothing but the proxy in front.
#
#   scripts/create-install.sh <name> <repository> <address> [options]
#
#   scripts/create-install.sh acme git@github.com:example/acme-site.git cms.example.com --dry-run
#
# The files are written by the image itself (`host recipe`), so they always
# match the version that will run. Nothing here needs Node or this
# repository on the server: only Docker with the compose plugin.
#
# See docs/cloud-install.md.
set -eu

IMAGE="${GALLEY_IMAGE:-}"
DIR="${GALLEY_INSTALLS_DIR:-./galley-installs}"
FOLDER=""
PREVIEW=""
LIVE=""
DRY_RUN=0
WAIT_SECONDS=180

usage() {
  cat <<'EOF'
Usage: create-install.sh <name> <repository> <address> [options]

  <name>         A short name for the install: lowercase letters, digits, dashes
  <repository>   The site's repository: git@host:owner/name.git or https://…
  <address>      The editor's address, without https://: cms.example.com

Options
  --image <ref>            The image to run (or set GALLEY_IMAGE)
  --dir <folder>           Where installs are kept (default ./galley-installs, or GALLEY_INSTALLS_DIR)
  --folder <path>          The site's folder inside the repository, when it isn't the top
  --preview-address <name> The preview's address (default: worked out from <address>)
  --live-address <name>    The live comparison's address (default: worked out from <address>)
  --dry-run                Print everything that would be written and run; change nothing
  -h, --help               Show this help

It creates: <dir>/<name>/ (compose.yaml, .env), the shared proxy in
<dir>/proxy/ the first time, and <dir>/proxy/sites/<name>.caddy — then starts
them and prints the one-time setup link. It never touches another install.
EOF
}

say() { printf '%s\n' "$*"; }
fail() { printf '%s\n' "$*" >&2; exit 1; }

POSITIONAL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --image) [ $# -ge 2 ] || fail "--image needs a value."; IMAGE="$2"; shift 2 ;;
    --dir) [ $# -ge 2 ] || fail "--dir needs a value."; DIR="$2"; shift 2 ;;
    --folder) [ $# -ge 2 ] || fail "--folder needs a value."; FOLDER="$2"; shift 2 ;;
    --preview-address) [ $# -ge 2 ] || fail "--preview-address needs a value."; PREVIEW="$2"; shift 2 ;;
    --live-address) [ $# -ge 2 ] || fail "--live-address needs a value."; LIVE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --*) fail "$1 isn't an option here. Run with --help." ;;
    *) POSITIONAL="$POSITIONAL
$1"; shift ;;
  esac
done

NAME=$(printf '%s' "$POSITIONAL" | sed -n '2p')
REPOSITORY=$(printf '%s' "$POSITIONAL" | sed -n '3p')
ADDRESS=$(printf '%s' "$POSITIONAL" | sed -n '4p')
EXTRA=$(printf '%s' "$POSITIONAL" | sed -n '5p')

if [ -z "$NAME" ] || [ -z "$REPOSITORY" ] || [ -z "$ADDRESS" ] || [ -n "$EXTRA" ]; then
  usage >&2
  exit 2
fi
case "$NAME" in
  proxy) fail "“proxy” is the shared proxy's own folder. Choose another name." ;;
  *[!a-z0-9-]*|-*|*-) fail "The name “$NAME” can only have lowercase letters, digits and dashes, and can't start or end with a dash." ;;
esac
case "$ADDRESS" in
  *://*|*/*|*" "*) fail "Give the address without https:// and without a path: cms.example.com" ;;
esac
[ -n "$IMAGE" ] || fail "Say which image to run: --image <ref>, or set GALLEY_IMAGE."

INSTALL_DIR="$DIR/$NAME"
PROXY_DIR="$DIR/proxy"

# The one-time setup code. Only its SHA-256 is given to the install; the code
# itself is printed once at the end, inside the setup link, and kept nowhere.
random_hex() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 24
  else od -An -N24 -tx1 /dev/urandom | tr -d ' \n'
  fi
}
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then printf '%s' "$1" | sha256sum | cut -d' ' -f1
  else printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1
  fi
}

# The image writes its own files. $1: where (a folder inside the container, or
# "-" for the screen); $2: the setup code's SHA-256; the rest: extra arguments
# for `docker run` (the folder to write into).
run_recipe() {
  out="$1"; sha="$2"; shift 2
  set -- "$@" "$IMAGE" host recipe --name "$NAME" --address "$ADDRESS" --repository "$REPOSITORY" \
    --proxy shared-proxy --image "$IMAGE" --setup-token-sha256 "$sha" --out "$out"
  [ -z "$FOLDER" ] || set -- "$@" --folder "$FOLDER"
  [ -z "$PREVIEW" ] || set -- "$@" --preview-address "$PREVIEW"
  [ -z "$LIVE" ] || set -- "$@" --live-address "$LIVE"
  docker run --rm --user "$(id -u):$(id -g)" "$@"
}

if [ "$DRY_RUN" -eq 1 ]; then
  say "Dry run: nothing is written, started or changed."
  say ""
  say "Would create the install “$NAME” for $REPOSITORY at https://$ADDRESS"
  say "  folder        $INSTALL_DIR/  (compose.yaml, .env)"
  if [ -e "$PROXY_DIR/compose.yaml" ]; then
    say "  shared proxy  $PROXY_DIR/  (already there: left as it is)"
  else
    say "  shared proxy  $PROXY_DIR/  (compose.yaml, Caddyfile — first install on this server)"
  fi
  say "  proxy entry   $PROXY_DIR/sites/$NAME.caddy"
  say "  volume        galley-${NAME}_data  (the install's whole state)"
  say "  network       galley-proxy  (created if it isn't there)"
  [ ! -e "$INSTALL_DIR" ] || say "  ! $INSTALL_DIR already exists: the real run would stop here rather than overwrite it."
  say ""
  say "Would run:"
  say "  docker run --rm $IMAGE host recipe --name $NAME --address $ADDRESS --repository $REPOSITORY --proxy shared-proxy …"
  say "  docker network create galley-proxy            (if missing)"
  say "  docker compose -f $PROXY_DIR/compose.yaml up -d"
  say "  docker compose -f $INSTALL_DIR/compose.yaml up -d"
  say "  docker compose -f $PROXY_DIR/compose.yaml exec caddy caddy reload --config /etc/caddy/Caddyfile"
  say ""
  if command -v docker >/dev/null 2>&1 && docker image inspect "$IMAGE" >/dev/null 2>&1; then
    say "The files it would write (from the image itself, with a placeholder for the setup code's SHA-256):"
    say ""
    run_recipe - "0000000000000000000000000000000000000000000000000000000000000000" || true
  else
    say "(The image $IMAGE isn't on this server yet, so the files can't be shown; the real run pulls it.)"
  fi
  say ""
  say "Then: point $ADDRESS and its preview and live names at this server, and open the one-time setup link the real run prints."
  exit 0
fi

command -v docker >/dev/null 2>&1 || fail "Docker isn't installed on this server. Install it, then run this again."
docker compose version >/dev/null 2>&1 || fail "Docker's compose plugin isn't installed (docker compose). Install it, then run this again."
[ ! -e "$INSTALL_DIR" ] || fail "$INSTALL_DIR already exists. Each install has its own name; choose another, or remove that one first."

CODE=$(random_hex)
CODE_SHA=$(sha256_of "$CODE")
[ ${#CODE} -ge 48 ] || fail "A setup code couldn't be made on this server (no openssl and no /dev/urandom)."

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
chmod 755 "$STAGE"

say "Writing the files for “$NAME”…"
run_recipe /out "$CODE_SHA" -v "$STAGE:/out" >/dev/null
[ -f "$STAGE/compose.yaml" ] && [ -f "$STAGE/.env" ] && [ -f "$STAGE/$NAME.caddy" ] || fail "The image didn't write the files expected. Is $IMAGE this app's image?"

mkdir -p "$INSTALL_DIR" "$PROXY_DIR/sites"
cp "$STAGE/compose.yaml" "$STAGE/.env" "$INSTALL_DIR/"
if [ ! -e "$PROXY_DIR/compose.yaml" ]; then
  cp "$STAGE/proxy/compose.yaml" "$STAGE/proxy/Caddyfile" "$PROXY_DIR/"
fi
cp "$STAGE/$NAME.caddy" "$PROXY_DIR/sites/$NAME.caddy"

docker network inspect galley-proxy >/dev/null 2>&1 || docker network create galley-proxy >/dev/null

say "Starting it…"
docker compose -f "$PROXY_DIR/compose.yaml" up -d
docker compose -f "$INSTALL_DIR/compose.yaml" up -d
# The proxy reads the new site's entry; a proxy that only just started has read it already.
docker compose -f "$PROXY_DIR/compose.yaml" exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true

say "Waiting for it to answer…"
CONTAINER=$(docker compose -f "$INSTALL_DIR/compose.yaml" ps -q editor)
waited=0
status="starting"
while [ "$waited" -lt "$WAIT_SECONDS" ]; do
  status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER" 2>/dev/null || echo "gone")
  [ "$status" != "healthy" ] || break
  [ "$status" != "gone" ] && [ "$status" != "exited" ] || break
  sleep 3
  waited=$((waited + 3))
done

if [ "$status" != "healthy" ]; then
  say ""
  say "The install was created but isn't answering yet (it is “$status”). Its log says why:"
  say "  docker compose -f $INSTALL_DIR/compose.yaml logs editor"
  say "Nothing else on this server was changed. To take it away again:"
  say "  docker compose -f $INSTALL_DIR/compose.yaml down -v && rm -r $INSTALL_DIR $PROXY_DIR/sites/$NAME.caddy"
  exit 1
fi

PREVIEW_SHOWN=$(sed -n 's/^GALLEY_PREVIEW_URL=https:\/\///p' "$INSTALL_DIR/.env")
LIVE_SHOWN=$(sed -n 's/^GALLEY_LIVE_VIEW_URL=https:\/\///p' "$INSTALL_DIR/.env")

say ""
say "“$NAME” is running."
say ""
say "1. Point these three names at this server (an A record each, or AAAA):"
say "     $ADDRESS"
say "     $PREVIEW_SHOWN"
say "     $LIVE_SHOWN"
say "   The proxy gets their certificates by itself once they point here."
say ""
say "2. Open the setup link, once, to create the owner's account and connect the site:"
say "     https://$ADDRESS/setup?token=$CODE"
say "   It is shown only now and stops working once the owner's account exists."
say ""
say "To take this install away, and nothing else:"
say "  docker compose -f $INSTALL_DIR/compose.yaml down -v && rm -r $INSTALL_DIR $PROXY_DIR/sites/$NAME.caddy"
say "  docker compose -f $PROXY_DIR/compose.yaml exec caddy caddy reload --config /etc/caddy/Caddyfile"
