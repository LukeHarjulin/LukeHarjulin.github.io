#Requires -Version 7.0
param([switch]$Generate, [switch]$Rotate)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
$secretsPath = Join-Path $repoRoot ".dev.vars"
. (Join-Path $PSScriptRoot "spotify_oauth_secrets.ps1")
Assert-ManagedSecretsFile -Path $secretsPath -ManagedKeys @("SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SPOTIFY_REFRESH_TOKEN")
if (-not $Rotate -and (Test-Path -LiteralPath $secretsPath) -and
	(Select-String -LiteralPath $secretsPath -Pattern '^LISTENING_PASSPHRASE=' -Quiet) -and
	(Select-String -LiteralPath $secretsPath -Pattern '^LISTENING_SESSION_SECRET=' -Quiet)) {
	Write-Host "Listening secrets already exist. Use -Rotate to replace them and invalidate sessions."
	exit 0
}

if ($Generate) {
	$phrase = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
} else {
	$securePhrase = Read-Host "Shared listening passphrase (at least 12 characters)" -AsSecureString
	$phrase = [System.Net.NetworkCredential]::new('', $securePhrase).Password
}
if ($phrase.Length -lt 12 -or $phrase.Length -gt 1024) { throw "Use a passphrase between 12 and 1024 characters." }
$sessionSecret = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
Save-LocalSecrets -Path $secretsPath -Values ([ordered]@{
	LISTENING_PASSPHRASE = $phrase
	LISTENING_SESSION_SECRET = $sessionSecret
})
$phrase = $null
$sessionSecret = $null
Write-Host "Listening secrets saved to the ignored .dev.vars file. No secret values were printed."
