import { ArtifactModule } from "@/modules/artifacts/artifact.module";
import type { IArtifactStore } from "@/modules/artifacts/base.artifact";

describe("ArtifactModule", () => {
	it("returns the configured artifact store", () => {
		const store: IArtifactStore = {
			put: jest.fn(),
			get: jest.fn(),
			delete: jest.fn(),
			openDownload: jest.fn(),
		};

		const module = new ArtifactModule(store);

		expect(module.getStore()).toBe(store);
	});
});
