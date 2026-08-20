import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
	ArtifactDownloadResult,
	ArtifactObject,
	ArtifactPutInput,
} from "@/types/artifact";
import type { IArtifactStore } from "./base.artifact.js";

const SAFE_ARTIFACT_ID = /^[A-Za-z0-9-]+$/;
const PREVIEW_MAX_CHARS = 4000;
const TEXT_LIKE_MIME_TYPES = new Set([
	"application/json",
	"application/xml",
	"application/javascript",
]);

function isTextLike(mimeType: string): boolean {
	return mimeType.startsWith("text/") || TEXT_LIKE_MIME_TYPES.has(mimeType);
}

/**
 * Filesystem-backed artifact store for local development and simple
 * single-node deployments. Each artifact is stored as a binary file plus a
 * JSON metadata sidecar under `baseDir`.
 */
export class LocalArtifactStore implements IArtifactStore {
	private baseDir: string;

	constructor(options: { baseDir: string }) {
		this.baseDir = options.baseDir;
	}

	private metadataPath(artifactId: string): string {
		return path.join(this.baseDir, `${artifactId}.json`);
	}

	private binaryPath(artifactId: string): string {
		return path.join(this.baseDir, `${artifactId}.bin`);
	}

	public async put(input: ArtifactPutInput): Promise<ArtifactObject> {
		const artifactId = randomUUID();
		const data = input.data;

		const artifact: ArtifactObject = {
			artifactId,
			userId: input.userId,
			threadId: input.threadId,
			messageId: input.messageId,
			status: "ready",
			name: input.name,
			mimeType: input.mimeType,
			size: data.byteLength,
			checksum: createHash("sha256").update(data).digest("hex"),
			storageKey: `${artifactId}.bin`,
			metadata: input.metadata,
			createdAt: Date.now(),
		};

		if (isTextLike(input.mimeType)) {
			artifact.previewText = new TextDecoder()
				.decode(data)
				.slice(0, PREVIEW_MAX_CHARS);
			artifact.previewStatus = "ready";
		}

		await mkdir(this.baseDir, { recursive: true });
		await writeFile(this.binaryPath(artifactId), data);
		await writeFile(this.metadataPath(artifactId), JSON.stringify(artifact));
		return artifact;
	}

	public async get(artifactId: string): Promise<ArtifactObject | undefined> {
		if (!SAFE_ARTIFACT_ID.test(artifactId)) {
			return undefined;
		}
		try {
			const raw = await readFile(this.metadataPath(artifactId), "utf8");
			return JSON.parse(raw) as ArtifactObject;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return undefined;
			}
			throw error;
		}
	}

	public async delete(artifactId: string): Promise<void> {
		if (!SAFE_ARTIFACT_ID.test(artifactId)) {
			return;
		}
		await rm(this.metadataPath(artifactId), { force: true });
		await rm(this.binaryPath(artifactId), { force: true });
	}

	// ponytail: O(n) sidecar scan per call; index by threadId if stores grow large
	public async listByThread(threadId: string): Promise<ArtifactObject[]> {
		let entries: string[];
		try {
			entries = await readdir(this.baseDir);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return [];
			}
			throw error;
		}

		const artifacts = await Promise.all(
			entries
				.filter((entry) => entry.endsWith(".json"))
				.map((entry) => this.get(entry.slice(0, -".json".length))),
		);
		return artifacts.filter(
			(artifact): artifact is ArtifactObject =>
				artifact !== undefined && artifact.threadId === threadId,
		);
	}

	public async openDownload(
		artifactId: string,
	): Promise<ArtifactDownloadResult> {
		const artifact = await this.get(artifactId);
		if (!artifact) {
			throw new Error("Artifact not found");
		}

		const body = await readFile(this.binaryPath(artifactId));
		return {
			body: new Uint8Array(body),
			mimeType: artifact.mimeType,
			fileName: artifact.name,
			contentLength: artifact.size,
			metadata: artifact.metadata,
		};
	}
}
