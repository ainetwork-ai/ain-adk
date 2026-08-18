# main → feature/seonghwa/multi-modal-chat 병합 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** origin/main(0.6.1 → 0.8.6, 130 커밋)의 모든 기능을 feature/seonghwa/multi-modal-chat(canonical message/artifact, 49 커밋)에 병합하고, main의 document 개념을 canonical message part 체계에 편입시킨다.

**Architecture:** rebase가 아닌 **단일 merge 커밋** (`git merge origin/main`)으로 병합한다. feature 브랜치는 이미 merge 커밋들을 포함하고 PR 이력이 있어 rebase는 부적합. 시험 병합 결과 충돌은 14개 파일이며, 해소 원칙은 두 가지: **(1) 동작 계약은 main 우선** — tool-call 프로토콜 준수 수정(무한루프 방지), documentIds/PII/authz/workflow dispatch 등 main이 릴리스한 동작은 그대로 보존. **(2) 메시지 표현은 feature 우선** — canonical `MessageContentPart` 파이프라인, 스트림 이벤트(`tool_start`/`tool_output`), artifact 모듈을 유지하고 main의 데이터가 그 위를 흐르게 한다.

**Tech Stack:** TypeScript(strict), pnpm(0.7.6에서 yarn→pnpm 전환됨 — CLAUDE.md의 yarn 명령은 구식), Jest, Biome(tabs/double quotes), tsup.

**Spec:** 이 문서 자체가 분석 결과를 포함한다. feature 브랜치의 설계 배경은 저장소 루트의 `MULTIMODAL_ARTIFACT_PLAN.md` 참조.

## Global Constraints

- 병합 방향: **origin/main → feature/seonghwa/multi-modal-chat** (feature 브랜치 위에서 `git merge origin/main`). 반대 방향 금지.
- merge base: `730816a`. 충돌 14개 파일 (아래 Task 1에 전체 목록과 해소 코드).
- main에서 되던 기능은 전부 유지: attached-document chat(documentIds), PII 필터, request-context 로깅, workflow 구조화 정의(breaking), intent→workflow 매핑, scheduler/JobRunner, authz, document advice, pagination, tool-call 프로토콜 준수.
- feature에서 되던 기능도 전부 유지: canonical message parts(text/artifact/data/tool-call/tool-result/thought), artifact 모듈/업로드/다운로드 API, A2A artifact reference, 멀티모달 query input 정규화, canonical 스트림 이벤트.
- `BaseModel.appendMessages`와 `ModelAppendMessageInput`은 **삭제**한다. main이 이미 이를 `appendAssistantToolCallTurn`/`appendToolResult`로 대체·릴리스했고(0.6.1, provider-breaking), 병합 후 호출처가 0곳이다. downstream provider(ain-adk-providers)는 이미 main API에 맞춰져 있다.
- 검증 명령: `pnpm install`, `pnpm build`, `pnpm test`, `pnpm biome`.
- 커밋은 Task 단위. push/PR은 사용자 확인 후.

---

### Task 1: merge 실행 및 충돌 해소

**Files:**
- Modify (충돌 해소): `pnpm-lock.yaml`, `src/container/index.ts`, `src/controllers/query.controller.ts`, `src/modules/index.ts`, `src/modules/models/base.model.ts`, `src/routes/api.routes.ts`, `src/services/a2a.service.ts`, `src/services/intents/fulfill.service.ts`, `src/services/query.service.ts`, `src/services/tool-calling.service.ts`, `src/types/memory.ts`, `tests/services/query.service.test.ts`, `tests/services/workflow-execution.service.test.ts`, `tests/services/workflow-variable-resolver.service.test.ts`
- Modify (충돌은 아니지만 이 Task에서 함께 수정): `src/types/message-input.ts` (`QueryExecutionInput`에 `documentIds` 추가)

**Interfaces:**
- Produces: `QueryExecutionInput = { query: string; displayQuery?: string; input?: QueryMessageInput; documentIds?: string[] }` — Task 1 이후 query 파이프라인 전체가 이 타입을 사용.
- Produces: `BaseModel`은 `generateMessages(params: ModelGenerateMessagesParams)` + `appendAssistantToolCallTurn` + `appendToolResult`를 갖는다. `appendMessages` 없음.

