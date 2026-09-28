#Requires -Version 7.0

$ErrorActionPreference = "Stop"
$sourcePath = Join-Path $PSScriptRoot "spotify_oauth_bootstrap.ps1"
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
	$sourcePath,
	[ref]$tokens,
	[ref]$parseErrors
)

if ($parseErrors.Count -gt 0) {
	throw "OAuth bootstrap has PowerShell parse errors: $($parseErrors -join '; ')"
}

. (Join-Path $PSScriptRoot "spotify_oauth_secrets.ps1")
. (Join-Path $PSScriptRoot "spotify_oauth_url.ps1")

$authorizeParameters = [ordered]@{
	response_type = "code"
	client_id = "client id&value=1"
	redirect_uri = "http://127.0.0.1:8888/callback"
	scope = "scope-one scope-two"
	state = "state+with/symbols="
}
$authorizeUri = New-SpotifyAuthorizeUri `
	-BaseUri "https://accounts.spotify.com/authorize" `
	-Parameters $authorizeParameters
$parsedAuthorizeUri = [Uri]$authorizeUri
if ($parsedAuthorizeUri.Scheme -cne "https" -or
	$parsedAuthorizeUri.Host -cne "accounts.spotify.com" -or
	$parsedAuthorizeUri.AbsolutePath -cne "/authorize") {
	throw "Spotify authorize URL used an unexpected origin or path."
}
$rawQuery = $parsedAuthorizeUri.Query.TrimStart("?")
if ($rawQuery.Contains(" ") -or ([Regex]::Matches($rawQuery, "&")).Count -ne 4) {
	throw "Spotify authorize URL did not contain five ampersand-separated parameters."
}
$decodedParameters = [Collections.Generic.Dictionary[string, string]]::new([StringComparer]::Ordinal)
foreach ($encodedParameter in $rawQuery -split "&") {
	$parts = $encodedParameter -split "=", 2
	if ($parts.Count -ne 2) {
		throw "Spotify authorize URL contained a malformed query parameter."
	}
	$key = [Uri]::UnescapeDataString($parts[0])
	$value = [Uri]::UnescapeDataString($parts[1])
	if ($decodedParameters.ContainsKey($key)) {
		throw "Spotify authorize URL contained a duplicate query parameter."
	}
	$decodedParameters.Add($key, $value)
}
foreach ($key in $authorizeParameters.Keys) {
	if (-not $decodedParameters.ContainsKey($key) -or
		$decodedParameters[$key] -cne [string]$authorizeParameters[$key]) {
		throw "Spotify authorize URL did not preserve the '$key' value."
	}
}

$managedKeys = @(
	"SPOTIFY_CLIENT_ID",
	"SPOTIFY_CLIENT_SECRET",
	"SPOTIFY_REFRESH_TOKEN"
)
$tempFile = [IO.Path]::GetTempFileName()

try {
	[IO.File]::WriteAllText($tempFile, 'OTHER_SECRET="do-not-upload"')
	try {
		Assert-ManagedSecretsFile -Path $tempFile -ManagedKeys $managedKeys
		throw "An unmanaged dotenv key was accepted."
	} catch {
		if ($_.Exception.Message -notmatch "unmanaged key") {
			throw
		}
	}

	[IO.File]::WriteAllLines($tempFile, @(
		'export SPOTIFY_CLIENT_ID = "old"',
		' SPOTIFY_CLIENT_SECRET="old"',
		'SPOTIFY_REFRESH_TOKEN="old"'
	))
	Assert-ManagedSecretsFile -Path $tempFile -ManagedKeys $managedKeys -RequireAll

	Save-LocalSecrets -Path $tempFile -Values ([ordered]@{
		SPOTIFY_CLIENT_ID = "client"
		SPOTIFY_CLIENT_SECRET = "secret"
		SPOTIFY_REFRESH_TOKEN = "refresh"
	})

	$savedLines = @(Get-Content -LiteralPath $tempFile)
	$expectedLines = @(
		'SPOTIFY_CLIENT_ID="client"',
		'SPOTIFY_CLIENT_SECRET="secret"',
		'SPOTIFY_REFRESH_TOKEN="refresh"'
	)
	if ([string]::Join("`n", $savedLines) -cne [string]::Join("`n", $expectedLines)) {
		throw "Saved dotenv content did not match the expected managed keys."
	}
	Assert-ManagedSecretsFile -Path $tempFile -ManagedKeys $managedKeys -RequireAll

	$tempPattern = "$(Split-Path $tempFile -Leaf).*tmp"
	if (Get-ChildItem -LiteralPath (Split-Path $tempFile -Parent) -Filter $tempPattern) {
		throw "A temporary credential file was left behind."
	}

	try {
		Quote-DotEnvValue -Value "line1`nline2"
		throw "A multiline dotenv value was accepted."
	} catch {
		if ($_.Exception.Message -notmatch "line breaks") {
			throw
		}
	}

	Write-Host "OAuth bootstrap helper tests passed."
} finally {
	if (Test-Path -LiteralPath $tempFile) {
		Remove-Item -LiteralPath $tempFile -Force
	}
}
