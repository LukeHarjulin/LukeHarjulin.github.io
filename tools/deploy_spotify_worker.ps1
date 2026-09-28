#Requires -Version 7.0

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
$devVarsPath = Join-Path $repoRoot ".dev.vars"
$configPath = Join-Path $repoRoot "wrangler.toml"
$managedKeys = @(
	"SPOTIFY_CLIENT_ID",
	"SPOTIFY_CLIENT_SECRET",
	"SPOTIFY_REFRESH_TOKEN"
)

. (Join-Path $PSScriptRoot "spotify_oauth_secrets.ps1")

if (-not (Test-Path -LiteralPath $configPath)) {
	throw "wrangler.toml does not exist. Copy wrangler.example.toml and insert the generated D1 ID first."
}
Assert-ManagedSecretsFile -Path $devVarsPath -ManagedKeys $managedKeys -RequireAll

$wranglerName = if ($IsWindows) { "wrangler.cmd" } else { "wrangler" }
$wranglerPath = Join-Path $repoRoot "node_modules/.bin/$wranglerName"
if (-not (Test-Path -LiteralPath $wranglerPath)) {
	throw "Wrangler is not installed. Run pnpm install first."
}

& $wranglerPath deploy --config $configPath --secrets-file $devVarsPath
if ($LASTEXITCODE -ne 0) {
	throw "Wrangler failed to deploy the Spotify Worker."
}
