import type { BaseModel } from "@/modules/models/base.model.js";
import type { Facts } from "@/types/fol.js";
import { loggers } from "@/utils/logger.js";
import type { FOLStore } from "./store/index.js";

export class FOLModule {
	private model: BaseModel<unknown, unknown>;
	private folStore: FOLStore;

	constructor(model: BaseModel<unknown, unknown>, folStore: FOLStore) {
		this.model = model;
		this.folStore = folStore;
	}

	/**
	 * 자연어로 정보를 넣어주면 FOL 형식으로 바꿔서 Store에 저장하기
	 */
	async updateFacts(intent: string, text: string): Promise<void> {
		try {
			// 기존 Facts 가져오기
			const existingFacts = (await this.folStore.retrieveFacts(intent)) || {
				constants: [],
				predicates: [],
				facts: [],
			};

			// 기존 데이터를 문자열로 변환 (AI 프롬프트용)
			const existingConstantsStr = existingFacts.constants
				.map((c) => `${c.name}: ${c.description}`)
				.join(", ");
			const existingPredicatesStr = existingFacts.predicates
				.map((p) => `${p.name}: ${p.description}`)
				.join(", ");
			const existingFactsStr = existingFacts.facts
				.map((f) => `${f.name}: ${f.description}`)
				.join(", ");

			// 자연어를 FOL로 변환하는 프롬프트
			const prompt = `
다음 자연어 텍스트를 First-Order Logic (FOL) 형식으로 변환해주세요.

입력 텍스트: "${text}"

기존 Constants: ${existingConstantsStr}
기존 Predicates: ${existingPredicatesStr}
기존 Facts: ${existingFactsStr}

다음 JSON 형식으로 응답해주세요:
{
  "constants": [
    {"name": "constant_name", "description": "상수에 대한 설명"}
  ],
  "predicates": [
    {"name": "Predicate(x)", "description": "술어에 대한 설명"}
  ],
  "facts": [
    {"name": "Fact(constant)", "description": "사실에 대한 설명"}
  ]
}

FOL 규칙:
- Constants는 소문자로 시작 (예: john, mary, book1)
- Predicates는 대문자로 시작하고 변수 포함 (예: Person(x), Likes(x,y))
- Facts는 구체적인 사실 (예: Person(john), Likes(mary, book1))
- 각 항목에는 의미있는 설명을 포함해주세요
- 기존 정보와 중복되지 않도록 주의`;

			const messages = this.model.generateMessages({
				query: prompt,
			});
			const response = await this.model.fetch(messages);

			loggers.fol.debug(response);

			// AI 응답에서 텍스트 추출 (응답이 객체인 경우 content 프로퍼티 사용)
			const responseText = response.content || "";

			// AI 응답에서 JSON 추출
			const jsonMatch = responseText?.match(/\{[\s\S]*\}/);
			if (!jsonMatch) {
				throw new Error("AI 응답에서 유효한 JSON을 찾을 수 없습니다");
			}

			const newFolData = JSON.parse(jsonMatch[0]);

			// 기존 데이터와 병합 (중복 제거 - name 기준)
			const mergeData = (
				existing: { name: string; description: string }[],
				newItems: { name: string; description: string }[],
			) => {
				const merged = new Map<string, string>();
				existing.forEach(({ name, description }) => {
					merged.set(name, description);
				});
				newItems.forEach(({ name, description }) => {
					merged.set(name, description);
				});
				return Array.from(merged.entries()).map(([name, description]) => ({
					name,
					description,
				}));
			};

			const updatedFacts: Facts = {
				constants: mergeData(
					existingFacts.constants,
					newFolData.constants || [],
				),
				predicates: mergeData(
					existingFacts.predicates,
					newFolData.predicates || [],
				),
				facts: mergeData(existingFacts.facts, newFolData.facts || []),
			};

			// Store에 저장
			await this.folStore.saveFacts(intent, updatedFacts);

			loggers.fol.info(`FOL data updated (intent: ${intent})`);
		} catch (error) {
			loggers.fol.error("updateFacts execution error:", { error });
			throw error;
		}
	}

	/**
	 * 특정 intent에 대한 Facts 조회
	 */
	async retrieveFacts(intent: string): Promise<Facts | null> {
		try {
			return await this.folStore.retrieveFacts(intent);
		} catch (error) {
			loggers.fol.error("retrieveFacts execution error: ", { error });
			throw error;
		}
	}

	/**
	 * 모든 Facts 목록 조회
	 */
	async getFactsList(): Promise<Facts[]> {
		try {
			const allFacts = await this.folStore.getAllFacts();
			return Object.values(allFacts);
		} catch (error) {
			loggers.fol.error("getFactsList execution error:", { error });
			throw error;
		}
	}

	/**
	 * Intent별 Facts 맵 조회
	 */
	async getFactsMap(): Promise<{ [intent: string]: Facts }> {
		try {
			return await this.folStore.getAllFacts();
		} catch (error) {
			loggers.fol.error("getFactsMap execution error:", { error });
			throw error;
		}
	}

	/**
	 * FOL 기반 데이터 조회 및 추론
	 */
	async queryFacts(intent: string, query: string): Promise<string> {
		try {
			const facts = await this.retrieveFacts(intent);
			if (!facts) {
				return `Intent '${intent}'에 대한 Facts가 없습니다.`;
			}

			// 데이터를 문자열로 변환 (AI 프롬프트용)
			const constantsStr = facts.constants
				.map((c) => `${c.name}: ${c.description}`)
				.join(", ");
			const predicatesStr = facts.predicates
				.map((p) => `${p.name}: ${p.description}`)
				.join(", ");
			const factsStr = facts.facts
				.map((f) => `${f.name}: ${f.description}`)
				.join(", ");

			// FOL 데이터와 쿼리를 기반으로 AI 추론 수행
			const prompt = `
다음 First-Order Logic (FOL) 데이터를 기반으로 질문에 답해주세요.

Constants: ${constantsStr}
Predicates: ${predicatesStr}
Facts: ${factsStr}

질문: ${query}

위의 FOL 데이터를 논리적으로 분석하여 질문에 대한 답변을 제공해주세요.
각 항목은 "이름: 설명" 형태로 구성되어 있습니다.`;

			const messages = this.model.generateMessages({
				query: prompt,
			});
			const response = await this.model.fetch(messages);

			// AI 응답에서 텍스트 추출 (응답이 객체인 경우 content 프로퍼티 사용)
			const responseText = response.content || "";

			return responseText;
		} catch (error) {
			loggers.fol.error("queryFacts execution error:", { error });
			throw error;
		}
	}
}