- [ ] **Step 1: 작업 트리 확인 후 merge 시작**

```bash
cd /Users/shyun/comcom/ain-agent/ain-adk
git status --porcelain   # 비어 있어야 함
git checkout feature/seonghwa/multi-modal-chat
git fetch origin
git merge origin/main --no-ff
```

Expected: `Automatic merge failed` + 위 14개 파일 CONFLICT. (파일 목록이 다르면 중단하고 재분석 — main이 그 사이 전진한 것.)

- [ ] **Step 2: 단순 union 충돌 해소 — import/export 4건**

`src/container/index.ts` (2개 hunk, 둘 다 import 충돌 — 양쪽 모두 유지):

```typescript
import { ArtifactApiController } from "@/controllers/api/artifact.api.controller";
import { DocumentApiController } from "@/controllers/api/document.api.controller";
```

```typescript
import { ArtifactService } from "@/services/artifact.service";
import { DocumentAdviceService } from "@/services/document-advice.service";
```

`src/routes/api.routes.ts` (1개 hunk — 양쪽 유지):

```typescript
import { createArtifactApiRouter } from "./api/artifacts.routes.js";
import { createDocumentApiRouter } from "./api/document.routes.js";
```

`src/modules/index.ts` (1개 hunk — union하되 `ModelAppendMessageInput`은 제외. Global Constraints 참조):

```typescript
	type AssistantToolCallTurn,
	BaseModel,
	type ModelFetchOptions,
	type ModelGenerateMessagesParams,
	type ToolResultMessage,
```

`src/types/memory.ts` (1개 hunk): **양쪽 블록을 모두 유지.** feature 쪽 `LegacyMessageContentObject`(canonical 이전 형식의 읽기 호환용)와 main 쪽 `TextPart`/`DocumentPart`/`MessagePart`/`MessageContentObject`(rich 메시지 — main의 workflow-execution 등이 사용)는 이름이 겹치지 않으므로 나란히 둔다. 두 표현의 통합은 Task 3에서 read-adapter로 처리하므로 여기서 타입을 합치려 하지 말 것.

- [ ] **Step 3: `src/modules/models/base.model.ts` 해소**

import 충돌 → 양쪽 union:

```typescript
import type { CanonicalMessageObject, ThreadObject } from "@/types/memory.js";
import type { AssembledToolCall, LLMStream } from "@/types/stream.js";
```

메서드 충돌 → feature의 `generateMessages(params: ModelGenerateMessagesParams)` 시그니처를 유지하고(main의 인라인 `{query; thread?; systemPrompt?}`의 상위 호환 — `input?: CanonicalMessageObject` 필드가 추가된 형태), main의 `appendAssistantToolCallTurn`/`appendToolResult` 추상 메서드(및 `AssistantToolCallTurn`, `ToolResultMessage` 인터페이스, JSDoc 전체)를 채택한다. feature의 `abstract appendMessages(...)` 선언과 `export type ModelAppendMessageInput = CanonicalMessageObject;`는 **삭제**한다.

- [ ] **Step 4: `src/services/tool-calling.service.ts` 해소 — main의 append 흐름 + feature의 스트림 이벤트**

main의 루프 구조를 기본으로 삼는다: `assembledToolCalls.length === 0`이면 early return, `appendAssistantToolCallTurn` 호출, "Tool not found" 및 "Invalid tool arguments JSON" 분기에서 `appendToolResult({..., isError: true})`, `MAX_TOOL_ITERATIONS` 경고. 여기에 feature의 `tool_start`/`tool_output` yield를 삽입한다. 도구 실행 부분의 병합 결과:

