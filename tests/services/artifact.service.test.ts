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

	it("rejects uploads larger than the configured max size", async () => {
		const put = jest.fn();
		const service = new ArtifactService({
			getStore: () =>
				({
					get: jest.fn(),
					put,
					delete: jest.fn(),
					openDownload: jest.fn(),
				}) as any,
			getOptions: () => ({ maxSizeBytes: 4 }),
		} as any);

		await expect(
			service.uploadArtifact("user-1", {
				name: "big.bin",
				mimeType: "application/octet-stream",
				data: new Uint8Array([1, 2, 3, 4, 5]),
			}),
		).rejects.toMatchObject({
			status: 413,
			code: "ARTIFACT_TOO_LARGE",
		});
		expect(put).not.toHaveBeenCalled();
	});

	it("rejects uploads with a disallowed mime type", async () => {
		const put = jest.fn();
		const service = new ArtifactService({
			getStore: () =>
				({
					get: jest.fn(),
					put,
					delete: jest.fn(),
					openDownload: jest.fn(),
				}) as any,
			getOptions: () => ({ allowedMimeTypes: ["application/pdf", "image/*"] }),
		} as any);

		await expect(
			service.uploadArtifact("user-1", {
				name: "script.sh",
				mimeType: "text/x-shellscript",
				data: new Uint8Array([1]),
			}),
		).rejects.toMatchObject({
			status: 415,
			code: "ARTIFACT_TYPE_NOT_ALLOWED",
		});
		expect(put).not.toHaveBeenCalled();
	});

	it("allows uploads matching a mime wildcard within the size limit", async () => {
		const put = jest.fn(async (input) => ({
			artifactId: "art-1",
			status: "ready" as const,
			name: input.name,
			mimeType: input.mimeType,
			size: input.data.length,
			storageKey: "art-1.bin",
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
			getOptions: () => ({
				maxSizeBytes: 10,
				allowedMimeTypes: ["image/*"],
			}),
		} as any);

		await expect(
			service.uploadArtifact("user-1", {
				name: "pic.png",
				mimeType: "image/png",
				data: new Uint8Array([1, 2, 3]),
			}),
		).resolves.toMatchObject({ artifactId: "art-1" });
		expect(put).toHaveBeenCalled();
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

	it("deletes artifacts the user owns", async () => {
		const del = jest.fn(async () => {});

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
					delete: del,
					openDownload: jest.fn(),
				}) as any,
		} as any);

		await expect(service.deleteArtifact("user-1", "art-1")).resolves.toBeUndefined();
		expect(del).toHaveBeenCalledWith("art-1");
	});

	it("rejects deletion of another user's artifact", async () => {
		const del = jest.fn(async () => {});

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
					delete: del,
					openDownload: jest.fn(),
				}) as any,
		} as any);

		await expect(service.deleteArtifact("user-1", "art-1")).rejects.toMatchObject(
			{
				message: "Artifact access denied",
				code: "ARTIFACT_ACCESS_DENIED",
			},
		);
		expect(del).not.toHaveBeenCalled();
	});

	it("deletes a thread's artifacts owned by (or unowned for) the user", async () => {
		const del = jest.fn(async () => {});
		const service = new ArtifactService({
			getStore: () =>
				({
					get: jest.fn(),
					put: jest.fn(),
					delete: del,
					openDownload: jest.fn(),
					listByThread: async () => [
						{ artifactId: "art-mine", userId: "user-1", threadId: "thread-1" },
						{ artifactId: "art-unowned", threadId: "thread-1" },
						{
							artifactId: "art-other",
							userId: "other-user",
							threadId: "thread-1",
						},
					],
				}) as any,
		} as any);

		await service.deleteThreadArtifacts("user-1", "thread-1");

		expect(del.mock.calls.map((c) => c[0]).sort()).toEqual([
			"art-mine",
			"art-unowned",
		]);
	});

	it("skips thread artifact cleanup when the store cannot list by thread", async () => {
		const del = jest.fn();
		const service = new ArtifactService({
			getStore: () =>
				({
					get: jest.fn(),
					put: jest.fn(),
					delete: del,
					openDownload: jest.fn(),
				}) as any,
		} as any);

		await expect(
			service.deleteThreadArtifacts("user-1", "thread-1"),
		).resolves.toBeUndefined();
		expect(del).not.toHaveBeenCalled();
	});

	it("never throws from thread artifact cleanup", async () => {
		const service = new ArtifactService({
			getStore: () =>
				({
					get: jest.fn(),
					put: jest.fn(),
					delete: jest.fn(async () => {
						throw new Error("disk error");
					}),
					openDownload: jest.fn(),
					listByThread: async () => [
						{ artifactId: "art-1", userId: "user-1", threadId: "thread-1" },
					],
				}) as any,
		} as any);

		await expect(
			service.deleteThreadArtifacts("user-1", "thread-1"),
		).resolves.toBeUndefined();
	});

	it("no-ops thread artifact cleanup without an artifact module", async () => {
		const service = new ArtifactService(undefined);

		await expect(
			service.deleteThreadArtifacts("user-1", "thread-1"),
		).resolves.toBeUndefined();
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
