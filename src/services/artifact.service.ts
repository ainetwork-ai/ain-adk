import { StatusCodes } from "http-status-codes";
import type { ArtifactModule } from "@/modules";
import { AinHttpError } from "@/types/agent";
import type { ArtifactDownloadResult, ArtifactObject } from "@/types/artifact";

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
}
