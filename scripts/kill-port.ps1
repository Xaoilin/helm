param(
  [Parameter(Mandatory = $true)]
  [int]$Port
)

function Get-ListeningProcesses([int]$TargetPort) {
  @(Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
}

$processIds = Get-ListeningProcesses -TargetPort $Port

if (-not $processIds) {
  Write-Output "No listening process found on port $Port."
  exit 0
}

foreach ($processId in $processIds) {
  try {
    $process = Get-Process -Id $processId -ErrorAction Stop
    Stop-Process -Id $processId -Force -ErrorAction Stop
    Write-Output "Stopped process $($process.ProcessName) ($processId) on port $Port."
  } catch {
    Write-Output "Failed to stop process $processId on port ${Port}: $($_.Exception.Message)"
    exit 1
  }
}

for ($attempt = 1; $attempt -le 10; $attempt++) {
  Start-Sleep -Milliseconds 400
  $remaining = Get-ListeningProcesses -TargetPort $Port
  if (-not $remaining) {
    Write-Output "Port $Port is no longer listening."
    exit 0
  }

  foreach ($processId in $remaining) {
    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
      Write-Output "Retried stop for process $processId on port $Port."
    } catch {}
  }
}

$stillListening = Get-ListeningProcesses -TargetPort $Port
if ($stillListening) {
  Write-Output "Port $Port is still listening after retries: $($stillListening -join ', ')."
  exit 1
}

Write-Output "Port $Port is no longer listening."
exit 0
