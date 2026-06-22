# Document AI Advice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a short AI advice from a log book document's content (streamed, cached on the document) and show it in a code-block-style card at the bottom of the log book detail.

**Architecture:** A dedicated ADK service streams a single-turn model completion (system = advice prompt, user = `renderDocument(document)`), emits `text_chunk` SSE events, and caches the result on `document.advice`. A new `POST /api/document/:id/advice/stream` endpoint mirrors the slot-fill streaming endpoint. The WISE log book detail consumes the stream and renders the advice.

**Tech Stack:** ain-adk-v0 (TS, Express, jest, SSE); ain-enterprise-monorepo (@repo/utils types, @repo/ui SSE utils, WISE React).

> **Repos & branches:** Tasks 1–5 in `ain-adk-v0` (create a branch, e.g. `git checkout -b feature/document-ai-advice` if on a shared branch). Tasks 6–8 in `ain-enterprise-monorepo` (branch `feature/seonghwa/wise-logbook` is active there). ain-adk-v0 has jest; the monorepo apps have no test runner (verify with tsc/build/manual).

---

### Task 1: ADK — `DocumentAdvice` type on `Document`

**Files:** Modify `src/types/document.ts`

- [ ] **Step 1: Add the type + field**

In `src/types/document.ts`, add this interface just above `export interface Document {`:
```ts
/** AI-generated advice derived from a document's rendered content. */
export interface DocumentAdvice {
	/** Generated advice text (plain prose / light markdown). */
	content: string;
	/** ISO timestamp when generated. */
	generatedAt: string;
}
```
Then inside `export interface Document { ... }`, add after the `blocks?` line (around line 95):
```ts
	/** Cached AI advice generated from the rendered content. */
	advice?: DocumentAdvice;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json` (or `yarn build` later). Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/document.ts
git commit -m "feat(document): add DocumentAdvice type"
```

---

### Task 2: ADK — advice prompt + agent-memory hook

**Files:**
- Create: `src/services/prompts/document-advice.ts`
- Modify: `src/modules/memory/base.memory.ts`

- [ ] **Step 1: Add the agent-memory prompt hook**

In `src/modules/memory/base.memory.ts`, in the `IAgentMemory` interface, add alongside the other `getXxxPrompt?` members (after `getGenerateTitlePrompt?(): Promise<string>;`):
```ts
	getDocumentAdvicePrompt?(): Promise<string>;
```

- [ ] **Step 2: Create the prompt module** (mirrors `generate-title.ts`)

`src/services/prompts/document-advice.ts`:
```ts
import type { MemoryModule } from "@/modules";

async function documentAdvicePrompt(memoryModule: MemoryModule) {
	const prompt =
		(await memoryModule?.getAgentMemory()?.getDocumentAdvicePrompt?.()) ||
		`당신은 매장 운영을 돕는 분석 어시스턴트입니다.
아래는 한 매장의 로그북(운영 메모와 매출/지표 데이터)입니다.
이 내용을 바탕으로 운영자에게 도움이 되는 조언을 한국어로 작성하세요.

작성 지침:
- 문단형 산문으로 작성하고, 마크다운 제목/불릿은 사용하지 마세요.
- 먼저 오늘 운영에 대한 간단한 인정/격려로 시작하세요.
- 다음 영업일 전망과, 데이터에 근거한 수치 기대치를 제시하세요.
- 입력에 없는 수치나 사실을 지어내지 마세요. 데이터가 없으면 일반적인 조언만 하세요.
- 실행 가능한 운영 팁을 1~2가지 제시하세요.
- 마지막은 짧은 응원의 한 문장으로 마무리하세요.
- 사용자가 입력한 언어로 답하세요.`;
	return prompt;
}

export default documentAdvicePrompt;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`. Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/prompts/document-advice.ts src/modules/memory/base.memory.ts
git commit -m "feat(document-advice): add advice prompt and agent-memory hook"
```

---

### Task 3: ADK — `DocumentAdviceService` (+ unit test)

