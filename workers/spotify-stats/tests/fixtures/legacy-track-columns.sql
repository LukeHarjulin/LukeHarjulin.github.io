t.spotify_track_id AS id,
t.name,
t.duration_ms AS durationMs,
t.spotify_url AS spotifyUrl,
COALESCE(a.spotify_album_id, '') AS albumId,
COALESCE(a.name, t.history_album_name, '') AS albumName,
a.artwork_url AS artworkUrl,
COALESCE((
	SELECT json_group_array(json_object('id', artist.artist_id, 'name', artist.name))
	FROM (
		SELECT ordered_artist.artist_id, ordered_artist.name
		FROM reporting_track_artists ordered_artist
		WHERE ordered_artist.spotify_track_id = t.spotify_track_id
		ORDER BY ordered_artist.artist_order
	) artist
), '[]') AS artistsJson
