"""Local single-address entry point; works independently of the current directory."""
import os
import socket
import sys
from pathlib import Path

from dotenv import load_dotenv
import uvicorn

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / '.env')

if __name__ == '__main__':
    try:
        port = int(os.environ.get('PORT', '8000'))
        if not 1 <= port <= 65535:
            raise ValueError()
    except ValueError:
        sys.exit('PORT must be an integer between 1 and 65535.')
    try:
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', port))
    except OSError:
        sys.exit(f'Port {port} is unavailable. Stop the existing process or change PORT in .env.')
    uvicorn.run('backend.app.main:app', host='127.0.0.1', port=port, reload=False, access_log=False)
