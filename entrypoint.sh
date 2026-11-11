#!/bin/sh
# Application photos live on a mount, and Coolify can only attach a BIND mount.
# A bind keeps the host directory's ownership, so the image's build-time chown
# is replaced at runtime by a root-owned directory that the non-root user cannot
# write to. A named volume would not have this problem, but the API cannot make
# one. So the container starts as root, fixes the mount it was given, and drops
# to node before the server runs.
set -e

: "${UPLOADS_DIR:=/data/uploads}"
for directory in "$UPLOADS_DIR"; do
	[ -d "$directory" ] || mkdir -p "$directory"
	chown -R node:node "$directory" 2>/dev/null || true
done

if command -v setpriv >/dev/null 2>&1; then
	exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec su node -s /bin/sh -c 'exec "$@"' -- sh "$@"
