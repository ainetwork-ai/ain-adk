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

		// Authorization is keyed on the human principal (email/UPN) when the
		// auth layer provides it, falling back to userId. Document ownership
		// stays keyed on userId (res.locals.userId) — handled by the controller.
		const principal: string = res.locals.email ?? res.locals.userId ?? "";
		try {
			if (match.mode === "list") {
				const filters = await resolver.listFilter(principal, match.resource);
				res.locals.authzChecked = true;
				if (filters === null) {
					res.locals.authzListAll = true; // unrestricted (admin)
				} else if (filters.length > 0) {
					res.locals.authzFilters = filters; // own ∪ these filters
				}
				// [] → leave both unset → handler returns the caller's own records
				return next();
			}

			if (match.mode === "byId") {
				// Additive: a matching role grants cross-user access (authzChecked).
				// Otherwise we defer to the handler's own owner check — no hard deny.
				const loaded = match.loadAttrs ? await match.loadAttrs(req) : null;
				if (loaded === null) {
					throw new AinHttpError(StatusCodes.NOT_FOUND, "Not found");
				}
				if (loaded !== "skip") {
					const allowed = await resolver.can(
						principal,
						match.resource,
						match.action,
						loaded,
					);
					if (allowed) res.locals.authzChecked = true;
				}
				// Target-state gate: on a write that also carries new attributes
				// (e.g. an update relabeling the record), require write access to the
				// *target* state too. Without this, a caller could create a personal
				// (ungoverned) record and then relabel it into a governed
				// category/scope they lack a role for — a create-then-relabel bypass.
				// bodyAttrs returns "skip" when the target isn't governed.
				if (match.action === "write" && match.bodyAttrs) {
					const target = match.bodyAttrs(req);
					if (target !== "skip") {
						const okTarget = await resolver.can(
							principal,
							match.resource,
							match.action,
							target,
						);
						if (!okTarget) {
							throw new AinHttpError(StatusCodes.FORBIDDEN, "Forbidden");
						}
					}
				}
				return next();
			}

			// fromBody / gate: hard gate (403 on deny).
			let attrs: Record<string, string> = {};
			if (match.mode === "fromBody") {
				const body = match.bodyAttrs ? match.bodyAttrs(req) : {};
				if (body === "skip") {
					return next(); // not a governed resource → handler's own checks
				}
				attrs = body;
			}
			const allowed = await resolver.can(
				principal,
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
