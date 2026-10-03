import { ingestRecentlyPlayed } from "./ingest";
import { handleListeningRequest } from "./auth";
import { refreshRecommendations } from "./recommendations";
import type { Env, ExecutionContextLike, ScheduledControllerLike } from "./runtime";

export default {
	fetch(request: Request, env: Env, context: ExecutionContextLike): Promise<Response> {
		return handleListeningRequest(request, env, context);
	},

	scheduled(_controller: ScheduledControllerLike, env: Env, context: ExecutionContextLike): void {
		const ingestion = ingestRecentlyPlayed(env);
		context.waitUntil(ingestion);
		if (env.RECOMMENDATIONS_ENABLED === "true") context.waitUntil(ingestion.then(() => refreshRecommendations(env)).catch(() => {
			console.warn("Album recommendation refresh unavailable");
		}));
	},
};
