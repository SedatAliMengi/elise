# Sets up Elise's offline voice engine (one time, ~300 MB download):
#   powershell -ExecutionPolicy Bypass -File voice\setup.ps1
# Creates voice\.venv, installs the libraries, and pre-downloads both speech
# models into Elise's data folder so the first "Hey Elise" is instant.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venv = Join-Path $root ".venv"
$py = Join-Path $venv "Scripts\python.exe"

if (-not (Test-Path $py)) {
    Write-Host "Creating virtual environment..."
    python -m venv $venv
}

Write-Host "Installing voice libraries..."
& $py -m pip install --upgrade pip -q
& $py -m pip install --timeout 60 --retries 10 -r (Join-Path $root "requirements.txt")

$models = Join-Path $env:APPDATA "com.enigma.elise\models"
New-Item -ItemType Directory -Force $models | Out-Null

Write-Host "Downloading speech models into $models ..."
& $py -c @"
import os, sys, urllib.request, zipfile
models = sys.argv[1]
name = 'vosk-model-small-en-us-0.15'
if not os.path.isdir(os.path.join(models, name)):
    z = os.path.join(models, name + '.zip')
    print('  wake word model (40 MB)...')
    urllib.request.urlretrieve(f'https://alphacephei.com/vosk/models/{name}.zip', z)
    zipfile.ZipFile(z).extractall(models)
    os.remove(z)
print('  speech-to-text model (~145 MB)...')
from faster_whisper import WhisperModel
WhisperModel('base.en', device='cpu', compute_type='int8', download_root=os.path.join(models, 'whisper'))
print('Done.')
"@ $models

Write-Host "Voice engine ready. Restart Elise (tray > Quit, then open it again)."
