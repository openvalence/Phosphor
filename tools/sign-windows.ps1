# Tauri's bundle.windows.signCommand in CI: signs one file with Azure Artifact
# Signing (docs/BUILD.md, Windows signing). Needs azure/login first, the
# ArtifactSigning module and the AZURE_ARTIFACT_SIGNING_* variables in the environment.
param([Parameter(Mandatory)][string]$File)
$ErrorActionPreference = 'Stop'
Invoke-ArtifactSigning -Files $File `
  -Endpoint $env:AZURE_ARTIFACT_SIGNING_ENDPOINT `
  -CodeSigningAccountName $env:AZURE_ARTIFACT_SIGNING_ACCOUNT `
  -CertificateProfileName $env:AZURE_ARTIFACT_SIGNING_PROFILE `
  -FileDigest SHA256 -TimestampRfc3161 http://timestamp.acs.microsoft.com -TimestampDigest SHA256 `
  -ExcludeEnvironmentCredential -ExcludeWorkloadIdentityCredential -ExcludeManagedIdentityCredential `
  -ExcludeSharedTokenCacheCredential -ExcludeVisualStudioCredential -ExcludeVisualStudioCodeCredential `
  -ExcludeAzurePowerShellCredential -ExcludeAzureDeveloperCliCredential -ExcludeInteractiveBrowserCredential
