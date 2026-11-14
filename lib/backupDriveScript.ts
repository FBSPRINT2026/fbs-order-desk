/**
 * The backup drive's program (fbs-backup.ps1), with this portal's address and its key filled in. It installs itself
 * (asks Windows for permission once), then every night switches the drive on, copies what's new or changed in Dropbox
 * through /api/backup/drive, keeps the old copy of anything changed under _older\\<date>, reports, and switches the
 * drive off again. More than 2,000 files already on the drive changing in one run pauses it until the owner says OK.
 */
export function backupScript(key: string, server: string) {
  return `# FBS Backup: copies the whole Dropbox onto the FBS Backup drive every night, then switches the drive off so nothing
# on this computer can reach it until the next night. A file that changed keeps its old copy under _older\\<date>.
# Install (once): plug in the drive (named FBS Backup), right-click this file > Run with PowerShell, and say Yes.
param([switch]$Run)
$Server = "${server}"
$Key = "${key}"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Base = Join-Path $env:ProgramData "FBSBackup"
$Self = Join-Path $Base "fbs-backup.ps1"

function Is-Admin { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }

if (-not $Run) {
  if (-not (Is-Admin)) { Start-Process powershell.exe -Verb RunAs -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'); exit }
  New-Item -ItemType Directory -Force -Path $Base | Out-Null
  if ($PSCommandPath -ne $Self) { Copy-Item -Force $PSCommandPath $Self }
  $v = Get-Volume | Where-Object { $_.FileSystemLabel -match '^FBS ?BACKUP$' } | Select-Object -First 1
  if (-not $v -or -not $v.DriveLetter) { Write-Host "Plug in the backup drive (named FBS Backup), then run this again."; Read-Host "Press Enter to close"; exit }
  $d = Get-Partition -DriveLetter $v.DriveLetter | Get-Disk
  if ($d.IsBoot -or $d.IsSystem) { Write-Host "That drive is the computer's own drive, not a backup drive. Stopping."; Read-Host "Press Enter to close"; exit }
  @{ uid = $d.UniqueId; label = $v.FileSystemLabel } | ConvertTo-Json | Set-Content (Join-Path $Base "disk.json")
  $a = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $Self + '" -Run')
  $t = New-ScheduledTaskTrigger -Daily -At 1:30am
  $s = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Days 3) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $p = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName "FBS Backup" -Action $a -Trigger $t -Settings $s -Principal $p -Force | Out-Null
  Start-ScheduledTask -TaskName "FBS Backup"
  Write-Host ""
  Write-Host "FBS Backup is set up and copying now. The first time takes a while (it's the whole Dropbox)."
  Write-Host "After that it runs every night at 1:30 am and switches the drive off when it's done."
  Write-Host "See how it's going on the portal: Settings > Dropbox > Backup drive."
  Read-Host "Press Enter to close"; exit
}

$log = Join-Path $Base "backup.log"
function Note($m) { try { Add-Content -Path $log -Value ((Get-Date -Format "MM-dd HH:mm:ss") + " " + $m) } catch {} }
$h = @{ "x-backup-key" = $Key }
function Ask($body) { Invoke-RestMethod -Method Post -Uri ($Server + "/api/backup/drive") -Headers $h -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 5 -Compress) -TimeoutSec 90 -UseBasicParsing }
$rep = @{ started = (Get-Date).ToUniversalTime().ToString("o"); done = $false; added = 0; changed = 0; bytes = 0; errors = 0; firstError = ""; held = ""; listed = 0 }
function Report { try { Ask @{ action = "report"; report = $rep } | Out-Null } catch { Note ("report: " + $_.Exception.Message) } }
function Clean([string]$p) { ($p -replace '[<>:"|?*]', '_') -replace '/', '\\' }

Note "started"
$disk = $null; $vol = $null
try {
  $info = Get-Content (Join-Path $Base "disk.json") -Raw | ConvertFrom-Json
  $disk = Get-Disk | Where-Object { $_.UniqueId -eq $info.uid } | Select-Object -First 1
  if (-not $disk) { throw "The FBS Backup drive isn't plugged in." }
  if ($disk.IsOffline) { Set-Disk -Number $disk.Number -IsOffline $false; Start-Sleep -Seconds 5 }
  if ((Get-Disk -Number $disk.Number).IsReadOnly) { Set-Disk -Number $disk.Number -IsReadOnly $false }
  for ($w = 0; $w -lt 10 -and -not $vol; $w++) { $vol = Get-Partition -DiskNumber $disk.Number | Get-Volume | Where-Object { $_.FileSystemLabel -eq $info.label -and $_.DriveLetter } | Select-Object -First 1; if (-not $vol) { Start-Sleep -Seconds 3 } }
  if (-not $vol) { throw "The backup drive came on but has no drive letter." }
  $root = [string]$vol.DriveLetter + ":\\FBS Backup"
  $state = Join-Path $root ".fbs"
  New-Item -ItemType Directory -Force -Path $state | Out-Null
  $curFile = Join-Path $state "cursor.txt"
  $cursor = ""; if (Test-Path $curFile) { $cursor = (Get-Content $curFile -Raw).Trim() }
  $first = -not $cursor
  $today = Get-Date -Format "yyyy-MM-dd"
  $changedTotal = 0
  do {
    $r = Ask @{ action = "list"; cursor = $cursor }
    $files = @()
    foreach ($e in $r.entries) {
      $rep.listed++
      if ($e.t -ne "file") { continue }
      $dest = $root + "\\Dropbox" + (Clean $e.p)
      $lp = "\\\\?\\" + $dest
      $mod = ([datetime]$e.m).ToUniversalTime()
      if ([IO.File]::Exists($lp)) {
        $fi = New-Object IO.FileInfo($lp)
        if ($fi.Length -eq [int64]$e.s -and [Math]::Abs(($fi.LastWriteTimeUtc - $mod).TotalSeconds) -lt 3) { continue }
        $files += @{ e = $e; dest = $dest; old = $true; mod = $mod }
      } else { $files += @{ e = $e; dest = $dest; old = $false; mod = $mod } }
    }
    $changedTotal += @($files | Where-Object { $_.old }).Count
    # lots of files already on the drive changing at once can be a virus scrambling them: stop and ask on the portal
    if (-not $first -and $changedTotal -gt 2000 -and -not $r.allowBig) { $rep.held = "$changedTotal files already on the drive changed at once (that can be a virus scrambling files)"; Note $rep.held; break }
    for ($i = 0; $i -lt $files.Count; $i += 25) {
      $chunk = @($files[$i..([Math]::Min($i + 24, $files.Count - 1))])
      $links = (Ask @{ action = "links"; ids = @($chunk | ForEach-Object { $_.e.id }) }).links
      foreach ($f in $chunk) {
        try {
          $u = $links.($f.e.id)
          if (-not $u) { throw "Dropbox gave no download link" }
          $tmp = Join-Path $state "download.tmp"
          if (Test-Path $tmp) { Remove-Item -Force $tmp }
          Invoke-WebRequest -Uri $u -OutFile $tmp -UseBasicParsing -TimeoutSec 7200
          $lp = "\\\\?\\" + $f.dest
          [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($lp)) | Out-Null
          if ($f.old) {
            $keep = "\\\\?\\" + $root + "\\_older\\" + $today + $f.dest.Substring(($root + "\\Dropbox").Length)
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($keep)) | Out-Null
            if ([IO.File]::Exists($keep)) { [IO.File]::Delete($keep) }
            [IO.File]::Move($lp, $keep)
            $rep.changed++
          } else { $rep.added++ }
          [IO.File]::Move($tmp, $lp)
          [IO.File]::SetLastWriteTimeUtc($lp, $f.mod)
          $rep.bytes += [int64]$f.e.s
        } catch { $rep.errors++; if (-not $rep.firstError) { $rep.firstError = $f.e.p + ": " + $_.Exception.Message }; Note ("error " + $f.e.p + ": " + $_.Exception.Message) }
      }
    }
    $cursor = $r.cursor
    Set-Content -Path $curFile -Value $cursor
    if (($rep.listed % 20000) -lt 2000) { Report }
  } while ($r.more)
  if (-not $rep.held) { $rep.done = $true }
} catch { $rep.errors++; $rep.firstError = $_.Exception.Message; Note ("stopped: " + $_.Exception.Message) }
finally {
  try { if ($vol) { $rep.freeGB = [math]::Round((Get-Volume -DriveLetter $vol.DriveLetter).SizeRemaining / 1GB); $rep.sizeGB = [math]::Round($vol.Size / 1GB) } } catch {}
  Report
  if ($disk) { try { Set-Disk -Number $disk.Number -IsOffline $true; Note "drive switched off" } catch { Note ("couldn't switch the drive off: " + $_.Exception.Message) } }
  Note ("finished: added " + $rep.added + ", changed " + $rep.changed + ", errors " + $rep.errors)
}
`;
}