**Files:**
- Create: `src/services/document-advice.service.ts`
- Test: `tests/services/document-advice.service.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/services/document-advice.service.test.ts`:
```ts
import { DocumentAdviceService } from "@/services/document-advice.service";
import type { MemoryModule, ModelModule } from "@/modules";

async function collect(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
	const out: unknown[] = [];
	for await (const e of gen) out.push(e);
	return out;
}

describe("DocumentAdviceService", () => {
	const document = {
		documentId: "doc-1",
		userId: "u1",
		title: "Log",
		format: "MARKDOWN",
		content: "## 매출\n{{slot:rev}}\n",
		version: 2,
		source: "MANUAL",
		slots: [
			{
				slotId: "rev",
				status: "resolved",
				fragment: { content: "총매출 100만원", source: { type: "QUERY", query: "" }, resolvedAt: "t" },
			},
		],
		createdAt: "t0",
		updatedAt: "t0",
	};

	function makeModules(updateDocument = jest.fn(async () => undefined)) {
		const model = {
			generateMessages: jest.fn(() => [{ role: "user", content: "x" }]),
			fetchStreamWithContextMessage: jest.fn(async () => ({
				async *[Symbol.asyncIterator]() {
					yield { delta: { content: "좋은 " } };
					yield { delta: { content: "하루였습니다." } };
				},
			})),
		};
		const modelModule = {
			getModel: () => model,
			getModelOptions: () => ({}),
		} as unknown as ModelModule;
		const memoryModule = {
			getDocumentMemory: () => ({
				getDocument: jest.fn(async () => document),
				updateDocument,
			}),
			getAgentMemory: () => ({}),
		} as unknown as MemoryModule;
		return { modelModule, memoryModule, model, updateDocument };
	}

	it("streams advice text and caches it on the document", async () => {
		const { modelModule, memoryModule, updateDocument } = makeModules();
		const service = new DocumentAdviceService(modelModule, memoryModule);

		const events = await collect(service.generateAdviceStream("doc-1"));

		const text = events
			.filter((e: any) => e.event === "text_chunk")
			.map((e: any) => e.data.delta)
			.join("");
		expect(text).toBe("좋은 하루였습니다.");

		// Persisted advice on completion.
		const lastCall = updateDocument.mock.calls.at(-1);
		expect(lastCall?.[0]).toBe("doc-1");
		expect((lastCall?.[1] as any).advice.content).toBe("좋은 하루였습니다.");
		expect(typeof (lastCall?.[1] as any).advice.generatedAt).toBe("string");
	});

	it("does not persist when the model produces no content", async () => {
		const { modelModule, memoryModule, model, updateDocument } = makeModules();
		(model.fetchStreamWithContextMessage as jest.Mock).mockResolvedValue({
			async *[Symbol.asyncIterator]() {
				/* no chunks */
			},
		});
		const service = new DocumentAdviceService(modelModule, memoryModule);
		await collect(service.generateAdviceStream("doc-1"));
		expect(updateDocument).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest tests/services/document-advice.service.test.ts`
Expected: FAIL (module `document-advice.service` not found).

- [ ] **Step 3: Implement the service**

