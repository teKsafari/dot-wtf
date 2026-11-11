#!/bin/sh
# Coolify gives this container a BIND mount for /data, and a bind keeps the
# host directory's root ownership, so the image's build-time chown is undone at
# runtime and a non-root process cannot write uploads. The container therefore
# starts as root, fixes the mount it was given, and drops to node before the
# server runs.
#
# Two things this got wrong once, both fixed here:
#  - Alpine's setpriv is BusyBox's and has no --reuid, so the drop uses su.
#  - corepack was enabled as root, leaving its pnpm under /root/.cache, which
#    node cannot read; and su alone leaves HOME=/root, so pnpm also tried to
#    read /root/.npmrc. Both are pointed at node's own home below.
set -e

: "${UPLOADS_DIR:=/data/uploads}"
: "${COREPACK_HOME:=/home/node/.cache/node/corepack}"

mkdir -p "$UPLOADS_DIR" "$COREPACK_HOME"
chown -R node:node "$UPLOADS_DIR" 2>/dev/null || true
chown -R node:node /home/node 2>/dev/null || true

# "$@" is the CMD. Pass it through su with node's environment.
exec su node -s /bin/sh -c 'export HOME=/home/node COREPACK_HOME="$0"; shift; exec "$@"' \
  "$COREPACK_HOME" sh "$@"
