#Requires -Version 7.0

function Quote-DotEnvValue {
	param([string]$Value)

	if ($Value -match "[\r\n]") {
		throw "Credential values cannot contain line breaks."
	}
	$escaped = $Value.Replace("\", "\\").Replace('"', '\"')
	return '"' + $escaped + '"'
}

function Save-LocalSecrets {
	param(
		[string]$Path,
		[System.Collections.IDictionary]$Values
	)

	$lines = [Collections.Generic.List[string]]::new()
	# Reauthorization and auth setup preserve other supported Worker secrets.
	if (Test-Path -LiteralPath $Path) {
		foreach ($line in [IO.File]::ReadAllLines($Path)) {
			if ($line -match '^\s*(?:export\s+)?(SPOTIFY_CLIENT_ID|SPOTIFY_CLIENT_SECRET|SPOTIFY_REFRESH_TOKEN|LASTFM_API_KEY|LISTENING_PASSPHRASE|LISTENING_SESSION_SECRET)\s*=' -and -not $Values.Contains($Matches[1])) {
				$lines.Add($line)
			}
		}
	}
	foreach ($key in $Values.Keys) {
		$lines.Add("$key=$(Quote-DotEnvValue -Value $Values[$key])")
	}

	$tempPath = "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
	try {
		[IO.File]::WriteAllLines($tempPath, $lines, [Text.UTF8Encoding]::new($false))
		[IO.File]::Move($tempPath, $Path, $true)
	} finally {
		if (Test-Path -LiteralPath $tempPath) {
			Remove-Item -LiteralPath $tempPath -Force
		}
	}
}

function Assert-ManagedSecretsFile {
	param(
		[string]$Path,
		[string[]]$ManagedKeys,
		[switch]$RequireAll
	)

	if (-not (Test-Path -LiteralPath $Path)) {
		if ($RequireAll) {
			throw ".dev.vars does not exist. Run pnpm spotify:oauth first."
		}
		return
	}

	$seenKeys = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
	foreach ($line in Get-Content -LiteralPath $Path) {
		if ([string]::IsNullOrWhiteSpace($line) -or $line -match '^\s*#') {
			continue
		}
		$assignment = [Regex]::Match($line, '^\s*(?:export\s+)?(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*=')
		if (-not $assignment.Success) {
			throw ".dev.vars contains an invalid dotenv line. Move or correct it before continuing."
		}
		$key = $assignment.Groups['key'].Value
		if ($ManagedKeys -cnotcontains $key -and @('LASTFM_API_KEY', 'LISTENING_PASSPHRASE', 'LISTENING_SESSION_SECRET') -cnotcontains $key) {
			throw ".dev.vars contains the unmanaged key '$key'. Move it so it cannot be uploaded to the Spotify Worker."
		}
		if (-not $seenKeys.Add($key)) {
			throw ".dev.vars contains the duplicate key '$key'."
		}
	}

	if ($RequireAll) {
		$missingKeys = @($ManagedKeys | Where-Object { -not $seenKeys.Contains($_) })
		if ($missingKeys.Count -gt 0) {
			throw ".dev.vars is missing required Worker keys: $($missingKeys -join ', ')."
		}
	}
}
