# Lance BudgeTracker en local : Docker (base, MinIO, Mailpit), migrations, API et front.
# Usage (depuis la racine du projet) : powershell -ExecutionPolicy Bypass -File .\start-dev.ps1
param([int]$WebPort = 4300)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Wait-Until([scriptblock]$Test, [int]$Seconds, [string]$What) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try { if (& $Test) { return } } catch { }
    Start-Sleep -Seconds 2
  }
  throw "Delai depasse : $What"
}

# 1. Docker Desktop
$dockerExe = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Demarrage de Docker Desktop...'
  Start-Process $dockerExe
  Wait-Until { docker info *> $null; $LASTEXITCODE -eq 0 } 240 'Docker Desktop ne repond pas'
}

# 2. Conteneurs et base
Write-Host 'Conteneurs (base, MinIO, Mailpit)...'
docker compose up -d
if ($LASTEXITCODE -ne 0) { throw 'docker compose up a echoue' }
Wait-Until { docker compose exec -T db pg_isready *> $null; $LASTEXITCODE -eq 0 } 60 'base de donnees'

# 3. Migrations
Write-Host 'Migrations...'
npm run db:migrate -w api
if ($LASTEXITCODE -ne 0) { throw 'migrations en echec' }

# 4. API et front, chacun dans sa fenetre pour pouvoir les arreter (Ctrl+C)
Write-Host 'Build de l''API...'
npm run build -w api
if ($LASTEXITCODE -ne 0) { throw 'build API en echec' }
Start-Process cmd.exe -ArgumentList '/k', "cd /d `"$PSScriptRoot`" && npm run start -w api" -WindowStyle Normal
Start-Process cmd.exe -ArgumentList '/k', "cd /d `"$PSScriptRoot`" && npm start -w web -- --port $WebPort" -WindowStyle Normal

Wait-Until { (Invoke-WebRequest -UseBasicParsing 'http://localhost:3000/api/health' -TimeoutSec 3).StatusCode -eq 200 } 120 'API'
Wait-Until { (Invoke-WebRequest -UseBasicParsing "http://localhost:$WebPort" -TimeoutSec 3).StatusCode -eq 200 } 180 'front'

Write-Host ''
Write-Host "Pret : http://localhost:$WebPort  (API : http://localhost:3000/api/health, Mailpit : http://localhost:8025)"
Start-Process "http://localhost:$WebPort"
