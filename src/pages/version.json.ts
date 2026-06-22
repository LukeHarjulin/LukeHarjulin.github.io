export const prerender = true;

const metadata = {
	commit: import.meta.env.PUBLIC_GIT_SHA ?? "local",
	ref: import.meta.env.PUBLIC_GIT_REF ?? "local",
	version: import.meta.env.PUBLIC_VERSION_LABEL ?? "local",
	deployedAt: import.meta.env.PUBLIC_DEPLOYED_AT ?? null
};

export function GET() {
	return new Response(JSON.stringify(metadata, null, 2), {
		headers: {
			"Content-Type": "application/json; charset=utf-8"
		}
	});
}
