import type { NextFunction, Request, RequestHandler, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AinHttpError } from "@/types/agent";
import type { PermissionResolver, RouteRequirement } from "@/types/authz";

/** Convert an express path ("/api/document/:id") to a matcher regex. */
function pathToRegex(path: string): RegExp {
	const escaped = path
		.split("/")
		.map((seg) =>
			seg.startsWith(":")
				? "[^/]+"
				: seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
		)
		.join("/");
	return new RegExp(`^${escaped}/?$`);
}

interface Compiled extends RouteRequirement {
	_re: RegExp;
}

export function createAuthzMiddleware(
	resolver: PermissionResolver,
	routes: RouteRequirement[],
): RequestHandler {
	const compiled: Compiled[] = routes.map((r) => ({
		...r,
		_re: pathToRegex(r.path),
	}));

	return async (req: Request, res: Response, next: NextFunction) => {
		// Full path including the mount prefix (req.path is mount-relative).
		const fullPath = `${req.baseUrl}${req.path}`;
		const match = compiled.find(
			(r) =>
				r.method.toUpperCase() === req.method.toUpperCase() &&
				r._re.test(fullPath),
		);
		if (!match) return next();

		const userId: string = res.locals.userId ?? "";
		try {
			if (match.mode === "list") {
				const filter = await resolver.listFilter(userId, match.resource);
				res.locals.authzChecked = true;
				if (filter === null) {
					res.locals.authzListAll = true; // unrestricted (admin)
				} else if (filter !== "deny") {
					res.locals.authzFilter = filter; // own ∪ this filter
				}
				// "deny" → leave both unset → controller returns own docs only
				return next();
			}

			let attrs: Record<string, string> = {};
			if (match.mode === "byId") {
				const loaded = match.loadAttrs ? await match.loadAttrs(req) : null;
				if (loaded === "skip") {
					return next(); // not governed → legacy owner check applies
				}
				if (loaded === null) {
					throw new AinHttpError(StatusCodes.NOT_FOUND, "Not found");
				}
				attrs = loaded;
			} else if (match.mode === "fromBody") {
				const body = match.bodyAttrs ? match.bodyAttrs(req) : {};
				if (body === "skip") {
					return next(); // not governed → legacy handler
				}
				attrs = body;
			}
			// "gate" → attrs stays {}
			const allowed = await resolver.can(
				userId,
				match.resource,
				match.action,
				attrs,
			);
			if (!allowed) {
				throw new AinHttpError(StatusCodes.FORBIDDEN, "Forbidden");
			}
			res.locals.authzChecked = true;
			return next();
		} catch (e) {
			return next(e);
		}
	};
}
