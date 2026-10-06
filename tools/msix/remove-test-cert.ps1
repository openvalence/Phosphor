# remove-test-cert.ps1 -- undo install-test-cert.ps1: uninstall the sideloaded Phosphor
# package and remove the test certificate from LocalMachine\TrustedPeople.
# Constraints:
# - Removes only the certificate whose thumbprint matches the .cer beside this script,
#   never anything else in the store. Elevates itself for the store write.
# - -KeepApp removes the certificate only; -KeepCert uninstalls the app only.
[CmdletBinding()]
param([switch]$KeepApp, [switch]$KeepCert)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cer = Get-ChildItem -Path $here -Filter *.cer | Select-Object -First 1
if (-not $cer -and -not $KeepCert) { Write-Error "No .cer next to this script in $here"; exit 1 }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "Elevating to edit LocalMachine\TrustedPeople..."
  $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$($MyInvocation.MyCommand.Path)`"")
  if ($KeepApp) { $args += '-KeepApp' }
  if ($KeepCert) { $args += '-KeepCert' }
  Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList $args -Verb RunAs -Wait
  exit $LASTEXITCODE
}

if (-not $KeepApp) {
  # The package identity is the manifest's; the Store build shares the name, so only
  # a package signed by this very certificate is removed.
  $x509 = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($cer.FullName)
  $pkgs = Get-AppxPackage -AllUsers | Where-Object { $_.SignatureKind -eq 'Developer' -and $_.Publisher -eq $x509.Subject }
  if ($pkgs) {
    foreach ($p in $pkgs) { Write-Host ("Removing {0} {1} ..." -f $p.Name, $p.Version); Remove-AppxPackage -Package $p.PackageFullName -AllUsers }
  } else { Write-Host "No sideloaded package signed by this certificate is installed." }
}

if (-not $KeepCert) {
  $x509 = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($cer.FullName)
  $hit = Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object { $_.Thumbprint -eq $x509.Thumbprint }
  if ($hit) { $hit | Remove-Item; Write-Host ("Removed certificate {0} from TrustedPeople." -f $x509.Thumbprint) }
  else { Write-Host "Certificate not present in TrustedPeople; nothing to remove." }
}
