import { ingestRecentlyPlayed } from "./ingest";
import { cachedRouteRequest } from "./cache";
import type { Env, ExecutionContextLike, ScheduledControllerLike } from "./runtime";

export default {
	fetch(request: Request, env: Env, context: ExecutionContextLike): Promise<Response> {
		return cachedRouteRequest(request, env, context);
	},

	scheduled(_controller: ScheduledControllerLike, env: Env, context: ExecutionContextLike): void {
		context.waitUntil(ingestRecentlyPlayed(env));
	},
};
