import type { NextFunction, Request, Response } from "express";
import type { ArtifactService } from "@/services/artifact.service";

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
