import type { Request, Router } from "express";
import type { DocumentFilter } from "./document.js";

/**
 * Policy-agnostic permission resolver. The core knows nothing about roles,
 * venues, or logbooks — it only calls these two methods. Implemented by a
 * consumer (e.g. client-agent's RoleResolver).
 */
export interface PermissionResolver {
	/** Single-resource decision (write/byId/gate). `attrs` carries resource
	 * attributes such as `{ venue }`. Returns true if allowed. */
	can(
		userId: string,
		resource: string,
		action: string,
		attrs?: Record<string, string>,
	): Promise<boolean>;
	/** List decision: the filter to apply to a list query. `null` = unrestricted,
	 * `"deny"` = no access (empty result). */
	listFilter(
		userId: string,
		resource: string,
	): Promise<DocumentFilter | null | "deny">;
}

export type AuthzMode = "list" | "byId" | "fromBody" | "gate";

export interface RouteRequirement {
	/** HTTP method, e.g. "GET" | "POST". */
	method: string;
	/** Full express path incl. mount prefix, e.g. "/api/document/:id". */
	path: string;
	resource: string;
	action: "read" | "write";
	mode: AuthzMode;
	/** byId mode: load the target's attributes (e.g. its venue). Return null →
	 * 404 (target missing). Return "skip" → not governed by authz (the handler's
	 * own checks apply). Return attrs → run can(). */
	loadAttrs?: (req: Request) => Promise<Record<string, string> | null | "skip">;
	/** fromBody mode: extract attributes from the body. Return "skip" → not
	 * governed by authz. */
	bodyAttrs?: (req: Request) => Record<string, string> | "skip";
}

export interface AuthzConfig {
	resolver: PermissionResolver;
	/** Route → requirement bindings. Undeclared routes pass through. */
	routes: RouteRequirement[];
	/** Optional admin router (e.g. roles CRUD), mounted under /api/admin and
	 * guarded by the same authorize middleware. */
	adminRouter?: Router;
}
