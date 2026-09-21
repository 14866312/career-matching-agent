param([string]$VenvPath = '.venv', [int]$Port = 0)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$pythonExe = Join-Path ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot $VenvPath))) 'Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) { throw 'Python environment missing. Run ./安装环境.ps1 first.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'frontend/dist/index.html'))) { throw 'Frontend build missing. Run ./安装环境.ps1 first.' }
& $pythonExe -c 'import fastapi, uvicorn, pydantic, httpx, dotenv, multipart, pypdf, docx, pandas, xlrd'
if ($LASTEXITCODE -ne 0) { throw 'Dependencies missing. Run ./安装环境.ps1 first.' }
if ($Port -ne 0) {
    if ($Port -lt 1 -or $Port -gt 65535) { throw 'Port must be between 1 and 65535.' }
    $env:PORT = [string]$Port
}
& $pythonExe (Join-Path $PSScriptRoot 'backend/run.py')
if ($LASTEXITCODE -ne 0) { throw 'Local service failed. See the error above; for port conflicts use -Port 8001.' }
