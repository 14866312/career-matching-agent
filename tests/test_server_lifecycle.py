"""Windows regression: a terminated launcher must not leave a listening server."""
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time

import pytest


def listening(port: int) -> bool:
    with socket.socket() as probe:
        probe.settimeout(0.2)
        return probe.connect_ex(('127.0.0.1', port)) == 0


@pytest.mark.skipif(sys.platform != 'win32', reason='Windows terminal lifecycle')
def test_server_releases_port_when_launcher_is_terminated(tmp_path):
    root = Path(__file__).resolve().parents[1]
    shell = shutil.which('powershell.exe') or shutil.which('pwsh.exe')
    assert shell
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    env = {**os.environ, 'PORT': str(port)}
    # Repeat on the same port to prove it can be reused after terminal termination.
    for attempt in range(2):
        with (tmp_path / f'server-{attempt}.log').open('w') as output:
            launcher = subprocess.Popen(
                [shell, '-NoProfile', '-Command',
                 '& ./start.ps1 -VenvPath .venv'],
                cwd=root, env=env, stdout=output, stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            try:
                deadline = time.monotonic() + 30
                while not listening(port) and time.monotonic() < deadline:
                    assert launcher.poll() is None, 'Launcher exited before listening'
                    time.sleep(0.1)
                assert listening(port), 'Server failed to listen'
                launcher.kill()
                launcher.wait(timeout=5)
                deadline = time.monotonic() + 5
                while listening(port) and time.monotonic() < deadline:
                    time.sleep(0.1)
                assert not listening(port), 'Server survived its launcher'
            finally:
                if launcher.poll() is None:
                    launcher.kill()
                    launcher.wait(timeout=5)
