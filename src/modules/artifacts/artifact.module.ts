import type { IArtifactStore } from "./base.artifact.js";

export type ArtifactModuleOptions = {
	/** Maximum upload size in bytes. Unlimited when unset. */
	maxSizeBytes?: number;
	/** Allowed upload mime types; supports "type/*" wildcards. All allowed when unset. */
	allowedMimeTypes?: string[];
};

export class ArtifactModule {
	private artifactStore: IArtifactStore;
	private options: ArtifactModuleOptions;

	constructor(
		artifactStore: IArtifactStore,
		options: ArtifactModuleOptions = {},
	) {
		this.artifactStore = artifactStore;
		this.options = options;
	}

	public getStore(): IArtifactStore {
		return this.artifactStore;
	}

	public getOptions(): ArtifactModuleOptions {
		return this.options;
	}
}
