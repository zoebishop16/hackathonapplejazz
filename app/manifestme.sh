#!/bin/bash
# manifestme.sh: write app/manifest.json for Posit Connect.
# Run on YOUR machine (never in CI) after any change to app/ files or requirements,
# with the same Python as app/.python-version, then commit manifest.json.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
PY="${PYTHON:-python3}"
"$PY" app/build.py                      # the API serves these JSON files
"$PY" -m pip install -q rsconnect-python
cd app
"$PY" -m rsconnect.main write-manifest fastapi . --entrypoint app:app --overwrite \
  --exclude "__pycache__" --exclude "**/__pycache__" --exclude ".DS_Store" --exclude "**/.DS_Store" \
  --exclude "*.sh" --exclude "testme.py" --exclude "build.py"
echo "Wrote app/manifest.json (python $("$PY" -c 'import platform;print(platform.python_version())'))"
