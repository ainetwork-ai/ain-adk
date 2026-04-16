import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { ArtifactService } from "@/services/artifact.service";
import { AinHttpError } from "@/types/agent";
import type { ArtifactPutInput } from "@/types/artifact";

type ArtifactUploadRequestBody = {
	name?: unknown;
	mimeType?: unknown;
	data?: unknown;
	threadId?: unknown;
	messageId?: unknown;
	metadata?: unknown;
};

const BASE64_PATTERN =
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function validateUploadBody(
	body: ArtifactUploadRequestBody,
): Omit<ArtifactPutInput, "userId"> {
	if (typeof body.name !== "string" || body.name.trim() === "") {
		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			"Artifact upload requires a non-empty string 'name' field.",
			"INVALID_ARTIFACT_UPLOAD",
		);
	}

	if (typeof body.mimeType !== "string" || body.mimeType.trim() === "") {
		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			"Artifact upload requires a non-empty string 'mimeType' field.",
			"INVALID_ARTIFACT_UPLOAD",
		);
	}

	if (typeof body.data !== "string" || body.data.trim() === "") {
		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			"Artifact upload requires a base64 string 'data' field.",
			"INVALID_ARTIFACT_UPLOAD",
		);
	}

	if (!BASE64_PATTERN.test(body.data)) {
		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			"Artifact upload 'data' must be a valid base64 string.",
			"INVALID_ARTIFACT_UPLOAD",
		);
	}

	if (body.threadId !== undefined && typeof body.threadId !== "string") {
		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			"Artifact upload 'threadId' must be a string when provided.",
			"INVALID_ARTIFACT_UPLOAD",
		);
	}

	if (body.messageId !== undefined && typeof body.messageId !== "string") {
		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			"Artifact upload 'messageId' must be a string when provided.",
			"INVALID_ARTIFACT_UPLOAD",
		);
	}

	if (
		body.metadata !== undefined &&
		(typeof body.metadata !== "object" ||
			body.metadata === null ||
			Array.isArray(body.metadata))
	) {
		throw new AinHttpError(
			StatusCodes.BAD_REQUEST,
			"Artifact upload 'metadata' must be an object when provided.",
			"INVALID_ARTIFACT_UPLOAD",
		);
	}

	return {
		name: body.name,
		mimeType: body.mimeType,
		data: Buffer.from(body.data, "base64"),
		threadId: body.threadId,
		messageId: body.messageId,
		metadata: body.metadata as Record<string, unknown> | undefined,
	};
}

export class ArtifactApiController {
	private artifactService: ArtifactService;

	constructor(artifactService: ArtifactService) {
		this.artifactService = artifactService;
	}

	public handleGetArtifact = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const { id: artifactId } = req.params as { id: string };
			const userId = res.locals.userId || "";
			const artifact = await this.artifactService.getArtifact(
				userId,
				artifactId,
			);
			res.json(artifact);
		} catch (error) {
			next(error);
		}
	};

	public handleUploadArtifact = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const userId = res.locals.userId || "";
			const input = validateUploadBody(req.body as ArtifactUploadRequestBody);
			const artifact = await this.artifactService.uploadArtifact(userId, input);
			res.status(StatusCodes.CREATED).json(artifact);
		} catch (error) {
			next(error);
		}
	};

	public handleDownloadArtifact = async (
		req: Request,
		res: Response,
		next: NextFunction,
	) => {
		try {
			const { id: artifactId } = req.params as { id: string };
			const userId = res.locals.userId || "";
			const download = await this.artifactService.openDownload(
				userId,
				artifactId,
			);

			res.setHeader("Content-Type", download.mimeType);
			if (typeof download.contentLength === "number") {
				res.setHeader("Content-Length", String(download.contentLength));
			}
			if (download.fileName) {
				res.attachment(download.fileName);
			}

			res.send(Buffer.from(download.body));
		} catch (error) {
			next(error);
		}
	};
}
