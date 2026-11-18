$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$python = Join-Path $projectRoot '.venv-whisperx/Scripts/python.exe'
if (!(Test-Path -LiteralPath $python)) {
    throw 'Create the environment with: py -3.11 -m venv .venv-whisperx; then install transcription/requirements.txt using that environment.'
}
# Include newly installed FFmpeg even when this terminal predates installation.
$env:Path += ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
if (!(Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    throw 'FFmpeg is missing. Install it with: winget install --id Gyan.FFmpeg --exact'
}
& $python -m uvicorn transcription.main:app --host 127.0.0.1 --port 8000
exit $LASTEXITCODE
