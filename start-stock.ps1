# start-stock.ps1
param(
  [string]$ProjectPath = "D:\stockinmolino"
)

# stop on error
$ErrorActionPreference = "Stop"

Write-Host "Switching to $ProjectPath"
Set-Location -Path $ProjectPath

# Optional: show versions so you know Node/npm are found
try {
  Write-Host "Node:" (node -v)
  Write-Host "npm: " (npm -v)
} catch {
  Write-Error "node or npm not found in PATH."
  exit 1
}

Write-Host "Starting app (npm start)..."
npm start
