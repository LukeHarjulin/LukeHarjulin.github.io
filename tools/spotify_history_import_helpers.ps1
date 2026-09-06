#Requires -Version 7.0

function ConvertTo-SpotifyHistoryUtcTimestamp {
	param([Parameter(Mandatory)][object]$Value)

	if ($Value -is [DateTimeOffset]) {
		return ([DateTimeOffset]$Value).ToUniversalTime().ToString("o")
	}
	if ($Value -is [DateTime]) {
		$dateTime = [DateTime]$Value
		if ($dateTime.Kind -eq [DateTimeKind]::Unspecified) {
			$dateTime = [DateTime]::SpecifyKind($dateTime, [DateTimeKind]::Utc)
		}
		return ([DateTimeOffset]$dateTime).ToUniversalTime().ToString("o")
	}

	$parsed = [DateTimeOffset]::MinValue
	$styles = [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
	if (-not [DateTimeOffset]::TryParse([string]$Value, [Globalization.CultureInfo]::InvariantCulture, $styles, [ref]$parsed)) {
		throw "The listening-history cutoff is not a valid timestamp: $Value"
	}
	return $parsed.ToUniversalTime().ToString("o")
}

function Test-SpotifyHistoryModeWritesD1 {
	param(
		[ValidateSet("Report", "Generate", "ApplyLocal", "ApplyRemote")]
		[string]$Mode
	)
	return $Mode -in @("ApplyLocal", "ApplyRemote")
}

function Assert-SpotifyHistoryRemoteTarget {
	param(
		[string]$ExpectedAccountId,
		[string]$ExpectedDatabaseId,
		[string]$ActualDatabaseId
	)
	if ($ExpectedAccountId -notmatch '^[A-Fa-f0-9]{32}$') {
		throw "Remote D1 access requires the expected 32-character Cloudflare account ID."
	}
	if ($ExpectedDatabaseId -notmatch '^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$') {
		throw "Remote D1 access requires the expected D1 database UUID."
	}
	if ($ActualDatabaseId -ne $ExpectedDatabaseId) {
		throw "The resolved D1 database UUID does not match -ExpectedDatabaseId."
	}
}

function Get-SpotifyHistoryBudgetAfterInitialization {
	param(
		[ValidateSet("ApplyLocal", "ApplyRemote")]
		[string]$Mode,
		[int]$RemainingWriteBudget
	)
	if ($Mode -eq "ApplyLocal") { return $RemainingWriteBudget }
	if ($RemainingWriteBudget -lt 3) {
		throw "The remaining write budget is too small to initialize or verify a remote plan."
	}
	return $RemainingWriteBudget - 3
}

function Get-SpotifyHistoryPersistedChunkMap {
	param(
		[object[]]$PersistedChunks,
		[object[]]$ExpectedChunks
	)
	$persistedByNumber = @{}
	foreach ($persistedChunk in $PersistedChunks) {
		$persistedNumber = [int]$persistedChunk.chunk_number
		if ($persistedNumber -lt 1 -or $persistedNumber -gt $ExpectedChunks.Count) {
			throw "D1 contains an out-of-range chunk marker for this plan."
		}
		$expectedChunk = $ExpectedChunks[$persistedNumber - 1]
		if (
			[string]$persistedChunk.chunk_checksum -ne [string]$expectedChunk.checksum -or
			[int]$persistedChunk.expected_records -ne [int]$expectedChunk.expectedRecords
		) {
			throw "D1 chunk $persistedNumber does not match the generated plan. Stop before continuing."
		}
		$persistedByNumber[$persistedNumber] = $persistedChunk
	}
	return $persistedByNumber
}
