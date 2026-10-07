#!/usr/bin/env bash
# Starts the local environment: Mailpit (fake inbox) + PHP's built-in server
# with the production-like router. Run from the project root:
#   tools/dev-server.sh            → http://127.0.0.1:8080  (site)
#                                    http://127.0.0.1:8080/admin/
#                                    http://127.0.0.1:8025  (Mailpit inbox)
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8080}"
PHP_BIN="${PHP_BIN:-php}"

if command -v mailpit >/dev/null 2>&1; then
  if ! curl -s -o /dev/null http://127.0.0.1:8025; then
    mailpit --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025 >/dev/null 2>&1 &
    echo "Mailpit started → http://127.0.0.1:8025"
  fi
  # Route PHP's mail() (used by the public contact form) into Mailpit too,
  # so no local test can ever e-mail the real business inbox.
  SENDMAIL="$(command -v mailpit) sendmail -S 127.0.0.1:1025"
else
  echo "Mailpit not found — PHP mail() is disabled locally (install: brew install mailpit)."
  SENDMAIL="/usr/bin/false"
fi

echo "Site  → http://127.0.0.1:${PORT}"
echo "Admin → http://127.0.0.1:${PORT}/admin/"
exec "$PHP_BIN" -d "sendmail_path=${SENDMAIL}" -d upload_max_filesize=16M -d post_max_size=20M -d memory_limit=256M \
  -S "127.0.0.1:${PORT}" cms/dev/router.php
