import type { Env } from "./runtime";

export interface SuccessOptions {
	period?: string;
	status?: number;
	cacheSeconds?: number;
	generatedAt?: Date;
}

export type ErrorCode =
	| "INVALID_PERIOD"
	| "INVALID_LIMIT"
	| "INVALID_QUERY"
	| "CORS_ORIGIN_DENIED"
	| "METHOD_NOT_ALLOWED"
	| "NOT_FOUND"
	| "UPSTREAM_RATE_LIMITED"
	| "SERVICE_UNAVAILABLE";

interface CorsRejection {
	code: "SERVICE_UNAVAILABLE" | "CORS_ORIGIN_DENIED";
	message: string;
	status: 403 | 503;
}

function configuredOrigin(env: Env): string | null {
	if (!env.PUBLIC_SITE_ORIGIN) {
		return null;
	}

	try {
		const url = new URL(env.PUBLIC_SITE_ORIGIN);
		return url.origin === env.PUBLIC_SITE_ORIGIN ? url.origin : null;
	} catch {
		return null;
	}
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
	const headers: Record<string, string> = {
		"Access-Control-Allow-Methods": "GET, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Max-Age": "86400",
		Vary: "Origin",
	};
	const requestOrigin = request.headers.get("Origin");
	const allowedOrigin = configuredOrigin(env);
	if (requestOrigin && allowedOrigin && requestOrigin === allowedOrigin) {
		headers["Access-Control-Allow-Origin"] = allowedOrigin;
	}
	return headers;
}

function json(body: unknown, request: Request, env: Env, status: number, cacheControl: string): Response {
	return Response.json(body, {
		status: status,
		headers: {
			...corsHeaders(request, env),
			"Cache-Control": cacheControl,
			"X-Content-Type-Options": "nosniff",
		},
	});
}

export function validateCors(request: Request, env: Env): CorsRejection | null {
	const requestOrigin = request.headers.get("Origin");
	if (!requestOrigin) {
		return null;
	}

	const allowedOrigin = configuredOrigin(env);
	if (!allowedOrigin) {
		return {
			code: "SERVICE_UNAVAILABLE",
			message: "Service unavailable",
			status: 503,
		};
	}

	return requestOrigin === allowedOrigin ? null : {
		code: "CORS_ORIGIN_DENIED",
		message: "This origin is not allowed",
		status: 403,
	};
}

export function success(data: unknown, request: Request, env: Env, options: SuccessOptions = {}): Response {
	const meta: { generatedAt: string; period?: string } = {
		generatedAt: (options.generatedAt ?? new Date()).toISOString(),
	};
	if (options.period) {
		meta.period = options.period;
	}

	return json(
		{ data, meta },
		request,
		env,
		options.status ?? 200,
		`public, max-age=${options.cacheSeconds ?? 60}`,
	);
}

export function failure(
	code: ErrorCode,
	message: string,
	request: Request,
	env: Env,
	status: number,
): Response {
	return json({ error: { code, message } }, request, env, status, "no-store");
}

export function options(request: Request, env: Env): Response {
	return success(null, request, env, { status: 200, cacheSeconds: 0 });
}