```typescript
			if (assembledToolCalls.length === 0) {
				return { toolCallsExecuted: processList.length };
			}

			modelInstance.appendAssistantToolCallTurn(params.messages, {
				content: assistantText.length > 0 ? assistantText : null,
				toolCalls: assembledToolCalls,
			});

			for (const toolCall of assembledToolCalls) {
				const toolName = toolCall.function.name;
				const selectedTool = this.selectTool(tools, toolName);
				if (!selectedTool) {
					loggers.intent.warn("Tool not found", {
						toolName,
						toolCallId: toolCall.id,
					});
					modelInstance.appendToolResult(params.messages, {
						toolCallId: toolCall.id,
						toolName,
						content: `Tool "${toolName}" is not available.`,
						isError: true,
					});
					continue;
				}

				let toolArgs: Record<string, unknown>;
				try {
					toolArgs = JSON.parse(toolCall.function.arguments || "{}");
				} catch (error) {
					loggers.intent.warn("Invalid tool arguments JSON", {
						toolName,
						arguments: toolCall.function.arguments,
						error,
					});
					modelInstance.appendToolResult(params.messages, {
						toolCallId: toolCall.id,
						toolName,
						content: `Invalid tool arguments JSON: ${toolCall.function.arguments}`,
						isError: true,
					});
					continue;
				}

				const { thinkingText, protocolArgs } = splitAdkToolArgs(toolArgs);
				const toolCallId = toolCall.id || `${toolName}-${Date.now()}`;
				yield {
					event: "thinking_process",
					data: {
						title: `[${getManifest().name}] ${selectedTool.protocol} 실행: ${toolName}`,
						description: truncateThinkingDescription(thinkingText),
					},
				};
				yield {
					event: "tool_start",
					data: {
						toolCallId,
						protocol: selectedTool.protocol,
						toolName,
						toolArgs: protocolArgs,
					},
				};

				const toolResult = yield* this.executeTool({
					toolName,
					selectedTool,
					protocolArgs,
					query: params.query,
					thread: params.thread,
				});

				loggers.intent.debug("Tool Result", { toolResult });
				processList.push(toolResult);
				yield {
					event: "tool_output",
					data: {
						toolCallId,
						protocol: selectedTool.protocol,
						toolName,
						result: toolResult,
					},
				};
				modelInstance.appendToolResult(params.messages, {
					toolCallId: toolCall.id,
					toolName,
					content: toolResult,
				});
			}
```

주의: `appendAssistantToolCallTurn`/`appendToolResult`에는 fallback 없는 `toolCall.id`를 그대로 쓴다(provider가 turn/result의 id 짝을 검증함). fallback이 붙은 `toolCallId`는 스트림 이벤트 표시용으로만 사용.

- [ ] **Step 5: `src/services/intents/fulfill.service.ts` 해소 — 양쪽 union**

```typescript
		if (intent?.workflowId && this.workflowExecutionService) {
			return this.intentWorkflowFulfilling(triggeredIntent, thread);
		}

		return this.intentFulfilling(subquery, thread, intent, input);
```

(main의 workflow dispatch 분기 + feature의 4번째 인자 `input`. `intentWorkflowFulfilling`과 `input` 변수는 각 브랜치에서 이미 존재하며 auto-merge로 들어와 있음.)

- [ ] **Step 6: `src/types/message-input.ts` — `QueryExecutionInput` 확장 (충돌 파일 아님)**

```typescript
export type QueryExecutionInput = {
	query: string;
	displayQuery?: string;
	input?: QueryMessageInput;
	documentIds?: string[];
};
```

- [ ] **Step 7: `src/services/query.service.ts` 해소 (4개 hunk)**

hunk 1 (import) — 양쪽 union:

```typescript
import {
	createMessageFromQueryInput,
	createModelInputMessage,
	createModelInputMessageFromQueryInput,
	normalizeThreadObject,
} from "@/utils/message";
import { updateRequestContext } from "@/utils/request-context.js";
```

hunk 2 (시그니처) — feature 쪽 채택: `queryData: QueryExecutionInput,` (Step 6에서 documentIds가 타입에 들어갔으므로 main 쪽 인라인 타입은 불필요).

hunk 3 (destructure) — 양쪽 union:

```typescript
		const { displayQuery, input } = queryData;
		const originalQuery = queryData.query;
		// Request bodies are untyped; accept only a real array of non-empty strings.
		const documentIds = Array.isArray(queryData.documentIds)
			? queryData.documentIds.filter(
					(id): id is string => typeof id === "string" && id.length > 0,
				)
			: undefined;
```

