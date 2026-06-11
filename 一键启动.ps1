param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$HermesArgs
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$env:HERMES_HOME = Join-Path $projectRoot 'data\hermes-home'
$frontendUrl = 'http://127.0.0.1:24318/'
$frontendCommand = "Set-Location '$projectRoot'; node .\ui-cockpit\server.mjs"

Write-Host '1/3 启动前端服务' -ForegroundColor Yellow
Start-Process powershell -WindowStyle Normal -ArgumentList @(
  '-NoExit',
  '-ExecutionPolicy', 'Bypass',
  '-Command', $frontendCommand
)

Write-Host '2/3 打开面板网页' -ForegroundColor Yellow
$chromeExe = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (Test-Path $chromeExe) {
  Start-Process $chromeExe -ArgumentList $frontendUrl
} else {
  Start-Process $frontendUrl
}

Write-Host '3/3 启动 Hermes 主脑' -ForegroundColor Yellow
Set-Location $projectRoot
if ($HermesArgs -and $HermesArgs.Count -gt 0) {
  & hermes @HermesArgs
} else {
  & hermes
}