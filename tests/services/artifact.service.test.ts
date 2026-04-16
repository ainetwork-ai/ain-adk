import { ArtifactService } from "@/services/artifact.service";

describe("ArtifactService", () => {
	it("uploads artifacts with the authenticated user attached", async () => {
		const put = jest.fn(async (input) => ({
			artifactId: "art-1",
			userId: input.userId,
			threadId: input.threadId,
			messageId: input.messageId,
			status: "uploaded" as const,
			name: input.name,
			mimeType: input.mimeType,
			size: input.data.length,
			storageKey: "artifacts/report.pdf",
			metadata: input.metadata,
			createdAt: 100,
		}));

		const service = new ArtifactService({
			getStore: () =>
				({
					get: jest.fn(),
					put,
					delete: jest.fn(),
					openDownload: jest.fn(),
				}) as any,
		} as any);

		await expect(
			service.uploadArtifact("user-1", {
				name: "report.pdf",
				mimeType: "application/pdf",
				data: new Uint8Array([1, 2, 3]),
				threadId: "thread-1",
				messageId: "msg-1",
				metadata: { source: "upload" },
			}),
		).resolves.toMatchObject({
			artifactId: "art-1",
			userId: "user-1",
			threadId: "thread-1",
			messageId: "msg-1",
			name: "report.pdf",
			metadata: { source: "upload" },
		});

		expect(put).toHaveBeenCalledWith({
			name: "report.pdf",
			mimeType: "application/pdf",
			data: new Uint8Array([1, 2, 3]),
			userId: "user-1",
			threadId: "thread-1",
			messageId: "msg-1",
			metadata: { source: "upload" },
		});
	});

	it("returns artifact metadata when the user owns the artifact", async () => {
		const get = jest.fn(async () => ({
			artifactId: "art-1",
			userId: "user-1",
			status: "ready" as const,
			name: "report.pdf",
			mimeType: "application/pdf",
			size: 1024,
			storageKey: "artifacts/report.pdf",
			createdAt: 100,
		}));

		const service = new ArtifactService({
			getStore: () =>
				({
					get,
					put: jest.fn(),
					delete: jest.fn(),
					openDownload: jest.fn(),
				}) as any,
		} as any);

		await expect(service.getArtifact("user-1", "art-1")).resolves.toMatchObject({
			artifactId: "art-1",
			name: "report.pdf",
		});
		expect(get).toHaveBeenCalledWith("art-1");
	});

	it("rejects metadata access when the artifact belongs to another user", async () => {
		const service = new ArtifactService({
			getStore: () =>
				({
					get: async () => ({
						artifactId: "art-1",
						userId: "other-user",
						status: "ready" as const,
						name: "report.pdf",
						mimeType: "application/pdf",
						size: 1024,
						storageKey: "artifacts/report.pdf",
						createdAt: 100,
					}),
					put: jest.fn(),
					delete: jest.fn(),
					openDownload: jest.fn(),
				}) as any,
		} as any);

		await expect(service.getArtifact("user-1", "art-1")).rejects.toMatchObject({
			message: "Artifact access denied",
			code: "ARTIFACT_ACCESS_DENIED",
		});
	});

	it("opens downloads after access checks", async () => {
		const openDownload = jest.fn(async () => ({
			body: new Uint8Array([1, 2, 3]),
			mimeType: "application/pdf",
			fileName: "report.pdf",
			contentLength: 3,
		}));

		const service = new ArtifactService({
			getStore: () =>
				({
					get: async () => ({
						artifactId: "art-1",
						userId: "user-1",
						status: "ready" as const,
						name: "report.pdf",
						mimeType: "application/pdf",
						size: 1024,
						storageKey: "artifacts/report.pdf",
						createdAt: 100,
					}),
					put: jest.fn(),
					delete: jest.fn(),
					openDownload,
				}) as any,
		} as any);

		await expect(service.openDownload("user-1", "art-1")).resolves.toEqual({
			body: new Uint8Array([1, 2, 3]),
			mimeType: "application/pdf",
			fileName: "report.pdf",
			contentLength: 3,
		});
		expect(openDownload).toHaveBeenCalledWith("art-1");
	});

	it("resolves query artifact parts with store metadata", async () => {
		const get = jest.fn(async () => ({
			artifactId: "art-1",
			userId: "user-1",
			status: "ready" as const,
			name: "report.pdf",
			mimeType: "application/pdf",
			size: 1024,
			storageKey: "artifacts/report.pdf",
			previewText: "Quarterly report preview",
			createdAt: 100,
		}));

		const service = new ArtifactService({
			getStore: () =>
				({
					get,
					put: jest.fn(),
					delete: jest.fn(),
					openDownload: jest.fn(),
				}) as any,
		} as any);

		await expect(
			service.resolveQueryInputArtifacts("user-1", {
				parts: [
					{ kind: "text", text: "Summarize this" },
					{ kind: "artifact", artifactId: "art-1" },
				],
			}),
		).resolves.toEqual({
			parts: [
				{ kind: "text", text: "Summarize this" },
				{
					kind: "artifact",
					artifactId: "art-1",
					name: "report.pdf",
					mimeType: "application/pdf",
					size: 1024,
					downloadUrl: "/api/artifacts/art-1/download",
					previewText: "Quarterly report preview",
				},
			],
		});
		expect(get).toHaveBeenCalledWith("art-1");
	});

	it("rejects query artifact references that are not ready", async () => {
		const service = new ArtifactService({
			getStore: () =>
				({
					get: async () => ({
						artifactId: "art-1",
						userId: "user-1",
						status: "processing" as const,
						name: "report.pdf",
						mimeType: "application/pdf",
						size: 1024,
						storageKey: "artifacts/report.pdf",
						createdAt: 100,
					}),
					put: jest.fn(),
					delete: jest.fn(),
					openDownload: jest.fn(),
				}) as any,
		} as any);

		await expect(
			service.resolveQueryInputArtifacts("user-1", {
				parts: [{ kind: "artifact", artifactId: "art-1" }],
			}),
		).rejects.toMatchObject({
			message: "Artifact is not ready",
			code: "ARTIFACT_NOT_READY",
		});
	});
});
