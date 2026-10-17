"""Run Dock Watch locally with one command, from the repo root:

    python3 app/testme.py

Builds the JSON from data/ (app/build.py), then starts the FastAPI app with
uvicorn on http://localhost:8000:
    /dashboard/  the dashboard      /docs  interactive API docs
Stop it with Ctrl+C. Needs: pip install -r app/requirements.txt
Set PORT to use another port.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import build  # noqa: E402


def main():
    """Build bundled datasets and their index; the launcher then starts the local API server."""
    build.main()
    try:
        import uvicorn
    except ImportError:
        sys.exit("uvicorn is not installed: run  python3 -m pip install -r app/requirements.txt")
    port = int(os.environ.get("PORT", "8000"))
    print(f"Dock Watch: dashboard http://localhost:{port}/dashboard/  ·  API docs http://localhost:{port}/docs")
    os.chdir(HERE)
    uvicorn.run("app:app", host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
