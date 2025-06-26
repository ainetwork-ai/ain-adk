import fs from "node:fs";
import path from "node:path";
import { loggers } from "@/utils/logger.js";
import type { Facts } from "../types/index.js";
import { FOLStore } from "./base.js";

export class FOLLocalStore extends FOLStore {
	private storePath: string;
	private constantsFile: string;
	private predicatesFile: string;
	private factsFile: string;
	private intentFile: string;

	constructor(storePath: string) {
		super();
		this.storePath = storePath;
		this.constantsFile = path.join(storePath, "constants.json");
		this.predicatesFile = path.join(storePath, "predicates.json");
		this.factsFile = path.join(storePath, "facts.json");
		this.intentFile = path.join(storePath, "intent.json");
		this.ensureDirectoryExists();
	}

	private ensureDirectoryExists(): void {
		if (!fs.existsSync(this.storePath)) {
			fs.mkdirSync(this.storePath, { recursive: true });
		}
	}

	private async loadConstants(): Promise<
		{ name: string; description: string }[]
	> {
		if (!fs.existsSync(this.constantsFile)) {
			return [];
		}
		try {
			const content = await fs.promises.readFile(this.constantsFile, "utf8");
			const data = JSON.parse(content);
			// {name: description} 형태를 배열로 변환
			return Object.entries(data).map(([name, description]) => ({
				name,
				description: description as string,
			}));
		} catch (error) {
			loggers.fol.error("Failed to load constants.json:", { error });
			return [];
		}
	}

	private async loadPredicates(): Promise<
		{ name: string; description: string }[]
	> {
		if (!fs.existsSync(this.predicatesFile)) {
			return [];
		}
		try {
			const content = await fs.promises.readFile(this.predicatesFile, "utf8");
			const data = JSON.parse(content);
			// {name: description} 형태를 배열로 변환
			return Object.entries(data).map(([name, description]) => ({
				name,
				description: description as string,
			}));
		} catch (error) {
			loggers.fol.error("Failed to load predicates.json:", { error });
			return [];
		}
	}

	private async loadAllFacts(): Promise<
		{ name: string; description: string }[]
	> {
		if (!fs.existsSync(this.factsFile)) {
			return [];
		}
		try {
			const content = await fs.promises.readFile(this.factsFile, "utf8");
			const data = JSON.parse(content);
			// {name: description} 형태를 배열로 변환
			return Object.entries(data).map(([name, description]) => ({
				name,
				description: description as string,
			}));
		} catch (error) {
			loggers.fol.error("Failed to load facts.json:", { error });
			return [];
		}
	}

	private async loadIntentMapping(): Promise<{ [intent: string]: string[] }> {
		if (!fs.existsSync(this.intentFile)) {
			return {};
		}
		try {
			const content = await fs.promises.readFile(this.intentFile, "utf8");
			return JSON.parse(content);
		} catch (error) {
			loggers.fol.error("Failed to load intent.json:", { error });
			return {};
		}
	}

	private async saveConstants(
		constants: { name: string; description: string }[],
	): Promise<void> {
		// 배열을 {name: description} 형태로 변환
		const data: { [key: string]: string } = {};
		constants.forEach(({ name, description }) => {
			data[name] = description;
		});

		await fs.promises.writeFile(
			this.constantsFile,
			JSON.stringify(data, null, 2),
			"utf8",
		);
	}

	private async savePredicates(
		predicates: { name: string; description: string }[],
	): Promise<void> {
		// 배열을 {name: description} 형태로 변환
		const data: { [key: string]: string } = {};
		predicates.forEach(({ name, description }) => {
			data[name] = description;
		});

		await fs.promises.writeFile(
			this.predicatesFile,
			JSON.stringify(data, null, 2),
			"utf8",
		);
	}

