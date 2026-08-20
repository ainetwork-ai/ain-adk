import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalArtifactStore } from "@/modules/artifacts/local.artifact";

describe("LocalArtifactStore", () => {
	let baseDir: string;
	let store: LocalArtifactStore;

	beforeEach(() => {
		baseDir = mkdtempSync(path.join(tmpdir(), "ain-adk-artifacts-"));
		store = new LocalArtifactStore({ baseDir });
	});

	afterEach(() => {
		rmSync(baseDir, { recursive: true, force: true });
	});

	it("puts an artifact and returns a ready artifact object", async () => {
		const artifact = await store.put({
			name: "hello.txt",
			mimeType: "text/plain",
			data: new TextEncoder().encode("hello world"),
			userId: "user-1",
			threadId: "thread-1",
		});

		expect(artifact.artifactId).toBeTruthy();
		expect(artifact.status).toBe("ready");
		expect(artifact.name).toBe("hello.txt");
		expect(artifact.mimeType).toBe("text/plain");
		expect(artifact.size).toBe(11);
		expect(artifact.userId).toBe("user-1");
		expect(artifact.threadId).toBe("thread-1");
		expect(artifact.checksum).toMatch(/^[0-9a-f]{64}$/);
		expect(artifact.createdAt).toBeGreaterThan(0);
	});

	it("persists metadata so get() works across store instances", async () => {
		const artifact = await store.put({
			name: "hello.txt",
			mimeType: "text/plain",
			data: new TextEncoder().encode("hello world"),
		});

		const reopened = new LocalArtifactStore({ baseDir });
		const fetched = await reopened.get(artifact.artifactId);

		expect(fetched).toEqual(artifact);
	});

	it("returns undefined for an unknown artifact id", async () => {
		await expect(store.get("missing")).resolves.toBeUndefined();
	});

	it("opens a download with the stored bytes and metadata", async () => {
		const artifact = await store.put({
			name: "hello.txt",
			mimeType: "text/plain",
			data: new TextEncoder().encode("hello world"),
		});

		const download = await store.openDownload(artifact.artifactId);

		expect(new TextDecoder().decode(download.body)).toBe("hello world");
		expect(download.mimeType).toBe("text/plain");
		expect(download.fileName).toBe("hello.txt");
		expect(download.contentLength).toBe(11);
	});

	it("throws when downloading an unknown artifact", async () => {
		await expect(store.openDownload("missing")).rejects.toThrow(
			"Artifact not found",
		);
	});

	it("deletes an artifact and its binary", async () => {
		const artifact = await store.put({
			name: "hello.txt",
			mimeType: "text/plain",
			data: new TextEncoder().encode("hello world"),
		});

		await store.delete(artifact.artifactId);

		await expect(store.get(artifact.artifactId)).resolves.toBeUndefined();
		await expect(store.openDownload(artifact.artifactId)).rejects.toThrow(
			"Artifact not found",
		);
	});

	it("extracts preview text for text-like artifacts", async () => {
		const artifact = await store.put({
			name: "notes.md",
			mimeType: "text/markdown",
			data: new TextEncoder().encode("# Title\nbody"),
		});

		expect(artifact.previewText).toBe("# Title\nbody");
		expect(artifact.previewStatus).toBe("ready");
	});

	it("skips preview text for binary artifacts", async () => {
		const artifact = await store.put({
			name: "image.png",
			mimeType: "image/png",
			data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
		});

		expect(artifact.previewText).toBeUndefined();
		expect(artifact.previewStatus).toBeUndefined();
	});

	it("lists artifacts belonging to a thread", async () => {
		const first = await store.put({
			name: "a.txt",
			mimeType: "text/plain",
			data: new TextEncoder().encode("a"),
			threadId: "thread-1",
		});
		await store.put({
			name: "b.txt",
			mimeType: "text/plain",
			data: new TextEncoder().encode("b"),
			threadId: "thread-2",
		});
		const third = await store.put({
			name: "c.txt",
			mimeType: "text/plain",
			data: new TextEncoder().encode("c"),
			threadId: "thread-1",
		});

		const listed = await store.listByThread("thread-1");

		expect(listed.map((a) => a.artifactId).sort()).toEqual(
			[first.artifactId, third.artifactId].sort(),
		);
	});

	it("returns an empty list for a thread without artifacts", async () => {
		await expect(store.listByThread("missing-thread")).resolves.toEqual([]);
	});

	it("rejects artifact ids that escape the base directory", async () => {
		await expect(store.get("../evil")).resolves.toBeUndefined();
		await expect(store.openDownload("../evil")).rejects.toThrow(
			"Artifact not found",
		);
	});
});
