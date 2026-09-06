#Requires -Version 7.0

function New-SpotifyAuthorizeUri {
	param(
		[string]$BaseUri,
		[System.Collections.IDictionary]$Parameters
	)

	$encodedParameters = @($Parameters.GetEnumerator() | ForEach-Object {
		"$([Uri]::EscapeDataString([string]$_.Key))=$([Uri]::EscapeDataString([string]$_.Value))"
	})
	$queryString = [string]::Join("&", [string[]]$encodedParameters)
	return "${BaseUri}?$queryString"
}
