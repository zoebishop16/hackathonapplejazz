#!/bin/bash
# manifestme.sh: write app/manifest.json for Posit Connect.
# Run on YOUR machine (never in CI) after any change to app/ files or requirements,
# then commit manifest.json. app/.python-version must name the same minor version.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
PY="${PYTHON:-python3}"
"$PY" app/build.py                      # the API serves these JSON files
"$PY" -m pip install -q rsconnect-python
cd app
# The course Connect server offers Python 3.12.4 only. If your Python differs,
# the manifest is written for the server's version (CI then installs the pinned
# requirements on that version before publishing). Override with CONNECT_PYTHON.
TARGET="${CONNECT_PYTHON:-3.12.4}"
"$PY" -m rsconnect.main write-manifest fastapi . --entrypoint app:app --overwrite \
  --override-python-version "$TARGET" \
  --exclude "__pycache__" --exclude "**/__pycache__" --exclude ".DS_Store" --exclude "**/.DS_Store" \
  --exclude "*.sh" --exclude "testme.py" --exclude "build.py"
echo "Wrote app/manifest.json for Connect Python $TARGET (written with $("$PY" -c 'import platform;print(platform.python_version())'))"
