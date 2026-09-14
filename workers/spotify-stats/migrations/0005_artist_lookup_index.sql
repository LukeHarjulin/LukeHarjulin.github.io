-- Resolve one historical artist name at a time. The previous grouped CTE
-- rebuilt all name matches even when a recent-play query needed one track.
CREATE INDEX idx_artists_normalized_name ON artists (lower(trim(name)))
	WHERE length(trim(name)) > 0;

DROP VIEW reporting_track_artists;
CREATE VIEW reporting_track_artists AS
SELECT
	ta.spotify_track_id,
	a.spotify_artist_id AS artist_id,
	a.name,
	a.spotify_url,
	ta.artist_order
FROM track_artists ta
JOIN artists a ON a.spotify_artist_id = ta.spotify_artist_id

UNION ALL

SELECT
	t.spotify_track_id,
	COALESCE(a.spotify_artist_id, 'history:' || lower(trim(t.history_artist_name))) AS artist_id,
	COALESCE(a.name, trim(t.history_artist_name)) AS name,
	a.spotify_url,
	0 AS artist_order
FROM tracks t
LEFT JOIN artists a ON a.spotify_artist_id = (
	SELECT CASE WHEN COUNT(*) = 1 THEN MIN(candidate.spotify_artist_id) END
	FROM artists candidate
	WHERE length(trim(candidate.name)) > 0
		AND lower(trim(candidate.name)) = lower(trim(t.history_artist_name))
)
WHERE NOT EXISTS (
	SELECT 1 FROM track_artists ta WHERE ta.spotify_track_id = t.spotify_track_id
)
	AND length(trim(COALESCE(t.history_artist_name, ''))) > 0;
