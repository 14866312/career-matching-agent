param([string]$VenvPath = '.venv', [switch]$SkipFrontend)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$venvFull = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $VenvPath))
$pythonExe = Join-Path $venvFull 'Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) {
    $basePython = Get-Command python -ErrorAction Stop
    & $basePython.Source -c 'import sys; assert sys.version_info[:2] == (3,12), "Python 3.12 is required"'
    if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.12 and retry.' }
    & $basePython.Source -m venv $venvFull
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create Python environment.' }
}
& $pythonExe -m pip install -r (Join-Path $PSScriptRoot 'Python依赖锁定.txt')
if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
& $pythonExe -m pip check
if ($LASTEXITCODE -ne 0) { throw 'Python dependency validation failed.' }
if (-not $SkipFrontend) {
    $npmExe = (Get-Command npm.cmd -ErrorAction Stop).Source
    Push-Location (Join-Path $PSScriptRoot 'frontend')
    try {
        & $npmExe ci
        if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
        & $npmExe run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    } finally { Pop-Location }
}
Write-Host 'Installation complete. Configure .env locally if AI is needed, then run ./启动服务.ps1.'