	private async saveAllFacts(
		facts: { name: string; description: string }[],
	): Promise<void> {
		// 배열을 {name: description} 형태로 변환
		const data: { [key: string]: string } = {};
		facts.forEach(({ name, description }) => {
			data[name] = description;
		});

		await fs.promises.writeFile(
			this.factsFile,
			JSON.stringify(data, null, 2),
			"utf8",
		);
	}

	private async saveIntentMapping(intentMapping: {
		[intent: string]: string[];
	}): Promise<void> {
		await fs.promises.writeFile(
			this.intentFile,
			JSON.stringify(intentMapping, null, 2),
			"utf8",
		);
	}

	async saveFacts(intent: string, facts: Facts): Promise<void> {
		try {
			// Constants와 Predicates는 전역으로 저장 (기존 데이터와 병합)
			const existingConstants = await this.loadConstants();
			const existingPredicates = await this.loadPredicates();
			const existingFacts = await this.loadAllFacts();

			// 중복 제거하여 병합 (name 기준)
			const constantsMap = new Map<string, string>();
			existingConstants.forEach(({ name, description }) => {
				constantsMap.set(name, description);
			});
			facts.constants.forEach(({ name, description }) => {
				constantsMap.set(name, description);
			});

			const predicatesMap = new Map<string, string>();
			existingPredicates.forEach(({ name, description }) => {
				predicatesMap.set(name, description);
			});
			facts.predicates.forEach(({ name, description }) => {
				predicatesMap.set(name, description);
			});

			const factsMap = new Map<string, string>();
			existingFacts.forEach(({ name, description }) => {
				factsMap.set(name, description);
			});
			facts.facts.forEach(({ name, description }) => {
				factsMap.set(name, description);
			});

			// Map을 배열로 변환
			const mergedConstants = Array.from(constantsMap.entries()).map(
				([name, description]) => ({
					name,
					description,
				}),
			);
			const mergedPredicates = Array.from(predicatesMap.entries()).map(
				([name, description]) => ({
					name,
					description,
				}),
			);
			const mergedFacts = Array.from(factsMap.entries()).map(
				([name, description]) => ({
					name,
					description,
				}),
			);

			await this.saveConstants(mergedConstants);
			await this.savePredicates(mergedPredicates);
			await this.saveAllFacts(mergedFacts);

			// Intent mapping 저장
			const intentMapping = await this.loadIntentMapping();
			intentMapping[intent] = facts.facts.map((fact) => fact.name);
			await this.saveIntentMapping(intentMapping);

			loggers.fol.info(`FOL data updated (intent: ${intent})`);
		} catch (error) {
			loggers.fol.error("saveFacts execution error:", { error });
			throw error;
		}
	}

	async retrieveFacts(intent: string): Promise<Facts | null> {
		try {
			const constants = await this.loadConstants();
			const predicates = await this.loadPredicates();
			const allFacts = await this.loadAllFacts();
			const intentMapping = await this.loadIntentMapping();

			const intentFactNames = intentMapping[intent] || [];

			// intent에 해당하는 facts만 필터링
			const intentFacts = allFacts.filter((fact) =>
				intentFactNames.includes(fact.name),
			);

			return {
				constants,
				predicates,
				facts: intentFacts,
			};
		} catch (error) {
			loggers.fol.error(`Failed to retrieve FOL (intent: ${intent}):`, {
				error,
			});
			return null;
		}
	}

	async getAllFacts(): Promise<{ [intent: string]: Facts }> {
		const result: { [intent: string]: Facts } = {};

		try {
			const constants = await this.loadConstants();
			const predicates = await this.loadPredicates();
			const allFacts = await this.loadAllFacts();
			const intentMapping = await this.loadIntentMapping();

			for (const [intent, factNames] of Object.entries(intentMapping)) {
				const intentFacts = allFacts.filter((fact) =>
					factNames.includes(fact.name),
				);

				result[intent] = {
					constants,
					predicates,
					facts: intentFacts,
				};
			}

			return result;
		} catch (error) {
			loggers.fol.error("Failed to getAllFacts:", { error });
			return {};
		}
	}
}
