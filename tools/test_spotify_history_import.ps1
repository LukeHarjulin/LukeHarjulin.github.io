#Requires -Version 7.0

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "spotify_history_import_helpers.ps1")

function Assert-Throws {
	param([scriptblock]$Action, [string]$Label)
	$threw = $false
	try { & $Action } catch { $threw = $true }
	if (-not $threw) { throw "Expected failure: $Label" }
}

$previousCulture = [Threading.Thread]::CurrentThread.CurrentCulture
try {
	[Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::GetCultureInfo("en-GB")
	$automaticJsonDate = ('{"cutoff":"2026-08-30T20:11:42.000Z"}' | ConvertFrom-Json).cutoff
	if ((ConvertTo-SpotifyHistoryUtcTimestamp -Value $automaticJsonDate) -ne "2026-08-30T20:11:42.0000000+00:00") {
		throw "Automatically parsed JSON dates were not normalized independently of the current culture."
	}
	if ((ConvertTo-SpotifyHistoryUtcTimestamp -Value "2026-08-30T20:11:42Z") -ne "2026-08-30T20:11:42.0000000+00:00") {
		throw "ISO cutoff strings were not normalized."
	}
} finally {
	[Threading.Thread]::CurrentThread.CurrentCulture = $previousCulture
}
Assert-Throws { ConvertTo-SpotifyHistoryUtcTimestamp -Value "not-a-timestamp" } "invalid cutoff timestamp"
if (Test-SpotifyHistoryModeWritesD1 -Mode Report) { throw "Report mode must not write to D1." }
if (Test-SpotifyHistoryModeWritesD1 -Mode Generate) { throw "Generate mode must not write to D1." }
if (-not (Test-SpotifyHistoryModeWritesD1 -Mode ApplyLocal)) { throw "ApplyLocal must be classified as writing to D1." }
if (-not (Test-SpotifyHistoryModeWritesD1 -Mode ApplyRemote)) { throw "ApplyRemote must be classified as writing to D1." }

$accountId = "a" * 32
$databaseId = "00000000-0000-0000-0000-000000000001"
Assert-SpotifyHistoryRemoteTarget -ExpectedAccountId $accountId -ExpectedDatabaseId $databaseId -ActualDatabaseId $databaseId
Assert-Throws { Assert-SpotifyHistoryRemoteTarget -ExpectedAccountId "bad" -ExpectedDatabaseId $databaseId -ActualDatabaseId $databaseId } "invalid account ID"
Assert-Throws { Assert-SpotifyHistoryRemoteTarget -ExpectedAccountId $accountId -ExpectedDatabaseId $databaseId -ActualDatabaseId "00000000-0000-0000-0000-000000000002" } "database mismatch"

if ((Get-SpotifyHistoryBudgetAfterInitialization -Mode ApplyRemote -RemainingWriteBudget 10) -ne 7) {
	throw "Remote initialization budget was not charged."
}
if ((Get-SpotifyHistoryBudgetAfterInitialization -Mode ApplyLocal -RemainingWriteBudget 0) -ne 0) {
	throw "Local budget should not be charged."
}
Assert-Throws { Get-SpotifyHistoryBudgetAfterInitialization -Mode ApplyRemote -RemainingWriteBudget 2 } "insufficient initialization budget"

$expected = @(
	[pscustomobject]@{ checksum = "a" * 64; expectedRecords = 10 },
	[pscustomobject]@{ checksum = "b" * 64; expectedRecords = 5 }
)
$persisted = @(
	[pscustomobject]@{ chunk_number = 1; chunk_checksum = "a" * 64; expected_records = 10 },
	[pscustomobject]@{ chunk_number = 2; chunk_checksum = "b" * 64; expected_records = 5 }
)
$map = Get-SpotifyHistoryPersistedChunkMap -PersistedChunks $persisted -ExpectedChunks $expected
if ($map.Count -ne 2) { throw "Valid chunk markers were not indexed." }

$badChecksum = @([pscustomobject]@{ chunk_number = 1; chunk_checksum = "c" * 64; expected_records = 10 })
Assert-Throws { Get-SpotifyHistoryPersistedChunkMap -PersistedChunks $badChecksum -ExpectedChunks $expected } "checksum mismatch"
$badCount = @([pscustomobject]@{ chunk_number = 1; chunk_checksum = "a" * 64; expected_records = 9 })
Assert-Throws { Get-SpotifyHistoryPersistedChunkMap -PersistedChunks $badCount -ExpectedChunks $expected } "record-count mismatch"
$outOfRange = @([pscustomobject]@{ chunk_number = 3; chunk_checksum = "c" * 64; expected_records = 1 })
Assert-Throws { Get-SpotifyHistoryPersistedChunkMap -PersistedChunks $outOfRange -ExpectedChunks $expected } "out-of-range marker"

Write-Host "Spotify history import helper tests passed."
