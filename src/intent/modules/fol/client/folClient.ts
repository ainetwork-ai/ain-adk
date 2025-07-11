import dotenv from "dotenv";
import type { IBaseModel } from "@/models/base.js";
import { loggers } from "@/utils/logger.js";
import type { FOLStore } from "../store/index.js";
import type { FactItem, FolItem, Fols } from "../types/index.js";

dotenv.config();

export class FOLClient {
	/**
	 * FOLClient는 자연어로 입력된 정보를 First-Order Logic (FOL) 형식으로 변환
	 */
	private model: IBaseModel;
	private folStore: FOLStore;

	constructor(model: IBaseModel, folStore: FOLStore) {
		this.model = model;
		this.folStore = folStore;
	}

	/**
	 * 자연어로 정보를 넣어주면 FOL 형식으로 바꿔서 Store에 저장하기
	 */
	async updateFacts(text: string): Promise<void> {
		try {
			// 기존 Facts 가져오기
			const existingFacts = await this.folStore.getAllFols();

			// 기존 데이터를 문자열로 변환 (AI 프롬프트용)
			const existingConstantsStr = existingFacts.constants
				.map((c) => `${c.value}: ${c.description}`)
				.join(", ");
			const existingPredicatesStr = existingFacts.predicates
				.map((p) => `${p.value}: ${p.description}`)
				.join(", ");
			const existingFactsStr = existingFacts.facts
				.map(
					(f) =>
						`${f.value}: ${f.description} [${(f.predicates || []).join(",")}(${(
							f.contants || []
						).join(", ")})]`,
				)
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
    {"value": "constant_name", "description": "상수에 대한 설명"}
  ],
  "predicates": [
    {"value": "Predicate(x)", "description": "술어에 대한 설명"}
  ],
  "facts": [
    {"value": "Fact(constant)", "description": "사실에 대한 설명"}
  ]
}

FOL 규칙:
- Constants는 소문자로 시작 (예: john, mary, book1)
- Predicates는 대문자로 시작하고 변수 포함 (예: Person(x), Likes(x,y))
- Facts는 구체적인 사실(예: Person(john), Likes(mary, book1)) 혹은 규칙을 FOL 형식으로 작성
- 각 항목에는 의미있는 설명을 포함해주세요
- 기존 정보와 중복되지 않도록 주의`;

			const messages = this.model.generateMessages([prompt]);
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

			// 병합 함수: value 기준으로 FolItem, FactItem 모두 병합
			const mergeFolItems = (
				existing: FolItem[],
				newItems: FolItem[],
			): FolItem[] => {
				const merged = new Map<string, FolItem>();
				existing.forEach((item) => {
					merged.set(item.value, item);
				});
				newItems.forEach((item) => {
					merged.set(item.value, item);
				});
				return Array.from(merged.values());
			};

			const mergeFactItems = (
				existing: FactItem[],
				newItems: FactItem[],
			): FactItem[] => {
				const merged = new Map<string, FactItem>();
				existing.forEach((item) => {
					merged.set(item.value, item);
				});
				newItems.forEach((item) => {
					merged.set(item.value, item);
				});
				return Array.from(merged.values());
			};

			const updatedFacts: Fols = {
				constants: mergeFolItems(
					existingFacts.constants,
					newFolData.constants || [],
				),
				predicates: mergeFolItems(
					existingFacts.predicates,
					newFolData.predicates || [],
				),
				facts: mergeFactItems(existingFacts.facts, newFolData.facts || []),
			};

			// Store에 저장
			await this.folStore.saveFacts(updatedFacts);

			loggers.fol.info("FOL data updated");
		} catch (error) {
			loggers.fol.error("updateFacts execution error:", { error });
			throw error;
		}
	}

	/**
	 * 모든 Facts 목록 조회
	 */
	async getFactsList(): Promise<Fols> {
		try {
			const allFacts = await this.folStore.getAllFols();
			return allFacts;
		} catch (error) {
			loggers.fol.error("getFactsList execution error:", { error });
			throw error;
		}
	}

	/**
	 * 모든 Constants와 Predicate를 조회해서 확인하고, 유저의 질문에서 필요한 Query를 생성
	 */
	async createQuery(user_question: string): Promise<string> {
		try {
			const constants = await this.folStore.retrieveConstantsByQuery();
			const predicates = await this.folStore.retrievePredicatesByQuery();

			// 결과를 문자열로 변환
			const constantsStr = constants
				.map((c) => `${c.value}: ${c.description}`)
				.join(", ");
			const predicatesStr = predicates
				.map((p) => `${p.value}: ${p.description}`)
				.join(", ");

			const prompt = `다음 First-Order Logic (FOL) 데이터를 기반으로 유저의 질문에서 검색을 위한 적절한 keyword를 추출해주세요. No verbose. Just return a keyword in below constants or predicates. 

Constants:
{${constantsStr}

Predicates:
${predicatesStr}

유저의 질문: ${user_question}}`;
			const messages = this.model.generateMessages([prompt]);
			loggers.fol.debug("Query messages:", messages);
			const response = await this.model.fetch(messages);
			loggers.fol.debug("Query response:", response);
			return response.content || prompt;
		} catch (error) {
			loggers.fol.error("createQuery execution error:", { error });
			throw error;
		}
	}

	/**
	 * FOL 기반 데이터 조회 및 추론
	 */
	async inferenceBasedOnFOLs(user_question: string): Promise<string> {
		const query = await this.createQuery(user_question);

		try {
			const facts = await this.folStore.retrieveFactsByQuery(query);
			if (facts.length === 0) {
				return `Query '${query}'에 대한 Facts가 없습니다.`;
			}
			// 데이터를 문자열로 변환 (AI 프롬프트용)
			const factsStr = facts
				.map(
					(f) =>
						`${f.value}: ${f.description} [${(f.predicates || []).join(",")}(${(
							f.contants || []
						).join(", ")})]`,
				)
				.join(", ");

			// FOL 데이터와 쿼리를 기반으로 AI 추론 수행
			const prompt = `
다음 First-Order Logic (FOL) 데이터를 기반으로 질문에 답해주세요.

Facts: ${factsStr.length > 0 ? factsStr : "없음"}

질문: ${user_question}

위의 FOL 데이터를 논리적으로 분석하여 질문에 대한 답변을 제공해주세요.`;

			const messages = this.model.generateMessages([prompt]);

			loggers.fol.debug("Inference messages:", messages);

			const response = await this.model.fetch(messages);

			loggers.fol.debug("Inference response:", response);

			// AI 응답에서 텍스트 추출 (응답이 객체인 경우 content 프로퍼티 사용)
			const responseText = response.content || "";

			return responseText;
		} catch (error) {
			loggers.fol.error("queryFacts execution error:", { error });
			throw error;
		}
	}
}
