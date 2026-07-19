$ErrorActionPreference = 'Stop'
$hostsPath = 'C:\Windows\System32\drivers\etc\hosts'
$resolved = (Resolve-Path -LiteralPath $hostsPath).Path
if ($resolved -ne $hostsPath) {
    throw "Unexpected hosts path: $resolved"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = "C:\Windows\System32\drivers\etc\hosts.codex-backup-$stamp"
$pattern = '^\s*(?:127\.0\.0\.1|::1)\s+clients(?:[0-9])?\.google\.com(?:\s|$)'
$lines = Get-Content -LiteralPath $hostsPath
$removed = @($lines | Where-Object { $_ -match $pattern })

if ($removed.Count -eq 0) {
    throw 'No matching Google clients entries found; no changes made.'
}

Copy-Item -LiteralPath $hostsPath -Destination $backupPath
$kept = @($lines | Where-Object { $_ -notmatch $pattern })
Set-Content -LiteralPath $hostsPath -Value $kept -Encoding ascii
ipconfig /flushdns | Out-Null

@(
    "BACKUP=$backupPath"
    "REMOVED=$($removed.Count)"
) | Set-Content -LiteralPath 'C:\projects\my-session\fix-chrome-extension-hosts.result.txt' -Encoding utf8
