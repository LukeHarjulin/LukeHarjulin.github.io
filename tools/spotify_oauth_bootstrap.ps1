#Requires -Version 7.0

[CmdletBinding()]
param(
	[string]$ClientId
)

. (Join-Path $PSScriptRoot "spotify_oauth_secrets.ps1")
. (Join-Path $PSScriptRoot "spotify_oauth_url.ps1")

$ErrorActionPreference = "Stop"
$redirectUri = "http://127.0.0.1:8888/callback"
$requiredScopes = @(
	"user-read-currently-playing",
	"user-read-recently-played"
)
$listener = $null
$secretPointer = [IntPtr]::Zero
$secureClientSecret = $null

function ConvertTo-UrlSafeBase64 {
	param([byte[]]$Bytes)

	return [Convert]::ToBase64String($Bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Send-BrowserResponse {
	param(
		[System.Net.HttpListenerContext]$Context,
		[int]$StatusCode,
		[string]$Message
	)

	$body = @"
<!doctype html>
<html lang="en">
	<head><meta charset="utf-8"><title>Spotify authorization</title></head>
	<body><main><h1>$Message</h1><p>You can close this tab and return to the terminal.</p></main></body>
</html>
"@
	$bytes = [Text.Encoding]::UTF8.GetBytes($body)
	$Context.Response.StatusCode = $StatusCode
	$Context.Response.ContentType = "text/html; charset=utf-8"
	$Context.Response.ContentLength64 = $bytes.Length
	$Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
	$Context.Response.Close()
}

try {
	$devVarsPath = Join-Path (Split-Path $PSScriptRoot -Parent) ".dev.vars"
	$managedSecretKeys = @(
		"SPOTIFY_CLIENT_ID",
		"SPOTIFY_CLIENT_SECRET",
		"SPOTIFY_REFRESH_TOKEN"
	)
	Assert-ManagedSecretsFile -Path $devVarsPath -ManagedKeys $managedSecretKeys

	if ([string]::IsNullOrWhiteSpace($ClientId)) {
		$ClientId = Read-Host "Spotify client ID"
	}
	if ([string]::IsNullOrWhiteSpace($ClientId)) {
		throw "Spotify client ID is required."
	}

	$secureClientSecret = Read-Host "Spotify client secret" -AsSecureString
	$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureClientSecret)
	$clientSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
	if ([string]::IsNullOrWhiteSpace($clientSecret)) {
		throw "Spotify client secret is required."
	}

	$stateBytes = [byte[]]::new(32)
	[Security.Cryptography.RandomNumberGenerator]::Fill($stateBytes)
	$state = ConvertTo-UrlSafeBase64 -Bytes $stateBytes
	$scope = $requiredScopes -join " "
	$authorizeUri = New-SpotifyAuthorizeUri `
		-BaseUri "https://accounts.spotify.com/authorize" `
		-Parameters ([ordered]@{
		response_type = "code"
		client_id = $ClientId
		redirect_uri = $redirectUri
		scope = $scope
		state = $state
	})

	$listener = [Net.HttpListener]::new()
	$listener.Prefixes.Add("http://127.0.0.1:8888/")
	$listener.Start()

	Write-Host "Opening Spotify authorization in your default browser."
	Write-Host "The registered redirect URI must exactly match: $redirectUri"
	Start-Process -FilePath $authorizeUri

	$callbackDeadline = [DateTimeOffset]::UtcNow.AddMinutes(5)
	do {
		$remaining = $callbackDeadline - [DateTimeOffset]::UtcNow
		if ($remaining -le [TimeSpan]::Zero) {
			throw "Spotify authorization timed out after five minutes."
		}
		$contextTask = $listener.GetContextAsync()
		if (-not $contextTask.Wait($remaining)) {
			throw "Spotify authorization timed out after five minutes."
		}
		$context = $contextTask.Result
		$request = $context.Request

		if (-not [string]::Equals($request.Url.AbsolutePath, "/callback", [StringComparison]::Ordinal)) {
			Send-BrowserResponse -Context $context -StatusCode 404 -Message "Unexpected callback path"
			continue
		}
		if (-not [string]::Equals($request.QueryString["state"], $state, [StringComparison]::Ordinal)) {
			Send-BrowserResponse -Context $context -StatusCode 400 -Message "Authorization state did not match"
			continue
		}
		break
	} while ($true)

	if ($request.QueryString["error"]) {
		Send-BrowserResponse -Context $context -StatusCode 400 -Message "Spotify authorization was not completed"
		throw "Spotify authorization was denied or failed."
	}

	$authorizationCode = $request.QueryString["code"]
	if ([string]::IsNullOrWhiteSpace($authorizationCode)) {
		Send-BrowserResponse -Context $context -StatusCode 400 -Message "Authorization code was missing"
		throw "Spotify did not return an authorization code."
	}

	$basicCredentials = [Convert]::ToBase64String(
		[Text.Encoding]::UTF8.GetBytes("$ClientId`:$clientSecret")
	)
	try {
		$token = Invoke-RestMethod `
			-Method Post `
			-Uri "https://accounts.spotify.com/api/token" `
			-Headers @{ Authorization = "Basic $basicCredentials" } `
			-ContentType "application/x-www-form-urlencoded" `
			-Body @{
				grant_type = "authorization_code"
				code = $authorizationCode
				redirect_uri = $redirectUri
			}
	} catch {
		Send-BrowserResponse -Context $context -StatusCode 502 -Message "Spotify token exchange failed"
		throw "Spotify token exchange failed. No token response was stored."
	}

	if ([string]::IsNullOrWhiteSpace($token.refresh_token)) {
		Send-BrowserResponse -Context $context -StatusCode 502 -Message "Spotify did not return a refresh token"
		throw "Spotify did not return a refresh token. Revoke access and retry authorization."
	}
	$grantedScopes = @([string]$token.scope -split " " | Where-Object { $_ })
	$missingScopes = @($requiredScopes | Where-Object { $_ -notin $grantedScopes })
	if ($missingScopes.Count -gt 0) {
		Send-BrowserResponse -Context $context -StatusCode 403 -Message "Required Spotify scopes were not granted"
		throw "Required Spotify scopes were not granted: $($missingScopes -join ', ')."
	}

	Save-LocalSecrets -Path $devVarsPath -Values ([ordered]@{
		SPOTIFY_CLIENT_ID = $ClientId
		SPOTIFY_CLIENT_SECRET = $clientSecret
		SPOTIFY_REFRESH_TOKEN = [string]$token.refresh_token
	})

	Send-BrowserResponse -Context $context -StatusCode 200 -Message "Spotify authorization complete"
	Write-Host "Spotify credentials were saved to the ignored .dev.vars file."
	Write-Host "The refresh token was not printed."
} finally {
	$authorizationCode = $null
	$basicCredentials = $null
	$token = $null
	$clientSecret = $null
	if ($secretPointer -ne [IntPtr]::Zero) {
		try {
			[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
		} catch {
			Write-Warning "Could not clear the temporary client-secret buffer."
		}
	}
	if ($secureClientSecret) {
		try {
			$secureClientSecret.Dispose()
		} catch {
			Write-Warning "Could not dispose the temporary secure-string buffer."
		}
	}
	if ($listener) {
		try {
			$listener.Stop()
		} catch {
			Write-Warning "Could not stop the local OAuth listener cleanly."
		}
		try {
			$listener.Close()
		} catch {
			Write-Warning "Could not close the local OAuth listener cleanly."
		}
	}
}