`src/services/document-advice.service.ts`:
```ts
import type { MemoryModule, ModelModule } from "@/modules";
import type { StreamEvent } from "@/types/stream.js";
import { loggers } from "@/utils/logger.js";
import { renderDocument } from "@/utils/document-render.js";
import documentAdvicePrompt from "./prompts/document-advice.js";

/**
 * Generates AI advice for a document by running a single-turn streaming model
 * completion over the document's rendered content, then caches the result on
 * `document.advice`. Mirrors the streaming-text pattern used by the workflow
 * response composer.
 */
export class DocumentAdviceService {
	private modelModule: ModelModule;
	private memoryModule: MemoryModule;

	constructor(modelModule: ModelModule, memoryModule: MemoryModule) {
		this.modelModule = modelModule;
		this.memoryModule = memoryModule;
	}

	async *generateAdviceStream(
		documentId: string,
		signal?: AbortSignal,
	): AsyncGenerator<StreamEvent> {
		const documentMemory = this.memoryModule.getDocumentMemory();
		if (!documentMemory) {
			throw new Error("Document memory is not initialized");
		}
		const document = await documentMemory.getDocument(documentId);
		if (!document) {
			throw new Error(`Document not found: ${documentId}`);
		}

		const renderedContent = renderDocument(document);
		const systemPrompt = await documentAdvicePrompt(this.memoryModule);

		const model = this.modelModule.getModel();
		const modelOptions = this.modelModule.getModelOptions();
		const messages = model.generateMessages({
			query: renderedContent,
			systemPrompt,
		});

		let content = "";
		const stream = await model.fetchStreamWithContextMessage(
			messages,
			[],
			modelOptions,
		);
		for await (const chunk of stream) {
			if (signal?.aborted) {
				throw new Error("Advice generation aborted by client");
			}
			if (chunk.delta?.content) {
				content += chunk.delta.content;
				yield { event: "text_chunk", data: { delta: chunk.delta.content } };
			}
		}

		if (!content.trim()) {
			return;
		}

		try {
			await documentMemory.updateDocument(documentId, {
				advice: { content, generatedAt: new Date().toISOString() },
				version: document.version + 1,
				updatedAt: new Date().toISOString(),
			});
		} catch (saveError) {
			loggers.agent.error("Failed to cache document advice", {
				documentId,
				error: saveError,
			});
		}
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest tests/services/document-advice.service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/document-advice.service.ts tests/services/document-advice.service.test.ts
git commit -m "feat(document-advice): add DocumentAdviceService with streaming + cache"
```

---

### Task 4: ADK — controller method, route, DI wiring

**Files:**
- Modify: `src/controllers/api/document.api.controller.ts`
- Modify: `src/routes/api/document.routes.ts`
- Modify: `src/container/index.ts`

- [ ] **Step 1: Add a container accessor + pass service to the controller**

In `src/container/index.ts`:
- Add an import near the other service imports: `import { DocumentAdviceService } from "@/services/document-advice.service";`
- Add a private field near `_workflowExecutionService`: `private _documentAdviceService?: DocumentAdviceService;`
- Add an accessor method (mirror `getWorkflowExecutionService`), using the existing module getters (`getModelModule()` / `getMemoryModule()` — confirm their names in this file; they are the same getters the other services use):
```ts
	getDocumentAdviceService(): DocumentAdviceService {
		if (!this._documentAdviceService) {
			this._documentAdviceService = new DocumentAdviceService(
				getModelModule(),
				getMemoryModule(),
			);
		}
		return this._documentAdviceService;
	}
```
- In `getDocumentApiController()`, pass the advice service as a third constructor arg:
```ts
			this._documentApiController = new DocumentApiController(
				getMemoryModule(),
				this.getWorkflowExecutionService(),
				this.getDocumentAdviceService(),
			);
```
- In the `reset()` method (where `_documentApiController = undefined;` is), add: `this._documentAdviceService = undefined;`

> Note: confirm the exact module-getter names used at the top of this file for model/memory (e.g. `getModelModule`, `getMemoryModule` from `@/config/modules`) and match them.

- [ ] **Step 2: Accept the service in the controller + add the handler**

In `src/controllers/api/document.api.controller.ts`:
- Add an import: `import type { DocumentAdviceService } from "@/services/document-advice.service.js";`
- Add a field and constructor param (the controller currently takes `memoryModule` and `workflowExecutionService`):
```ts
	private documentAdviceService: DocumentAdviceService;

	constructor(
		memoryModule: MemoryModule,
		workflowExecutionService: WorkflowExecutionService,
		documentAdviceService: DocumentAdviceService,
	) {
		this.memoryModule = memoryModule;
		this.workflowExecutionService = workflowExecutionService;
		this.documentAdviceService = documentAdviceService;
	}
```
- Add a handler mirroring `handleFillSlotStream` (same `streamEventsToSSE` usage), at the end of the class:
```ts
	public handleGenerateAdviceStream = async (req: Request, res: Response) => {
		const userId = res.locals.userId || "";
		const { id } = req.params as { id: string };

		await streamEventsToSSE(req, res, {
			logLabel: "Document advice stream",
			userId,
			logContext: { documentId: id },
			setup: async (signal) => {
				await this.getAuthorizedDocument(userId, id);
				return this.documentAdviceService.generateAdviceStream(id, signal);
			},
		});
	};
```

- [ ] **Step 3: Add the route**

