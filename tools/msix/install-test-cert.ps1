# install-test-cert.ps1 -- trust the test-signing certificate next to this script, then
# install the MSIX beside it. For sideloading a test-signed build only; a Store build
# needs none of this.
# Constraints:
# - The .cer goes into LocalMachine\TrustedPeople (what MSIX sideload checks), which
#   needs an elevated shell: this script relaunches itself elevated when it is not.
# - Never put a test certificate in Trusted Root; TrustedPeople is the narrowest store
#   that satisfies the package check.
# - Remove with: certutil -delstore TrustedPeople "<thumbprint printed below>".
[CmdletBinding()]
param([switch]$NoInstall)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cer = Get-ChildItem -Path $here -Filter *.cer | Select-Object -First 1
$msix = Get-ChildItem -Path $here -Filter *.msix | Select-Object -First 1
if (-not $cer) { Write-Error "No .cer next to this script in $here"; exit 1 }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "Elevating to import the certificate into LocalMachine\TrustedPeople..."
  $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$($MyInvocation.MyCommand.Path)`"")
  if ($NoInstall) { $args += '-NoInstall' }
  Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList $args -Verb RunAs -Wait
  exit $LASTEXITCODE
}

$imported = Import-Certificate -FilePath $cer.FullName -CertStoreLocation Cert:\LocalMachine\TrustedPeople
Write-Host ("Trusted: {0}  thumbprint {1}" -f $imported.Subject, $imported.Thumbprint)

if ($NoInstall) { exit 0 }
if (-not $msix) { Write-Host "No .msix next to this script; certificate installed only."; exit 0 }
Write-Host ("Installing {0} ..." -f $msix.Name)
Add-AppxPackage -Path $msix.FullName
Write-Host "Installed. Find Phosphor in the Start menu."
