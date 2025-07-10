import fs from "node:fs";
import path from "node:path";

import { loggers } from "@/utils/logger.js";
import {
	createEmptyFols,
	type FactItem,
	type FolItem,
	type Fols,
} from "../types/index.js";
import { FOLStore } from "./base.js";

export class FOLLocalStore extends FOLStore {
	private storePath: string;
	private constantsFile: string;
	private predicatesFile: string;
	private factsFile: string;

	private parseFactValue(value: string): {
		predicates: string[];
		args: string[];
	} {
		const match = value.trim().match(/^\s*([^\s(]+)\s*\(([^)]*)\)/);
		if (match) {
			const pred = match[1].trim();
			const args = match[2]
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			return { predicates: pred ? [pred] : [], args };
		}
		return { predicates: [], args: [] };
	}

	constructor(storePath: string) {
		super();
		this.storePath = storePath;
		this.constantsFile = path.join(storePath, "constants.json");
		this.predicatesFile = path.join(storePath, "predicates.json");
		this.factsFile = path.join(storePath, "facts.json");
		this.ensureDirectoryExists();
	}

	private ensureDirectoryExists(): void {
		if (!fs.existsSync(this.storePath)) {
			fs.mkdirSync(this.storePath, { recursive: true });
		}
	}

	private async loadConstants(): Promise<FolItem[]> {
		if (!fs.existsSync(this.constantsFile)) {
			return [];
		}
		try {
			const content = await fs.promises.readFile(this.constantsFile, "utf8");
			const data = JSON.parse(content);
			// FolItem[] 형태로 저장/로드
			if (Array.isArray(data)) {
				return data;
			}
			loggers.fol.error("constants.json is not an array", { data });
			return [];
		} catch (error) {
			loggers.fol.error("Failed to load constants.json:", { error });
			return [];
		}
	}

	private async loadPredicates(): Promise<FolItem[]> {
		if (!fs.existsSync(this.predicatesFile)) {
			return [];
		}
		try {
			const content = await fs.promises.readFile(this.predicatesFile, "utf8");
			const data = JSON.parse(content);
			if (Array.isArray(data)) {
				return data;
			}
			loggers.fol.error("predicates.json is not an array", { data });
			return [];
		} catch (error) {
			loggers.fol.error("Failed to load predicates.json:", { error });
			return [];
		}
	}

	private async loadAllFacts(): Promise<FactItem[]> {
		if (!fs.existsSync(this.factsFile)) {
			return [];
		}
		try {
			const content = await fs.promises.readFile(this.factsFile, "utf8");
			const data = JSON.parse(content);
			if (Array.isArray(data)) {
				return data.map((item: Record<string, unknown>) => {
					const value = typeof item.value === "string" ? item.value : "";
					const description =
						typeof item.description === "string" ? item.description : "";
					const { predicates, args } = this.parseFactValue(value);
					return {
						value,
						description,
						predicates,
						arguments: args,
						updatedAt:
							typeof item.updatedAt === "string" ? item.updatedAt : undefined,
					};
				});
			}
			loggers.fol.error("facts.json is not an array", { data });
			return [];
		} catch (error) {
			loggers.fol.error("Failed to load facts.json:", { error });
			return [];
		}
	}

	private async saveConstants(constants: FolItem[]): Promise<void> {
		// FolItem[] 형태로 저장
		await fs.promises.writeFile(
			this.constantsFile,
			JSON.stringify(constants, null, 2),
			"utf8",
		);
	}

	private async savePredicates(predicates: FolItem[]): Promise<void> {
		// FolItem[] 형태로 저장
		await fs.promises.writeFile(
			this.predicatesFile,
			JSON.stringify(predicates, null, 2),
			"utf8",
		);
	}

	private async saveAllFacts(facts: FactItem[]): Promise<void> {
		await fs.promises.writeFile(
			this.factsFile,
			JSON.stringify(
				facts.map((fact) => {
					const value = fact.value;
					const description = fact.description;
					const { predicates, args } = this.parseFactValue(value);
					return {
						value,
						description,
						predicates,
						arguments: args,
						...(fact.updatedAt ? { updatedAt: fact.updatedAt } : {}),
					};
				}),
				null,
				2,
			),
			"utf8",
		);
	}

