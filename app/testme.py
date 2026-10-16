"""Run Dock Watch locally with one command, from the repo root:

    python3 app/testme.py

Builds the JSON from data/ (app/build.py), then serves app/site/ at
http://localhost:8000. Stop it with Ctrl+C. Standard library only.
Set PORT to use another port.
"""

import functools
import http.server
import os
import socketserver
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from app import build  # noqa: E402


def main():
    build.main()
    port = int(os.environ.get("PORT", "8000"))
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.join(HERE, "site"))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Dock Watch running at http://localhost:{port}  (Ctrl+C to stop)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
