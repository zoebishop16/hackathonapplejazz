#!/bin/bash
# deployme.sh: publish app/ to the course Posit Connect server from your machine.
# Needs CONNECT_SERVER and CONNECT_API_KEY in your shell or in app/.env (gitignored).
# Never paste the key into a file that is committed, or into chat.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
PY="${PYTHON:-python3}"
if [ -f ".env" ]; then
  # shellcheck disable=SC1091
  source .env
fi
"$PY" -m pip install -q rsconnect-python
"$PY" -m rsconnect.main deploy manifest manifest.json \
  ${CONNECT_SERVER:+--server "$CONNECT_SERVER"} \
  ${CONNECT_API_KEY:+--api-key "$CONNECT_API_KEY"} \
  --title "Dock Watch API"
