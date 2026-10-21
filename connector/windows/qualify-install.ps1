param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$taskRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$taskBuildRoot = Join-Path $taskRepo '.qa-delivery'
$taskInstaller = (Resolve-Path -LiteralPath $Installer).Path
if (-not $taskInstaller.StartsWith($taskBuildRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Only a generated local qualification installer is accepted.' }
$taskReportPath = Join-Path (Split-Path -Parent $taskInstaller) 'build.json'
$taskBuild = Get-Content -LiteralPath $taskReportPath -Raw | ConvertFrom-Json
if ($taskBuild.status -ne 'local-qualification-only-unsigned' -or $taskBuild.publicDownloadAllowed) { throw 'Unexpected release status.' }
if ((Get-FileHash -LiteralPath $taskInstaller -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskBuild.sha256) { throw 'Installer differs from build report.' }
$taskTarget = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\SRTB Graphics Connector'))
$taskShortcutRoot = Join-Path ([Environment]::GetFolderPath('Programs')) 'SRTB Graphics Connector'
$taskRegistry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SRTBGraphicsConnector'
$taskData = Join-Path $env:LOCALAPPDATA 'SRTB Graphics Connector'
# Do not overwrite, adopt or uninstall a pre-existing application or user data.
if ((Test-Path -LiteralPath $taskTarget) -or (Test-Path -LiteralPath $taskShortcutRoot) -or (Test-Path -LiteralPath $taskRegistry)) { throw 'An existing installation or shortcut is present; no action taken.' }
$taskDataExisted = Test-Path -LiteralPath $taskData
$taskSteps = [Collections.Generic.List[string]]::new()
function Invoke-QualificationProcess([string]$Executable, [string]$Arguments) {
 $taskProcess = Start-Process -FilePath $Executable -ArgumentList $Arguments -WindowStyle Hidden -PassThru
 if (-not $taskProcess.WaitForExit(60000)) { throw 'Qualification process did not exit; no forced termination or manual deletion performed.' }
 $taskProcess.Refresh()
 return $taskProcess.ExitCode
}
$taskInstallExit = Invoke-QualificationProcess $taskInstaller '/S'
if ($taskInstallExit -ne 0) { throw "Installation failed ($taskInstallExit); no manual cleanup performed." }
$taskSteps.Add('Silent per-user installation completed without elevation or policy changes')
$taskUninstaller = Join-Path $taskTarget 'Uninstall.exe'
if (-not (Test-Path -LiteralPath $taskUninstaller)) { throw 'Uninstaller missing; preserving state for support.' }
try {
 $taskLauncher = Join-Path $taskTarget 'GraphicsConnector.exe'
 if ((Invoke-QualificationProcess $taskLauncher '--verify-only') -ne 0) { throw 'Installed payload failed integrity verification.' }
 $taskSteps.Add('Installed launcher validated every payload file')
 if (-not (Test-Path -LiteralPath $taskRegistry)) { throw 'Per-user uninstall registration missing.' }
 if (-not (Test-Path -LiteralPath (Join-Path $taskShortcutRoot 'Ouvrir le connecteur.lnk'))) { throw 'Start menu shortcut missing.' }
 $taskSteps.Add('User-scoped shortcut and uninstall registration present')
 # Verify the installer refuses to overwrite an existing directory.
 $taskBefore = (Get-FileHash -LiteralPath $taskLauncher -Algorithm SHA256).Hash
 if ((Invoke-QualificationProcess $taskInstaller '/S') -eq 0) { throw 'Existing installation was not rejected.' }
 if ((Get-FileHash -LiteralPath $taskLauncher -Algorithm SHA256).Hash -ne $taskBefore) { throw 'Existing launcher changed on refused reinstall.' }
 $taskSteps.Add('Second install refused; existing payload unchanged')
 # Do not run UI or real native folder pickers during this unattended check.
 # Hold one owned runtime file locked; uninstaller must fail before any deletion.
 $taskLock = [IO.File]::Open((Join-Path $taskTarget 'node.exe'), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
 try {
  # _?= is the documented NSIS in-place uninstaller mode: wait on the actual
  # uninstaller, leave its own executable until the isolated cleanup below.
  $taskLockedExit = Invoke-QualificationProcess $taskUninstaller ('/S _?=' + $taskTarget)
  if ($taskLockedExit -eq 0) { throw 'Uninstaller did not reject a locked runtime.' }
  if (-not (Test-Path -LiteralPath $taskLauncher) -or -not (Test-Path -LiteralPath $taskRegistry)) { throw 'Locked uninstall removed application state.' }
  $taskSteps.Add('Locked runtime refused before any uninstall deletion')
 } finally { $taskLock.Dispose() }
} finally {
 # Exact target is revalidated before the owned uninstaller may remove files.
 if ($taskTarget -ne [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\SRTB Graphics Connector'))) { throw 'Target validation failed; no uninstall.' }
 $taskUninstallExit = Invoke-QualificationProcess $taskUninstaller ('/S _?=' + $taskTarget)
 if ($taskUninstallExit -ne 0) { throw "Uninstall failed ($taskUninstallExit). Preserving remaining files for support." }
 # In-place NSIS mode cannot delete its own executable; only that exact file
 # from this test may remain. Never recurse or touch the metadata directory.
 if (Test-Path -LiteralPath $taskTarget) {
  $taskRemaining = @(Get-ChildItem -LiteralPath $taskTarget -Force)
  if ($taskRemaining.Count -ne 1 -or $taskRemaining[0].Name -ne 'Uninstall.exe' -or $taskRemaining[0].PSIsContainer) { throw 'Unexpected files remain; no manual deletion.' }
  if ((Get-Item -LiteralPath $taskTarget).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected reparse point; no deletion.' }
  Remove-Item -LiteralPath $taskUninstaller
  Remove-Item -LiteralPath $taskTarget
 }
}
if ((Test-Path -LiteralPath $taskTarget) -or (Test-Path -LiteralPath $taskRegistry) -or (Test-Path -LiteralPath $taskShortcutRoot)) { throw 'Uninstall left application state.' }
if ((Test-Path -LiteralPath $taskData) -ne $taskDataExisted) { throw 'Metadata directory existence changed unexpectedly.' }
$taskSteps.Add('Owned application, shortcut and uninstall registration removed; metadata untouched')
[PSCustomObject]@{schema=1;passed=$taskSteps.Count;steps=$taskSteps;interactiveUiTested=$false;nativePickerTested=$false;publicDownloadAllowed=$false} | ConvertTo-Json -Depth 5
