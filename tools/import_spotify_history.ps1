#Requires -Version 7.0

[CmdletBinding()]
param(
	[Parameter(Mandatory)]
	[string]$InputPath,
	[ValidateSet("Report", "Generate", "ApplyLocal", "ApplyRemote")]
	[string]$Mode = "Report",
	[string]$Cutoff,
	[ValidateRange(1, 10000)]
	[int]$ChunkSize = 1000,
	[ValidateRange(1, 8)]
	[int]$MetadataConcurrency = 2,
	[ValidateSet("CacheOnly", "Refresh")]
	[string]$MetadataMode = "CacheOnly",
	[ValidateRange(1, 2147483647)]
	[int]$StartChunk = 1,
	[ValidateRange(0, 2147483647)]
	[int]$MaxChunks = 0,
	[ValidateRange(0, 90000)]
	[int]$RemainingWriteBudget = 0,
	[string]$ExpectedAccountId,
	[string]$ExpectedDatabaseId,
	[switch]$CronPaused,
	[switch]$CleanupExtractedSource
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
$workspace = Join-Path $repoRoot ".spotify-history"
$devVarsPath = Join-Path $repoRoot ".dev.vars"
$configPath = Join-Path $repoRoot "wrangler.toml"
$nodePath = (Get-Command node -ErrorAction Stop).Source
$wranglerName = if ($IsWindows) { "wrangler.cmd" } else { "wrangler" }
$wranglerPath = Join-Path $repoRoot "node_modules/.bin/$wranglerName"
$cliPath = Join-Path $PSScriptRoot "spotify_history_import.mjs"
$localApplyPath = Join-Path $PSScriptRoot "apply_spotify_history_local.mjs"

. (Join-Path $PSScriptRoot "spotify_history_import_helpers.ps1")

$remoteLockStream = $null
$remoteLockPath = Join-Path $workspace "remote-import.lock"

function Remove-ExtractedSource {
	if (-not $CleanupExtractedSource -or -not $extractedSourceDirectory) { return }
	$resolvedSource = [IO.Path]::GetFullPath($extractedSourceDirectory)
	if (-not ($resolvedSource + [IO.Path]::DirectorySeparatorChar).StartsWith($resolvedWorkspace, [StringComparison]::OrdinalIgnoreCase)) {
		throw "Refusing to remove an extracted source outside the private import workspace."
	}
	if (Test-Path -LiteralPath $resolvedSource) {
		Remove-Item -LiteralPath $resolvedSource -Recurse -Force
		Write-Host "Removed the private extracted archive copy."
	}
}

try {
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
	throw "wrangler.toml does not exist. Copy wrangler.example.toml and insert the generated D1 ID first."
}
if (-not (Test-Path -LiteralPath $devVarsPath -PathType Leaf)) {
	throw ".dev.vars does not exist. Run pnpm spotify:oauth first."
}
if (-not (Test-Path -LiteralPath $wranglerPath -PathType Leaf)) {
	throw "Wrangler is not installed. Run pnpm install first."
}

New-Item -ItemType Directory -Path $workspace -Force | Out-Null
$resolvedWorkspace = [IO.Path]::GetFullPath($workspace).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$sourceChecksum = $null
$extractedSourceDirectory = $null

function Invoke-Wrangler {
	param([string[]]$Arguments)
	& $wranglerPath @Arguments
	if ($LASTEXITCODE -ne 0) {
		throw "Wrangler exited with code $LASTEXITCODE."
	}
}

function Invoke-WranglerJson {
	param([string[]]$Arguments)
	$output = & $wranglerPath @Arguments
	if ($LASTEXITCODE -ne 0) {
		throw "Wrangler exited with code $LASTEXITCODE."
	}
	return $output | ConvertFrom-Json -NoEnumerate
}

function Assert-RemoteHistorySchema {
	$schema = Invoke-WranglerJson -Arguments @(
		"d1", "execute", "DB", "--remote", "--config", $configPath,
		"--command", "SELECT (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('history_imports', 'history_import_chunks')) AS required_tables, (SELECT COUNT(*) FROM pragma_table_info('tracks') WHERE name IN ('history_artist_name', 'history_album_name')) AS fallback_columns, (SELECT COUNT(*) FROM sqlite_master WHERE type = 'view' AND name = 'reporting_track_artists') AS reporting_views;",
		"--json"
	)
	if (
		[int]$schema[0].results[0].required_tables -ne 2 -or
		[int]$schema[0].results[0].fallback_columns -ne 2 -or
		[int]$schema[0].results[0].reporting_views -ne 1
	) {
		throw "Remote history migrations are not present. Apply remote migrations separately, review D1 usage, then rerun the import."
	}
}

function Assert-RemoteTarget {
	Assert-SpotifyHistoryRemoteTarget -ExpectedAccountId $ExpectedAccountId -ExpectedDatabaseId $ExpectedDatabaseId -ActualDatabaseId $ExpectedDatabaseId
	$env:CLOUDFLARE_ACCOUNT_ID = $ExpectedAccountId
	$databaseInfo = Invoke-WranglerJson -Arguments @("d1", "info", "DB", "--config", $configPath, "--json")
	$database = if ($databaseInfo -is [array]) { $databaseInfo[0] } else { $databaseInfo }
	$actualDatabaseId = if ($database.uuid) { [string]$database.uuid } else { [string]$database.id }
	Assert-SpotifyHistoryRemoteTarget -ExpectedAccountId $ExpectedAccountId -ExpectedDatabaseId $ExpectedDatabaseId -ActualDatabaseId $actualDatabaseId
	Write-Host "Verified remote D1 target $($database.name) ($actualDatabaseId) in account $ExpectedAccountId."
}

function Get-EarliestPlay {
	param([switch]$Local)
	$scope = if ($Local) { "--local" } else { "--remote" }
	$schemaOutput = & $wranglerPath d1 execute DB $scope --config $configPath --command "SELECT COUNT(*) AS source_columns FROM pragma_table_info('plays') WHERE name = 'source';" --json
	if ($LASTEXITCODE -ne 0) { throw "Could not inspect the D1 plays schema." }
	$schemaPayload = $schemaOutput | ConvertFrom-Json
	$hasSourceColumn = [int]$schemaPayload[0].results[0].source_columns -gt 0
	$query = if ($hasSourceColumn) {
		"SELECT MIN(played_at) AS cutoff FROM plays WHERE source = 'spotify_api';"
	} else {
		"SELECT MIN(played_at) AS cutoff FROM plays;"
	}
	$output = & $wranglerPath d1 execute DB $scope --config $configPath --command $query --json
	if ($LASTEXITCODE -ne 0) { throw "Could not query the earliest live D1 play." }
	$payload = $output | ConvertFrom-Json
	$value = $payload[0].results[0].cutoff
	if (-not $value) {
		throw "D1 has no Spotify API play to use as a cutoff. Supply -Cutoff explicitly after reviewing the boundary."
	}
	return ConvertTo-SpotifyHistoryUtcTimestamp -Value $value
}

if ($Mode -eq "ApplyRemote") {
	if (-not $CronPaused) { throw "ApplyRemote requires -CronPaused after the deployed Cron Trigger has been removed." }
	if ($MaxChunks -le 0) { throw "ApplyRemote requires an explicit positive -MaxChunks value to bound D1 writes for this run." }
	if ($RemainingWriteBudget -le 0) { throw "ApplyRemote requires -RemainingWriteBudget based on the current UTC-day D1 allowance." }
	try {
		$remoteLockStream = [IO.FileStream]::new($remoteLockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
	} catch {
		throw "Another remote Spotify history import is running from this workspace."
	}
	Assert-RemoteTarget
	Assert-RemoteHistorySchema
} elseif (-not $Cutoff -and $Mode -ne "ApplyLocal") {
	Assert-RemoteTarget
}

if ([IO.Path]::GetExtension($resolvedInput) -ieq ".zip") {
	$sourceChecksum = (Get-FileHash -LiteralPath $resolvedInput -Algorithm SHA256).Hash.ToLowerInvariant()
	$sourceDirectory = Join-Path $workspace "sources/$sourceChecksum"
	$resolvedSourceDirectory = [IO.Path]::GetFullPath($sourceDirectory)
	if (-not ($resolvedSourceDirectory + [IO.Path]::DirectorySeparatorChar).StartsWith($resolvedWorkspace, [StringComparison]::OrdinalIgnoreCase)) {
		throw "The archive extraction path escaped the private import workspace."
	}
	$completionMarker = Join-Path $resolvedSourceDirectory ".complete"
	if (-not (Test-Path -LiteralPath $completionMarker -PathType Leaf)) {
		if (Test-Path -LiteralPath $resolvedSourceDirectory) {
			Remove-Item -LiteralPath $resolvedSourceDirectory -Recurse -Force
		}
		New-Item -ItemType Directory -Path $resolvedSourceDirectory -Force | Out-Null
		Expand-Archive -LiteralPath $resolvedInput -DestinationPath $resolvedSourceDirectory
		Set-Content -LiteralPath $completionMarker -Value $sourceChecksum -Encoding utf8NoBOM
	}
	$resolvedInput = $resolvedSourceDirectory
	$extractedSourceDirectory = $resolvedSourceDirectory
}

if (-not $Cutoff) {
	$Cutoff = Get-EarliestPlay -Local:($Mode -eq "ApplyLocal")
} else {
	$Cutoff = ConvertTo-SpotifyHistoryUtcTimestamp -Value $Cutoff
}

$runDirectory = Join-Path $workspace "runs"
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
$resultFile = Join-Path $runDirectory "$([guid]::NewGuid().ToString('N')).json"
$arguments = @(
	$cliPath,
	"--input", $resolvedInput,
	"--cutoff", $Cutoff,
	"--workspace", $workspace,
	"--dev-vars", $devVarsPath,
	"--result-file", $resultFile,
	"--chunk-size", $ChunkSize,
	"--metadata-concurrency", $MetadataConcurrency,
	"--metadata-mode", $MetadataMode.ToLowerInvariant().Replace("cacheonly", "cache-only")
)
if ($sourceChecksum) { $arguments += @("--source-checksum", $sourceChecksum) }
if ($Mode -eq "Report") { $arguments += "--report-only" }

$plannerOutput = & $nodePath @arguments
if ($LASTEXITCODE -ne 0) { throw "The Spotify history planner exited with code $LASTEXITCODE." }
$result = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json

Write-Host "History report: $($result.reportPath)"
Write-Host "Records: $($result.report.totalRecords) total, $($result.report.importableRecords) importable, $($result.report.skippedRecords) skipped"
Write-Host "Range: $($result.report.earliestEndedAt) to $($result.report.latestEndedAt)"
Write-Host "Plan: $($result.report.chunkCount) chunks; rough planning estimate $($result.report.estimatedRowsWritten) D1 row writes"

if (-not (Test-SpotifyHistoryModeWritesD1 -Mode $Mode)) {
	exit 0
}

$scope = if ($Mode -eq "ApplyLocal") { "--local" } else { "--remote" }
if ($Mode -eq "ApplyLocal") {
	Invoke-Wrangler -Arguments @("d1", "migrations", "apply", "DB", "--local", "--config", $configPath)
}

$chunkFiles = @($result.chunkFiles)
$chunks = @($result.chunks)
if ($StartChunk -gt $chunkFiles.Count -and $chunkFiles.Count -gt 0) {
	throw "StartChunk $StartChunk is beyond the plan's $($chunkFiles.Count) chunks."
}
$lastChunk = if ($MaxChunks -gt 0) {
	[Math]::Min($chunkFiles.Count, $StartChunk + $MaxChunks - 1)
} else {
	$chunkFiles.Count
}

$remainingBudget = $RemainingWriteBudget
$remainingBudget = Get-SpotifyHistoryBudgetAfterInitialization -Mode $Mode -RemainingWriteBudget $remainingBudget
$planFingerprint = [string]$result.report.planFingerprint
if ($Mode -eq "ApplyRemote") {
	$preflightState = Invoke-WranglerJson -Arguments @(
		"d1", "execute", "DB", "--remote", "--config", $configPath,
		"--command", "SELECT COUNT(*) AS completed_chunks FROM history_import_chunks WHERE plan_fingerprint = '$planFingerprint';",
		"--json"
	)
	if ([int]$preflightState[0].results[0].completed_chunks -eq 0) {
		if ($MaxChunks -ne 1) { throw "The first remote run is a calibration run and requires -MaxChunks 1." }
		if ($ChunkSize -gt 250) { throw "The first remote calibration requires -ChunkSize 250 or smaller." }
	}
}
Invoke-WranglerJson -Arguments @(
	"d1", "execute", "DB", $scope, "--config", $configPath,
	"--file", $result.initializeFile, "--yes", "--json"
) | Out-Null

$planState = Invoke-WranglerJson -Arguments @(
	"d1", "execute", "DB", $scope, "--config", $configPath,
	"--command", "SELECT source_checksum, cutoff_at, chunk_size, total_chunks, status FROM history_imports WHERE plan_fingerprint = '$planFingerprint';",
	"--json"
)
$persistedPlan = $planState[0].results[0]
if (-not $persistedPlan) { throw "The D1 import plan could not be initialized." }
if (
	[string]$persistedPlan.source_checksum -ne [string]$result.report.sourceChecksum -or
	(ConvertTo-SpotifyHistoryUtcTimestamp -Value $persistedPlan.cutoff_at) -ne (ConvertTo-SpotifyHistoryUtcTimestamp -Value $result.report.cutoff) -or
	[int]$persistedPlan.chunk_size -ne [int]$result.report.chunkSize -or
	[int]$persistedPlan.total_chunks -ne [int]$result.report.chunkCount
) {
	throw "The persisted D1 plan does not match the generated plan. No chunks were applied."
}

function Get-PersistedChunks {
	$payload = Invoke-WranglerJson -Arguments @(
		"d1", "execute", "DB", $scope, "--config", $configPath,
		"--command", "SELECT chunk_number, chunk_checksum, expected_records, reported_rows_written FROM history_import_chunks WHERE plan_fingerprint = '$planFingerprint' ORDER BY chunk_number;",
		"--json"
	)
	return @($payload[0].results)
}

$persistedChunks = @(Get-PersistedChunks)
$persistedByNumber = Get-SpotifyHistoryPersistedChunkMap -PersistedChunks $persistedChunks -ExpectedChunks $chunks
for ($chunkNumber = 1; $chunkNumber -lt $StartChunk; $chunkNumber += 1) {
	if (-not $persistedByNumber.ContainsKey($chunkNumber)) {
		throw "Chunk $chunkNumber is not recorded in D1. Resume from the earliest missing chunk."
	}
}

if ($Mode -eq "ApplyLocal") {
	$pendingChunks = @($chunks | Where-Object {
		$number = [int]$_.chunkNumber
		$number -ge $StartChunk -and $number -le $lastChunk -and -not $persistedByNumber.ContainsKey($number)
	})
	if ($pendingChunks.Count -gt 0) {
		$localStateDirectory = Join-Path $repoRoot ".wrangler/state/v3/d1/miniflare-D1DatabaseObject"
		$localDatabases = @(Get-ChildItem -LiteralPath $localStateDirectory -Filter "*.sqlite" -File |
			Where-Object { $_.Name -ne "metadata.sqlite" })
		if ($localDatabases.Count -ne 1) {
			throw "Expected exactly one Wrangler local D1 database, but found $($localDatabases.Count)."
		}
		Write-Host "Applying $($pendingChunks.Count) pending chunks in one local SQLite transaction..."
		$localResult = & $nodePath $localApplyPath `
			--database $localDatabases[0].FullName `
			--plan-directory $result.planDirectory `
			--fingerprint $planFingerprint `
			--start-chunk $StartChunk `
			--end-chunk $lastChunk
		if ($LASTEXITCODE -ne 0) { throw "The local D1 batch executor exited with code $LASTEXITCODE." }
		$localApplied = $localResult | ConvertFrom-Json
		Write-Host "Applied $($localApplied.applied) local chunks."
	}

	$persistedChunks = @(Get-PersistedChunks)
	$persistedByNumber = Get-SpotifyHistoryPersistedChunkMap -PersistedChunks $persistedChunks -ExpectedChunks $chunks
	foreach ($chunk in $pendingChunks) {
		if (-not $persistedByNumber.ContainsKey([int]$chunk.chunkNumber)) {
			throw "Local D1 did not record chunk $($chunk.chunkNumber). Resume from the earliest missing chunk."
		}
	}
	if ($persistedChunks.Count -eq $chunkFiles.Count -and [string]$persistedPlan.status -ne "completed") {
		Invoke-WranglerJson -Arguments @(
			"d1", "execute", "DB", "--local", "--config", $configPath,
			"--file", $result.auditFile, "--yes", "--json"
		) | Out-Null
	}
	Write-Host "D1 records $($persistedChunks.Count) of $($chunkFiles.Count) chunks for plan $planFingerprint."
	exit 0
}

$calibratedRates = @($persistedChunks | Where-Object {
	$null -ne $_.reported_rows_written -and [int]$_.expected_records -gt 0
} | ForEach-Object {
	[double]$_.reported_rows_written / [double]$_.expected_records
})
if ($Mode -eq "ApplyRemote" -and $calibratedRates.Count -eq 0) {
	if ($MaxChunks -ne 1) { throw "The first remote run is a calibration run and requires -MaxChunks 1." }
	if ($ChunkSize -gt 250) { throw "The first remote calibration requires -ChunkSize 250 or smaller." }
}
for ($chunkNumber = $StartChunk; $chunkNumber -le $lastChunk; $chunkNumber += 1) {
	$chunk = $chunks[$chunkNumber - 1]
	if ($persistedByNumber.ContainsKey($chunkNumber)) {
		$persistedChunk = $persistedByNumber[$chunkNumber]
		if ([string]$persistedChunk.chunk_checksum -ne [string]$chunk.checksum) {
			throw "D1 chunk $chunkNumber has a different checksum. Stop and review the plan before continuing."
		}
		Write-Host "Chunk $chunkNumber is already recorded in D1; skipping."
		continue
	}
	if ($Mode -eq "ApplyRemote") {
		$calibratedEstimate = if ($calibratedRates.Count -gt 0) {
			([double]($calibratedRates | Measure-Object -Maximum).Maximum) * [double]$chunk.expectedRecords * 2
		} else {
			0
		}
		$admissionEstimate = [Math]::Ceiling([Math]::Max([double]$chunk.estimatedRowsWritten * 2, $calibratedEstimate) + 10)
		if ($admissionEstimate -gt $remainingBudget) {
			Write-Host "Stopping before chunk ${chunkNumber}: estimated $admissionEstimate writes exceeds the remaining run budget of $remainingBudget."
			break
		}
	}
	Write-Host "Applying chunk $chunkNumber of $($chunkFiles.Count)..."
	$chunkResponse = Invoke-WranglerJson -Arguments @(
		"d1", "execute", "DB", $scope, "--config", $configPath,
		"--file", $chunk.path, "--yes", "--json"
	)
	$confirmedChunks = @(Get-PersistedChunks)
	$confirmedChunk = @($confirmedChunks | Where-Object { [int]$_.chunk_number -eq $chunkNumber })[0]
	if (
		-not $confirmedChunk -or
		[string]$confirmedChunk.chunk_checksum -ne [string]$chunk.checksum -or
		[int]$confirmedChunk.expected_records -ne [int]$chunk.expectedRecords
	) {
		throw "D1 did not record the expected marker for chunk $chunkNumber. Stop before continuing."
	}
	$rowsWritten = 0
	$finalBookmark = $null
	foreach ($entry in @($chunkResponse)) {
		if ($null -ne $entry.meta.rows_written) { $rowsWritten += [int]$entry.meta.rows_written }
		if ($entry.meta.finalBookmark) { $finalBookmark = [string]$entry.meta.finalBookmark }
	}
	if ($Mode -eq "ApplyRemote") {
		$bookmarkSql = if ($finalBookmark -and $finalBookmark -match '^[A-Za-z0-9-]+$') { "'$finalBookmark'" } else { "NULL" }
		Invoke-WranglerJson -Arguments @(
			"d1", "execute", "DB", "--remote", "--config", $configPath,
			"--command", "UPDATE history_import_chunks SET reported_rows_written = $rowsWritten, final_bookmark = $bookmarkSql, updated_at = CURRENT_TIMESTAMP WHERE plan_fingerprint = '$planFingerprint' AND chunk_number = $chunkNumber AND chunk_checksum = '$($chunk.checksum)';",
			"--json"
		) | Out-Null
		$recordedChunks = @(Get-PersistedChunks)
		$recordedMap = Get-SpotifyHistoryPersistedChunkMap -PersistedChunks $recordedChunks -ExpectedChunks $chunks
		$recordedChunk = $recordedMap[$chunkNumber]
		if (
			-not $recordedChunk -or
			[string]$recordedChunk.chunk_checksum -ne [string]$chunk.checksum -or
			[int]$recordedChunk.reported_rows_written -ne $rowsWritten
		) {
			throw "D1 did not preserve the expected checksum and write metadata for chunk $chunkNumber."
		}
		$remainingBudget -= ($rowsWritten + 3)
		Write-Host "Chunk $chunkNumber reported $rowsWritten rows written; remaining run budget is $remainingBudget."
		if ([int]$chunk.expectedRecords -gt 0) {
			$calibratedRates += [double]$rowsWritten / [double]$chunk.expectedRecords
		}
	}
	$persistedByNumber[$chunkNumber] = [pscustomobject]@{
		chunk_number = $chunkNumber
		chunk_checksum = $chunk.checksum
		expected_records = $chunk.expectedRecords
		reported_rows_written = if ($Mode -eq "ApplyRemote") { $rowsWritten } else { $null }
	}
}

$persistedChunks = @(Get-PersistedChunks)
$allApplied = $persistedChunks.Count -eq $chunkFiles.Count
if ($allApplied -and [string]$persistedPlan.status -ne "completed") {
	if ($Mode -eq "ApplyRemote" -and $remainingBudget -lt 3) {
		Write-Host "All chunks are applied, but finalization is deferred because fewer than 3 budgeted writes remain."
	} else {
		Write-Host "All chunks are applied; recording the completed import audit."
		Invoke-WranglerJson -Arguments @(
			"d1", "execute", "DB", $scope, "--config", $configPath,
			"--file", $result.auditFile, "--yes", "--json"
		) | Out-Null
	}
}

Write-Host "D1 records $($persistedChunks.Count) of $($chunkFiles.Count) chunks for plan $planFingerprint."
} finally {
	Remove-ExtractedSource
	if ($remoteLockStream) {
		$remoteLockStream.Dispose()
	}
}
