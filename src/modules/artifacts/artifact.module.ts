import type { IArtifactStore } from "./base.artifact.js";

export class ArtifactModule {
	private artifactStore: IArtifactStore;

	constructor(artifactStore: IArtifactStore) {
		this.artifactStore = artifactStore;
	}

	public getStore(): IArtifactStore {
		return this.artifactStore;
	}
}
