export type AuthResponse = {
	isAuthenticated: boolean;
	userId?: string;
	/** Optional human identifier (e.g. email / UPN) for authorization keying.
	 * Providers set this when the token carries it; undefined otherwise. */
	email?: string;
};