(주변에 main의 `let { query } = queryData;` + PII 필터 블록이 auto-merge로 존재. feature의 `originalQuery`와 공존 — 컴파일 에러 시 feature의 `originalQuery` 사용처를 확인해 정리.)

hunk 4 (user 메시지 저장) — feature의 canonical 저장을 채택하고 main의 `documentIds` 메타데이터를 합류:

```typescript
		await this.addToThreadMessages(userId, threadId, [
			createMessageFromQueryInput({
				messageId: randomUUID(),
				role: MessageRole.USER,
				timestamp: Date.now(),
				input: input ?? {
					parts: [{ kind: "text", text: query }],
				},
				// use displayQuery for better UX in enterprise application
				displayText: displayQuery,
				metadata: {
					intents: triggeredIntents
						.filter((intent) => !!intent.intent)
						.map((intent) => ({
							id: intent.intent?.id,
							subquery: intent.subquery,
						})),
					query: !displayQuery ? undefined : query,
					documentIds: documentIds?.length ? documentIds : undefined,
				},
			}),
		]);
```

hunk 4 직후의 main 코드(`injectAttachedDocuments(...)` 호출, PII maskFilter)는 auto-merge로 들어와 있으므로 **그대로 유지**한다 — 첨부 문서 본문을 fulfillment에 주입하는 main의 핵심 동작.

- [ ] **Step 8: `src/controllers/query.controller.ts` 해소 (4개 hunk — stream/non-stream 각 2개)**

destructure hunk (2곳): feature 쪽을 기본으로 하고 `documentIds`만 추가:

```typescript
		const { type, threadId, workflowId, title, documentIds } = req.body;
```

(main의 `message: query, displayMessage: displayQuery` destructure는 불필요 — feature는 body를 정규화 유틸로 처리해 `input`/`query`/`displayQuery`를 얻는 구조.)

호출 hunk (2곳): feature 쪽에 `documentIds` 추가:

```typescript
				{ input, query, displayQuery, documentIds },
```

- [ ] **Step 9: `src/services/a2a.service.ts` 해소 — main의 로그 + feature의 canonical input**

```typescript
		// Logged before any await: thread loading and the LLM calls inside
		// handleQuery emit nothing, so without this line a task that hangs
		// there leaves zero server-side trace of the request ever arriving.
		loggers.server.info(`Task ${taskId} started`, {
			threadId,
			agentId,
			isNewTask: !existingTask,
		});

		const input = createQueryInputFromA2AMessage(userMessage);
		if (input.parts.length === 0) {
```

(main의 text-part join 코드는 feature의 `createQueryInputFromA2AMessage`로 대체된 것이므로 버린다.)

- [ ] **Step 10: 테스트 파일 3건 해소 — union**

- `tests/services/query.service.test.ts` (1 hunk): feature 쪽 테스트를 유지하되, main 쪽에만 있는 테스트 케이스가 hunk 안에 있으면 함께 남긴다. 병합된 `QueryService` 생성자 시그니처(main이 추가한 의존성 포함)에 맞게 mock 인자를 맞춘다.
- `tests/services/workflow-execution.service.test.ts` (1 hunk, import): 양쪽 import를 union (`QueryService`/`ToolCallingService` type import + main의 `Document`, `DocumentFormat`, `WorkflowDefinition`, `WorkflowRenderedBlock`, `WorkflowTemplate`).
- `tests/services/workflow-variable-resolver.service.test.ts` (2 hunks): main 쪽에 추가된 테스트 케이스(`rejects heading blocks without text`, `rejects tasks missing a prompt` 등)를 전부 남긴다. feature 쪽 hunk가 비어있으면 main 쪽 전체 채택.

- [ ] **Step 11: `pnpm-lock.yaml` 재생성**

```bash
git checkout origin/main -- pnpm-lock.yaml   # 충돌 마커 제거용 임시 채택
pnpm install                                  # merge된 package.json 기준으로 재생성
git add pnpm-lock.yaml
```

- [ ] **Step 12: 컴파일 및 잔여 타입 에러 수정**

```bash
pnpm build
```

