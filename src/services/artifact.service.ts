import { StatusCodes } from "http-status-codes";
import type { ArtifactModule } from "@/modules";
import { AinHttpError } from "@/types/agent";
import type {
	ArtifactDownloadResult,
	ArtifactObject,
	ArtifactPutInput,
} from "@/types/artifact";
import type {
	QueryArtifactInputPart,
	QueryMessageInput,
} from "@/types/message-input";

export class ArtifactService {
	private artifactModule?: ArtifactModule;

	constructor(artifactModule?: ArtifactModule) {
		this.artifactModule = artifactModule;
	}

	private getStore() {
		const store = this.artifactModule?.getStore();
		if (!store) {
			throw new AinHttpError(
				StatusCodes.SERVICE_UNAVAILABLE,
				"Artifact module is not initialized",
				"ARTIFACT_STORE_NOT_CONFIGURED",
			);
		}
		return store;
	}

	private assertArtifactAccess(userId: string, artifact: ArtifactObject): void {
		if (artifact.userId && artifact.userId !== userId) {
			throw new AinHttpError(
				StatusCodes.FORBIDDEN,
				"Artifact access denied",
				"ARTIFACT_ACCESS_DENIED",
			);
		}
	}

	private assertArtifactReady(artifact: ArtifactObject): void {
		if (artifact.status !== "ready") {
			throw new AinHttpError(
				StatusCodes.CONFLICT,
				"Artifact is not ready",
				"ARTIFACT_NOT_READY",
			);
		}
	}

	private buildDownloadUrl(artifactId: string): string {
		return `/api/artifacts/${artifactId}/download`;
	}

	public async getArtifact(
		userId: string,
		artifactId: string,
	): Promise<ArtifactObject> {
		const store = this.getStore();
		const artifact = await store.get(artifactId);
		if (!artifact) {
			throw new AinHttpError(
				StatusCodes.NOT_FOUND,
				"Artifact not found",
				"ARTIFACT_NOT_FOUND",
			);
		}

		this.assertArtifactAccess(userId, artifact);
		return artifact;
	}

	public async openDownload(
		userId: string,
		artifactId: string,
	): Promise<ArtifactDownloadResult> {
		await this.getArtifact(userId, artifactId);
		return this.getStore().openDownload(artifactId);
	}

	public async uploadArtifact(
		userId: string,
		input: Omit<ArtifactPutInput, "userId">,
	): Promise<ArtifactObject> {
		return this.getStore().put({
			...input,
			userId,
		});
	}

	public async resolveQueryInputArtifacts(
		userId: string,
		input: QueryMessageInput,
	): Promise<QueryMessageInput> {
		const parts = await Promise.all(
			input.parts.map(async (part) => {
				if (part.kind !== "artifact") {
					return part;
				}

				const artifact = await this.getArtifact(userId, part.artifactId);
				this.assertArtifactReady(artifact);

				const resolvedPart: QueryArtifactInputPart = {
					kind: "artifact",
					artifactId: artifact.artifactId,
					name: artifact.name,
					mimeType: artifact.mimeType,
					size: artifact.size,
					downloadUrl: this.buildDownloadUrl(artifact.artifactId),
					previewText: artifact.previewText,
				};

				return resolvedPart;
			}),
		);

		return { parts };
	}
}
