export interface D1Result<T = unknown> {
	results?: T[];
	success: boolean;
	meta?: Record<string, unknown>;
}

export interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement;
	first<T = unknown>(column?: string): Promise<T | null>;
	all<T = unknown>(): Promise<D1Result<T>>;
	run<T = unknown>(): Promise<D1Result<T>>;
}

export interface D1Database {
	prepare(query: string): D1PreparedStatement;
	batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface Env {
	DB: D1Database;
	SPOTIFY_CLIENT_ID: string;
	SPOTIFY_CLIENT_SECRET: string;
	SPOTIFY_REFRESH_TOKEN: string;
	PUBLIC_SITE_ORIGIN?: string;
}

export interface ExecutionContextLike {
	waitUntil(promise: Promise<unknown>): void;
}

export interface ScheduledControllerLike {
	cron: string;
	scheduledTime: number;
}
