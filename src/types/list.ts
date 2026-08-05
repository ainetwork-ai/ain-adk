/** Pagination options for list queries (`?limit=&offset=`). */
export interface ListOptions {
	limit?: number;
	offset?: number;
}

/**
 * Envelope returned by list endpoints when the request carries `limit`.
 * Requests without `limit` get the legacy bare array instead.
 */
export interface PaginatedResult<T> {
	items: T[];
	total: number;
	limit: number;
	offset: number;
}
