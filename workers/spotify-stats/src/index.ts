import { ingestRecentlyPlayed } from "./ingest";
import { routeRequest } from "./router";
import type { Env, ExecutionContextLike, ScheduledControllerLike } from "./runtime";

export default {
	fetch(request: Request, env: Env): Promise<Response> {
		return routeRequest(request, env);
	},

	scheduled(_controller: ScheduledControllerLike, env: Env, context: ExecutionContextLike): void {
		context.waitUntil(ingestRecentlyPlayed(env));
	},
};
