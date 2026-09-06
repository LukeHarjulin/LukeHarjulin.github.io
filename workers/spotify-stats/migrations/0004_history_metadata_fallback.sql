ALTER TABLE tracks ADD COLUMN history_artist_name TEXT;
ALTER TABLE tracks ADD COLUMN history_album_name TEXT;

CREATE VIEW reporting_track_artists AS
WITH authoritative_name_matches AS (
	SELECT
		lower(trim(name)) AS normalized_name,
		CASE WHEN COUNT(*) = 1 THEN MIN(spotify_artist_id) END AS spotify_artist_id
	FROM artists
	WHERE length(trim(name)) > 0
	GROUP BY lower(trim(name))
)
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
LEFT JOIN authoritative_name_matches match
	ON match.normalized_name = lower(trim(t.history_artist_name))
LEFT JOIN artists a ON a.spotify_artist_id = match.spotify_artist_id
WHERE NOT EXISTS (
	SELECT 1
	FROM track_artists ta
	WHERE ta.spotify_track_id = t.spotify_track_id
)
	AND length(trim(COALESCE(t.history_artist_name, ''))) > 0;
