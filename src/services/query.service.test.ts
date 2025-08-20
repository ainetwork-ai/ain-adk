import type { ModelModule } from "@/modules";
import type { BaseModel } from "@/modules/models/base.model.js";
import { QueryService } from "./query.service";

// Mock ModelModule and BaseModel
const mockModel: jest.Mocked<BaseModel<any, any>> = {
	fetch: jest.fn(),
	generateMessages: jest.fn((input) => [
		{ role: "system", content: input.systemPrompt || "" },
		{ role: "user", content: input.query },
	]),
} as any;

const mockModelModule: jest.Mocked<ModelModule> = {
	getModel: jest.fn().mockReturnValue(mockModel),
} as any;

describe("QueryService", () => {
	let queryService: QueryService;

	beforeEach(() => {
		// Reset mocks before each test
		jest.clearAllMocks();
		queryService = new QueryService(mockModelModule);
	});

	describe("generateTitle", () => {
		it("should generate a title based on the user's query", async () => {
			const query = "Tell me about AI Network";
			const expectedTitle = "AI Network Explained";

			// Configure the mock to return a successful response
			mockModel.fetch.mockResolvedValue({
				content: expectedTitle,
			});

			// Access the private method for testing
			const title = await (queryService as any).generateTitle(query);

			expect(title).toBe(expectedTitle);
			expect(mockModel.fetch).toHaveBeenCalledTimes(1);
			expect(mockModel.generateMessages).toHaveBeenCalledWith(
				expect.objectContaining({
					query,
				}),
			);
		});

		it("should return a default title when the model's response is empty", async () => {
			const query = "What is blockchain?";
			const defaultTitle = "New Chat";

			// Configure the mock to return an empty content
			mockModel.fetch.mockResolvedValue({
				content: "",
			});

			const title = await (queryService as any).generateTitle(query);

			expect(title).toBe(defaultTitle);
		});

		it("should return a default title when the model fails to generate a title", async () => {
			const query = "Latest news on AIN";
			const defaultTitle = "New Chat";

			// Configure the mock to simulate an error
			mockModel.fetch.mockRejectedValue(new Error("API Error"));

			const title = await (queryService as any).generateTitle(query);

			expect(title).toBe(defaultTitle);
		});
	});
});