In `src/routes/api/document.routes.ts`, add after the slot fill stream route:
```ts
	router.post(
		"/:id/advice/stream",
		checkDocumentMemory,
		controller.handleGenerateAdviceStream,
	);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`. Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/api/document.api.controller.ts src/routes/api/document.routes.ts src/container/index.ts
git commit -m "feat(document-advice): add advice stream endpoint + DI wiring"
```

---

### Task 5: ADK — build + full test run

- [ ] **Step 1: Build (ESM/CJS + DTS)**

Run: `yarn build`. Expected: `Done`, no type errors.

- [ ] **Step 2: Full test suite**

Run: `yarn test`. Expected: all suites pass (including the new advice test).

- [ ] **Step 3 (deploy refresh): refresh local-agents install** so the running agent has the new endpoint:

```bash
cd /Users/shyun/comcom/ain-enterprise/local-agents && rm -rf node_modules && pnpm install
grep -rl "generateAdviceStream" node_modules/@ainetwork/adk/dist >/dev/null && echo "FRESH" || echo "STALE"
```
Expected: `FRESH`. (Then the agent process must be restarted — manual.)

---

### Task 6: monorepo — mirror `DocumentAdvice` in @repo/utils

**Files:** Modify `packages/utils/src/types/document.ts`

- [ ] **Step 1: Add the type + field**

Add above `export interface Document {`:
```ts
/** AI-generated advice derived from a document's rendered content. */
export interface DocumentAdvice {
  content: string;
  generatedAt: string;
}
```
Inside `Document`, after the `blocks?` line:
```ts
  /** Cached AI advice generated from the rendered content. */
  advice?: DocumentAdvice;
```

- [ ] **Step 2: Typecheck**

Run from `ain-enterprise-monorepo`: `npx tsc --noEmit -p packages/utils/tsconfig.json` (or the repo's typecheck). Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/utils/src/types/document.ts
git commit -m "feat(utils): mirror DocumentAdvice on Document type"
```

---

### Task 7: WISE — `useDocumentAdvice` streaming hook

**Files:** Create `apps/wise/src/hooks/use-document-advice.ts`

- [ ] **Step 1: Implement the hook**

`apps/wise/src/hooks/use-document-advice.ts`:
```ts
'use client';

import { useCallback, useState } from 'react';
import { useAuthStreamFetch } from '@repo/auth';
import { parseSSEBuffer } from '@repo/ui';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface UseDocumentAdviceState {
  /** Live/streamed advice text (set during generation). */
  streamed: string;
  isGenerating: boolean;
  error: string | null;
  /** Starts (or restarts) advice generation, streaming text in. */
  generate: () => Promise<void>;
}

/** Streams AI advice for a document from the ADK advice endpoint. */
export function useDocumentAdvice(documentId: string): UseDocumentAdviceState {
  const authStreamFetch = useAuthStreamFetch();
  const [streamed, setStreamed] = useState('');
  const [isGenerating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    if (!API_URL) return;
    setGenerating(true);
    setError(null);
    setStreamed('');
    try {
      const { reader } = await authStreamFetch(
        `${API_URL}/api/document/${encodeURIComponent(documentId)}/advice/stream`,
        {},
      );
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, remaining } = parseSSEBuffer(buffer);
        buffer = remaining;
        for (const e of events) {
          if (e.event === 'text_chunk' && e.data?.delta) {
            text += e.data.delta;
            setStreamed(text);
          } else if (e.event === 'error') {
            throw new Error(e.data?.message || 'advice stream error');
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '조언을 생성하지 못했습니다.');
    } finally {
      setGenerating(false);
    }
  }, [authStreamFetch, documentId]);

  return { streamed, isGenerating, error, generate };
}
```
Notes: `useAuthStreamFetch()` (from `@repo/auth`) returns a function `(url, body, signal?) => Promise<{ reader }>` that attaches the auth header (used by the chat stream). `parseSSEBuffer` (from `@repo/ui`) returns `{ events, remaining }` where each event is `{ event, data }`. If the `e.data` shape differs (string vs object), adapt the access and report — check `packages/ui/src/lib/sse-parser.ts`.

- [ ] **Step 2: Typecheck**

Run: `cd apps/wise && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "use-document-advice|error TS" | head`. Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add apps/wise/src/hooks/use-document-advice.ts
git commit -m "feat(wise): add useDocumentAdvice streaming hook"
```

---

### Task 8: WISE — AI advice card in `log-book-detail.tsx`

**Files:** Modify `apps/wise/src/components/log-book-detail.tsx`

- [ ] **Step 1: Wire the hook + auto-generate, render the card**

Add imports at the top (with the existing imports):
```tsx
import { useEffect } from 'react';
import { useDocumentAdvice } from '../hooks/use-document-advice';
```
(If `useState` is already imported from 'react', add `useEffect` to that import instead of a duplicate line.)

Inside the `LogBookDetail` component, after the existing `useDocument(...)` call, add:
```tsx
  const advice = useDocumentAdvice(documentId);
  // 슬롯이 모두 resolved(또는 슬롯 없음)이고 캐시된 advice가 없으면 자동 생성.
  const slotsReady =
    (document?.slots ?? []).every((s) => s.status === 'resolved');
  const hasCachedAdvice = Boolean(document?.advice?.content);
  useEffect(() => {
    if (
      document &&
      !hasCachedAdvice &&
      slotsReady &&
      !advice.isGenerating &&
      !advice.streamed &&
      !advice.error
    ) {
      advice.generate();
    }
  }, [document, hasCachedAdvice, slotsReady, advice]);
```

Then, inside the returned JSX, after the `<DocumentBody ... />` block (still inside the same content container), add the advice card:
```tsx
          {/* AI advice */}
          {(hasCachedAdvice || slotsReady) && (
            <div className="mt-2 w-full rounded-2xl border border-gray-200 bg-gray-50 p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-900">AI advice</span>
                {!advice.isGenerating && (
                  <button
                    type="button"
                    onClick={() => advice.generate()}
                    className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                  >
                    다시 생성
                  </button>
                )}
              </div>
              {advice.error ? (
                <p className="text-sm text-red-600">{advice.error}</p>
              ) : advice.streamed ? (
                <MarkdownRenderer content={advice.streamed} />
              ) : document?.advice?.content ? (
                <MarkdownRenderer content={document.advice.content} />
              ) : (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  조언을 생성하고 있습니다...
                </div>
              )}
            </div>
          )}

          {/* 슬롯 미조회 안내 */}
          {!hasCachedAdvice && !slotsReady && (
            <p className="mt-2 w-full text-sm text-gray-400">
              데이터를 먼저 불러오면 AI 조언이 생성됩니다.
            </p>
          )}
```
Notes:
- `MarkdownRenderer` and `Loader2` must be imported. `Loader2` is already imported from `lucide-react` in this file; add `MarkdownRenderer` to the existing `@repo/ui` import if not present.
- The card sits inside the same `flex w-full flex-col gap-6` container that holds `<DocumentBody>`.
- Prefer the live `advice.streamed` while generating/just-generated; otherwise fall back to the cached `document.advice.content`.

- [ ] **Step 2: Typecheck + build**

Run: `cd apps/wise && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "log-book-detail|error TS" | head` (expect empty), then from repo root `pnpm build --filter @repo/wise` (expect success).

- [ ] **Step 3: Commit**

```bash
git add apps/wise/src/components/log-book-detail.tsx
git commit -m "feat(wise): add AI advice card to log book detail"
```

---

### Task 9: Manual verification

- [ ] **Step 1:** Rebuild/redeploy the ADK backend (Task 5 step 3) and restart the agent so `/api/document/:id/advice/stream` exists.
- [ ] **Step 2:** Open a log book whose slots are all resolved → the AI advice card auto-streams text in, then (reload) shows the cached `document.advice`.
- [ ] **Step 3:** Click "다시 생성" → regenerates and overwrites the cache.
- [ ] **Step 4:** Open a log book with an unresolved slot → shows "데이터를 먼저 불러오면 AI 조언이 생성됩니다." and does not auto-generate.
- [ ] **Step 5:** Simulate a backend error (e.g., stop the agent) → card shows "조언을 생성하지 못했습니다." with a working "다시 생성" button.
