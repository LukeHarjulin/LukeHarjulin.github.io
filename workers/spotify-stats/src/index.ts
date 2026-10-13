import { ingestRecentlyPlayed } from "./ingest";
import { handleListeningRequest } from "./auth";
import { refreshRecommendations } from "./recommendations";
import { enrichArtistGenres } from "./genre-enrichment";
import type { Env, ExecutionContextLike, ScheduledControllerLike } from "./runtime";

export default {
	fetch(request: Request, env: Env, context: ExecutionContextLike): Promise<Response> {
		return handleListeningRequest(request, env, context);
	},

	scheduled(_controller: ScheduledControllerLike, env: Env, context: ExecutionContextLike): void {
		const ingestion = ingestRecentlyPlayed(env);
		context.waitUntil(ingestion);
		if (env.RECOMMENDATIONS_ENABLED === "true" || env.GENRE_ENRICHMENT_ENABLED === "true") {
			context.waitUntil(ingestion.then(async () => {
				if (env.RECOMMENDATIONS_ENABLED === "true") {
					try { await refreshRecommendations(env); } catch { console.warn("Album recommendation refresh unavailable"); }
				}
				if (env.GENRE_ENRICHMENT_ENABLED === "true") {
					try { await enrichArtistGenres(env); } catch { console.warn("Artist genre enrichment unavailable"); }
				}
			}).catch(() => { console.warn("Catalogue maintenance skipped after ingestion failure"); }));
		}
	},
};