Expected: 충돌 마커가 남았거나 API drift(예: main 신규 서비스가 feature에서 바뀐 thread/message 유틸을 호출)가 있으면 여기서 드러난다. 에러가 나는 파일은 "동작은 main, 메시지 표현은 feature" 원칙으로 수정. 특히 확인할 것: main의 `document-advice.service`, `workflow-execution.service`, `scheduler` 계열이 feature에서 시그니처가 바뀐 `addTextMessage`/`persistTextMessage`/thread 유틸을 쓰는 곳.

- [ ] **Step 13: 테스트 실행**

```bash
pnpm test
```

Expected: PASS. 실패 시 실패 테스트가 main 동작 회귀인지 feature 동작 회귀인지 구분해 원인 쪽 코드를 수정(테스트를 약화시키지 말 것).

- [ ] **Step 14: biome 후 merge 커밋**

```bash
pnpm biome:write
git add -A
git commit   # 자동 생성된 merge 커밋 메시지에 "merge main(0.8.6) into multi-modal-chat" 요지 추가
```

---

### Task 2: 병합 후 회귀 검증 — main의 rich 메시지가 canonical read 경로를 통과하는지

**Files:**
- Test: `tests/utils/message.test.ts` (기존 파일에 케이스 추가)
- Modify (테스트가 실패할 경우): `src/utils/message.ts`

**Interfaces:**
- Consumes: `normalizeMessageParts(message: MessageObject): MessageContentPart[]` (feature의 legacy read adapter, `src/utils/message.ts:140`)
- Produces: 없음 — 검증 Task. rich 메시지 매핑의 **올바른** 결과는 Task 3에서 만든다. 이 Task는 크래시/예외가 없는지만 고정한다.

배경: main의 `workflow-execution.service.ts`는 `content: { type: "document", parts: [{ type: "document", documentId, title }] }` 형태의 메시지를 스레드에 쓴다. feature의 `normalizeLegacyContentPart`는 `part.kind`만 알고 `part.type`은 모르므로 이런 메시지는 text로 강제 직렬화된다(크래시는 아니어야 함).

- [ ] **Step 1: 크래시-없음 테스트 추가**

```typescript
	it("survives main-style document messages without throwing", () => {
		const message = {
			messageId: "m-doc",
			role: MessageRole.MODEL,
			timestamp: 1,
			content: {
				type: "document",
				parts: [{ type: "document", documentId: "doc-1", title: "8월 보고서" }],
			},
		} as unknown as MessageObject;

		expect(() => normalizeMessageParts(message)).not.toThrow();
	});
```

- [ ] **Step 2: 테스트 실행**

```bash
pnpm test -- tests/utils/message.test.ts
```

Expected: PASS (adapter가 unknown part를 text fallback으로 처리하는 구조라면 통과). FAIL이면 `normalizeLegacyContentPart`의 fallback 경로에서 non-string part를 안전하게 문자열화하도록 수정 후 재실행.

- [ ] **Step 3: 커밋**

```bash
git add tests/utils/message.test.ts src/utils/message.ts
git commit -m "test: pin legacy document-message read path after main merge"
```

---

### Task 3: DocumentContentPart — document를 canonical part 체계에 편입

**Files:**
- Modify: `src/types/memory.ts` (canonical part union에 `DocumentContentPart` 추가)
- Modify: `src/utils/message.ts` (`normalizeKnownPart`에 `document` case, `normalizeLegacyContentPart`에 main-rich `type` 매핑)
- Test: `tests/utils/message.test.ts`

**Interfaces:**
- Consumes: Task 1의 병합 결과 (main의 `DocumentPart = { type: "document", documentId, title? }`가 `src/types/memory.ts`에 존재).
- Produces: `DocumentContentPart = { kind: "document"; documentId: string; title?: string }`, `MessageContentPart` union에 포함. 클라이언트는 artifact part와 동일한 방식으로 document part를 렌더링 힌트로 사용한다.

