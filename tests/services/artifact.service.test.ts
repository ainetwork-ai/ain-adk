import { ArtifactService } from "@/services/artifact.service";

describe("ArtifactService", () => {
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
});
