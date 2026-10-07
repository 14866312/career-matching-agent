"""Local single-address entry point; works independently of the current directory."""
import argparse
import os
import socket
import sys
from pathlib import Path

from dotenv import load_dotenv
import uvicorn

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / '.env')

def watch_windows_parent(parent_pid: int) -> None:
    """Exit when the launching terminal ends, even without Ctrl+C."""
    if sys.platform != 'win32':
        return
    import ctypes
    import threading
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    handle = kernel32.OpenProcess(0x00100000, False, parent_pid)  # SYNCHRONIZE
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())

    def wait_for_parent() -> None:
        result = kernel32.WaitForSingleObject(handle, 0xFFFFFFFF)
        kernel32.CloseHandle(handle)
        if result == 0:
            os._exit(0)

    threading.Thread(target=wait_for_parent, daemon=True).start()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--parent-pid', type=int, default=os.getppid())
    args = parser.parse_args()
    watch_windows_parent(args.parent_pid)
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
