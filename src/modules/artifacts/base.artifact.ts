import type {
	ArtifactDownloadResult,
	ArtifactObject,
	ArtifactPutInput,
} from "@/types/artifact";

export interface IArtifactStore {
	put(input: ArtifactPutInput): Promise<ArtifactObject>;
	get(artifactId: string): Promise<ArtifactObject | undefined>;
	delete(artifactId: string): Promise<void>;
	openDownload(artifactId: string): Promise<ArtifactDownloadResult>;
}
