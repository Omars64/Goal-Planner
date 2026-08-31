$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BackendDir = Join-Path $ProjectDir "backend"
$Python = Join-Path $BackendDir ".venv\Scripts\python.exe"

if (-not (Test-Path $Python)) {
    python -m venv (Join-Path $BackendDir ".venv")
    & $Python -m pip install -r (Join-Path $BackendDir "requirements.txt")
}

$Api = Start-Process -FilePath $Python -ArgumentList "-m", "uvicorn", "app.main:app", "--reload", "--host", "0.0.0.0", "--port", "8000" -WorkingDirectory $BackendDir -PassThru
try {
    Set-Location $ProjectDir
    npm run dev
}
finally {
    Stop-Process -Id $Api.Id -ErrorAction SilentlyContinue
}