	async saveFacts(fols: Fols): Promise<void> {
		try {
			// Constants와 Predicates는 전역으로 저장 (기존 데이터와 병합)
			const existingConstants = await this.loadConstants();
			const existingPredicates = await this.loadPredicates();
			const existingFacts = await this.loadAllFacts();

			// 중복 제거하여 병합 (value 기준)
			const constantsMap = new Map<string, FolItem>();
			existingConstants.forEach((item) => {
				constantsMap.set(item.value, item);
			});
			fols.constants.forEach((item) => {
				constantsMap.set(item.value, item);
			});

			const predicatesMap = new Map<string, FolItem>();
			existingPredicates.forEach((item) => {
				predicatesMap.set(item.value, item);
			});
			fols.predicates.forEach((item) => {
				predicatesMap.set(item.value, item);
			});

			const factsMap = new Map<string, FactItem>();
			// value를 key로 하되, 최신 정보로 병합 (description, predicates, arguments, updatedAt)
			existingFacts.forEach((item) => {
				factsMap.set(item.value, item);
			});
			fols.facts.forEach((item) => {
				const prev = factsMap.get(item.value);
				const parsed = this.parseFactValue(item.value);
				// 새 fact에서 추출한 predicate가 기존 목록에 없으면 추가
				const pred = parsed.predicates[0];
				if (pred && !predicatesMap.has(pred)) {
					predicatesMap.set(pred, { value: pred, description: "" });
				}
				factsMap.set(item.value, {
					value: item.value,
					description: item.description,
					predicates: parsed.predicates,
					arguments: parsed.args,
					updatedAt: new Date().toISOString(),
					...(prev ? { ...prev, ...item } : {}),
				});
			});

			// Map을 배열로 변환
			const mergedConstants = Array.from(constantsMap.values());
			const mergedPredicates = Array.from(predicatesMap.values());
			const mergedFacts = Array.from(factsMap.values());

			await this.saveConstants(mergedConstants);
			await this.savePredicates(mergedPredicates);
			await this.saveAllFacts(mergedFacts);

			loggers.fol.info(
				`FOL data updated (facts: ${JSON.stringify(mergedFacts)})`,
			);
		} catch (error) {
			loggers.fol.error("saveFacts execution error:", { error });
			throw error;
		}
	}

	async retrieveConstantsByQuery(query?: string): Promise<FolItem[]> {
		try {
			const constants = await this.loadConstants();
			if (!query) {
				return constants;
			}
			return constants.filter((item) => item.value.includes(query));
		} catch (error) {
			loggers.fol.error(`Failed to retrieve constants by query (${query}):`, {
				error,
			});
			return [];
		}
	}

	async retrievePredicatesByQuery(query?: string): Promise<FolItem[]> {
		try {
			const predicates = await this.loadPredicates();
			if (!query) {
				return predicates;
			}
			return predicates.filter((item) => item.value.includes(query));
		} catch (error) {
			loggers.fol.error(`Failed to retrieve predicates by query (${query}):`, {
				error,
			});
			return [];
		}
	}

	async retrieveFactsByQuery(query: string): Promise<FactItem[]> {
		try {
			const facts = await this.loadAllFacts();
			// 단순히 fact의 value에 query가 포함되는지로 필터링
			return facts.filter((fact) => fact.value.includes(query));
		} catch (error) {
			loggers.fol.error(`Failed to retrieve facts by query (${query}):`, {
				error,
			});
			return [];
		}
	}

	async getAllFols(): Promise<Fols> {
		try {
			const constants = await this.loadConstants();
			const predicates = await this.loadPredicates();
			const facts = await this.loadAllFacts();
			return {
				constants,
				predicates,
				facts,
			};
		} catch (error) {
			loggers.fol.error("Failed to getAllFols:", { error });
			return createEmptyFols();
		}
	}
}
