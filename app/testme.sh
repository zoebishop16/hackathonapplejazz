#!/bin/bash
# testme.sh: build the data, then run the API + dashboard on http://localhost:8000
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
python3 app/testme.py
