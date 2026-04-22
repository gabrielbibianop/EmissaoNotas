$ErrorActionPreference = "Stop"

$pgRoot = "C:\Program Files\PostgreSQL\17"
$binDir = Join-Path $pgRoot "bin"
$dataDir = Join-Path $pgRoot "data"

if (-not (Test-Path (Join-Path $binDir "pg_ctl.exe"))) {
  throw "Nao encontrei pg_ctl.exe em $binDir. Reinstale o PostgreSQL 17 com o instalador interativo."
}

if (-not (Test-Path (Join-Path $binDir "createdb.exe"))) {
  throw "Nao encontrei createdb.exe em $binDir. Na reinstalacao, marque Command Line Tools."
}

if (-not (Test-Path (Join-Path $dataDir "PG_VERSION"))) {
  throw "Nao encontrei a pasta de dados em $dataDir. Na reinstalacao, mantenha o data directory padrao."
}

try {
  Start-Service -Name "postgresql-x64-17" -ErrorAction Stop
  Start-Sleep -Seconds 3
} catch {
  & (Join-Path $binDir "pg_ctl.exe") -D $dataDir start
  Start-Sleep -Seconds 5
}

$env:PGPASSWORD = "postgres"
& (Join-Path $binDir "dropdb.exe") -h localhost -p 5432 -U postgres portal_fiscal 2>$null
& (Join-Path $binDir "createdb.exe") -h localhost -p 5432 -U postgres portal_fiscal

if ($LASTEXITCODE -ne 0) {
  throw "Nao consegui criar o banco portal_fiscal."
}

Write-Host "Banco portal_fiscal criado com sucesso."