설계 판단: document는 artifact 저장소가 아닌 document 저장소의 엔티티이므로 `ArtifactContentPart`에 욱여넣지 않고(ID 네임스페이스가 다름 — `artifactId`로 resolve 불가) canonical union에 별도 `kind: "document"`를 추가한다. 이것으로 main의 rich 메시지가 canonical 파이프라인에서 1급으로 읽힌다. document를 artifact 저장소로 물리 통합하는 것은 별도 프로젝트로 미룬다.

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/utils/message.test.ts`에 추가)

```typescript
	it("maps main-style rich document parts to canonical document parts", () => {
		const message = {
			messageId: "m-rich",
			role: MessageRole.MODEL,
			timestamp: 1,
			content: {
				type: "rich",
				parts: [
					{ type: "text", text: "보고서가 준비되었습니다." },
					{ type: "document", documentId: "doc-1", title: "8월 보고서" },
				],
			},
		} as unknown as MessageObject;

		expect(normalizeMessageParts(message)).toEqual([
			{ kind: "text", text: "보고서가 준비되었습니다." },
			{ kind: "document", documentId: "doc-1", title: "8월 보고서" },
		]);
	});

	it("passes through canonical document parts", () => {
		const message = {
			messageId: "m-canon",
			role: MessageRole.MODEL,
			timestamp: 1,
			schemaVersion: 2,
			parts: [{ kind: "document", documentId: "doc-2" }],
		} as unknown as MessageObject;

		expect(normalizeMessageParts(message)).toEqual([
			{ kind: "document", documentId: "doc-2" },
		]);
	});
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm test -- tests/utils/message.test.ts
```

Expected: FAIL — document part가 text로 stringify되어 deep-equal 불일치.

- [ ] **Step 3: 타입 추가** (`src/types/memory.ts`, canonical part 정의부 — `ArtifactContentPart` 아래)

```typescript
export type DocumentContentPart = {
	kind: "document";
	/** Resolved against the document store, not the artifact store. */
	documentId: string;
	/** Label hint for rendering (e.g. link text). Not the canonical title. */
	title?: string;
};
```

`MessageContentPart` union에 `| DocumentContentPart` 추가.

- [ ] **Step 4: read adapter 매핑 추가** (`src/utils/message.ts`)

`normalizeKnownPart`의 switch에 case 추가:

```typescript
		case "document":
			return normalizeDocumentPart(part);
```

정규화 함수 및 main-rich 형식(`kind` 대신 `type`) 매핑:

```typescript
function normalizeDocumentPart(
	part: Record<string, unknown>,
): DocumentContentPart {
	return {
		kind: "document",
		documentId: typeof part.documentId === "string" ? part.documentId : "",
		title: typeof part.title === "string" ? part.title : undefined,
	};
}
```

`normalizeLegacyContentPart`에서 text fallback 직전에 main-rich 분기 추가:

```typescript
	if (isRecord(part) && typeof part.type === "string") {
		if (part.type === "document" && typeof part.documentId === "string") {
			return normalizeDocumentPart(part);
		}
		if (part.type === "text" && typeof part.text === "string") {
			return normalizeTextPart(part.text);
		}
	}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
pnpm test -- tests/utils/message.test.ts
```

Expected: PASS (Task 2에서 추가한 크래시-없음 테스트 포함 전부).

- [ ] **Step 6: 전체 빌드/테스트/린트 후 커밋**

```bash
pnpm build && pnpm test && pnpm biome:write
git add -A
git commit -m "feat: map document parts into canonical message part union"
```

---

### Task 4: 최종 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 검증 일괄 실행**

```bash
pnpm build && pnpm test && pnpm biome
```

Expected: 모두 PASS/에러 0.

- [ ] **Step 2: 병합 결과 스모크 확인**

```bash
git log --oneline -5                     # merge 커밋 + Task 2, 3 커밋 확인
git diff origin/main...HEAD --stat | tail -3   # feature 고유 변경만 남았는지 규모 확인
git grep -n '<<<<<<<\|>>>>>>>' -- src tests || echo "no conflict markers"
```

Expected: conflict marker 0건.

- [ ] **Step 3: 사용자 보고**

push 및 PR 생성은 사용자 확인 후 진행. 보고에 포함할 것: merge 커밋 해시, 삭제된 API(`BaseModel.appendMessages`, `ModelAppendMessageInput`) — downstream provider 저장소(ain-adk-providers)가 feature 브랜치용 빌드를 쓰고 있다면 provider들이 main API(`appendAssistantToolCallTurn`/`appendToolResult`)를 구현했는지 확인 필요.
