const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { normalizeExecutable } = require("./policy.cjs");

const execFileAsync = promisify(execFile);
let cache = { at: 0, items: [] };

const POWERSHELL_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$results = New-Object System.Collections.Generic.List[object]
$shell = New-Object -ComObject WScript.Shell
$startRoots = @(
  [Environment]::GetFolderPath('CommonStartMenu'),
  [Environment]::GetFolderPath('StartMenu')
) | Where-Object { $_ }

foreach ($root in $startRoots) {
  Get-ChildItem -LiteralPath $root -Recurse -Filter '*.lnk' -File | ForEach-Object {
    $shortcut = $shell.CreateShortcut($_.FullName)
    $target = [Environment]::ExpandEnvironmentVariables([string]$shortcut.TargetPath)
    if ($target -and [IO.Path]::GetExtension($target) -ieq '.exe') {
      $results.Add([pscustomobject]@{
        name = [IO.Path]::GetFileNameWithoutExtension($_.Name)
        executable = [IO.Path]::GetFileName($target)
        path = $target
        source = 'Start menu'
      })
    }
  }
}

$registryRoots = @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)

foreach ($registryRoot in $registryRoots) {
  Get-ItemProperty $registryRoot | Where-Object { $_.DisplayName -and $_.DisplayIcon } | ForEach-Object {
    $icon = [Environment]::ExpandEnvironmentVariables([string]$_.DisplayIcon).Trim('"')
    $target = ($icon -split ',')[0].Trim('"')
    if ($target -and [IO.Path]::GetExtension($target) -ieq '.exe') {
      $results.Add([pscustomobject]@{
        name = [string]$_.DisplayName
        executable = [IO.Path]::GetFileName($target)
        path = $target
        source = 'Installed app'
      })
    }
  }
}

$results | ConvertTo-Json -Compress
`;

function normalizeResults(raw) {
  if (!String(raw || "").trim()) return [];
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const byExecutable = new Map();

  for (const row of rows) {
    const executable = normalizeExecutable(row?.executable);
    if (!executable) continue;
    const name = String(row?.name || executable).trim();
    if (
      row?.source !== "Start menu" &&
      /(unins|uninstall|setup|installer|repair|crashpad|crashreport)/i.test(executable)
    ) continue;
    const existing = byExecutable.get(executable);
    if (!existing || (existing.source !== "Start menu" && row.source === "Start menu")) {
      byExecutable.set(executable, {
        name,
        executable,
        source: String(row?.source || "Installed app"),
      });
    }
  }

  return [...byExecutable.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

async function listInstalledApps({ force = false } = {}) {
  if (process.platform !== "win32") return [];
  if (!force && cache.items.length && Date.now() - cache.at < 5 * 60_000) {
    return cache.items;
  }

  const encoded = Buffer.from(POWERSHELL_SCRIPT, "utf16le").toString("base64");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
  );
  cache = { at: Date.now(), items: normalizeResults(stdout) };
  return cache.items;
}

module.exports = { listInstalledApps, normalizeResults };
