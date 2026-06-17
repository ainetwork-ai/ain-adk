# Per-Template AI Advice Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each document template carry its own AI advice prompt (edited in intent-admin), and have WISE pass that prompt to the ADK advice endpoint so advice is generated per-template (global default as fallback).

**Architecture:** Add `advicePrompt?: string` to the document template in both repos (intent-admin writer + WISE reader). WISE's log book detail loads the template and passes `advicePrompt` in the advice request body. The ADK advice service uses the passed prompt as the system prompt, falling back to the existing global default.

**Tech Stack:** intent-admin (Next.js, mongodb driver), WISE (Next.js/mongoose/React), ain-adk-v0 (TS, Express, jest, SSE).

> **Repos & branches:** Tasks 1–3 → `intent-admin` (branch `feature/document-template-editor`). Task 4–5 → `ain-enterprise-monorepo` (branch `feature/seonghwa/wise-logbook`). Tasks 6–7 → `ain-adk-v0` (branch `feature/seonghwa/document-artifact`). Stage only the files each task edits in the monorepo (it has unrelated pending changes). No test runner in the Next.js repos; ain-adk-v0 has jest.

---

### Task 1: intent-admin — `advicePrompt` on type + validation

**Files:** Modify `src/types/document-template.ts`, `src/lib/document-template-validate.ts`

- [ ] **Step 1: Add field to the type**

In `src/types/document-template.ts`, add to `interface DocumentTemplate` (after `name?: string;`):
```ts
  /** Per-template system prompt for AI advice. Empty → global default. */
  advicePrompt?: string;
```

- [ ] **Step 2: Include it in the validator result**

In `src/lib/document-template-validate.ts`, the success return is:
```ts
    return {
        ok: true,
        value: { label, name: cleanString(raw.name), args, sections }
    };
```
Change the `value` object to include advicePrompt:
```ts
    return {
        ok: true,
        value: {
            label,
            name: cleanString(raw.name),
            advicePrompt: cleanString(raw.advicePrompt),
            args,
            sections
        }
    };
```
(`cleanString` already exists in this file.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`. Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/document-template.ts src/lib/document-template-validate.ts
git commit -m "feat(document-templates): add advicePrompt to template type + validation"
```

---

### Task 2: intent-admin — persist + return `advicePrompt` in the API

**Files:** Modify `src/app/api/document-templates/route.ts`, `src/app/api/document-templates/[label]/route.ts`, `src/app/api/document-templates/[label]/update/route.ts`

- [ ] **Step 1: list/create route — `toDTO` + create insert**

In `src/app/api/document-templates/route.ts`:
- In `toDTO`, the returned object has `label/name/args/sections/createdAt`. Add after `name`:
```ts
        advicePrompt: typeof doc.advicePrompt === 'string' ? doc.advicePrompt : undefined,
```
- In `POST` (create), the inserted `doc` is `{ label, name, args, sections, createdAt }`. Add after `name: result.value.name,`:
```ts
            advicePrompt: result.value.advicePrompt,
```

- [ ] **Step 2: single GET route — `toDTO`**

In `src/app/api/document-templates/[label]/route.ts`, its `toDTO` has the same shape; add after `name`:
```ts
        advicePrompt: typeof doc.advicePrompt === 'string' ? doc.advicePrompt : undefined,
```

- [ ] **Step 3: update route — `$set` / `$unset`**

In `src/app/api/document-templates/[label]/update/route.ts`, the update currently `$set`s `args`/`sections` and conditionally `name`. Mirror the `name` handling for `advicePrompt`: after the `name` block, add:
```ts
        if (result.value.advicePrompt) {
            (update.$set as Record<string, unknown>).advicePrompt = result.value.advicePrompt;
        } else {
            update.$unset = { ...(update.$unset as object), advicePrompt: '' };
        }
```
(If `update.$unset` is currently set only for `name`, this merges; if `name` used a fresh object, ensure both keys end up under `$unset`. Concretely: where `name` does `update.$unset = { name: '' }`, change such that both can coexist — initialise `const unset: Record<string, string> = {};` and assign `name`/`advicePrompt` into it, then `if (Object.keys(unset).length) update.$unset = unset;`. Implement so clearing either field unsets it.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`. Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/document-templates/route.ts" "src/app/api/document-templates/[label]/route.ts" "src/app/api/document-templates/[label]/update/route.ts"
git commit -m "feat(document-templates): persist + return advicePrompt"
```

---

### Task 3: intent-admin — advice prompt field in the editor

**Files:** Modify `src/components/document-templates/DocumentTemplateEditor.tsx`

- [ ] **Step 1: Add a Textarea below the Name field**

`Textarea` is already imported. The basics section has a `Name` block ending with its closing `</div>`. After that `Name` `<div className="flex flex-col gap-2"> ... </div>`, add a new block inside the same `<section>`:
```tsx
                <div className="flex flex-col gap-2">
                    <Label htmlFor="dt-advice-prompt">AI advice prompt</Label>
                    <Textarea
                        id="dt-advice-prompt"
                        value={value.advicePrompt ?? ''}
                        placeholder="비우면 기본 프롬프트를 사용합니다."
                        rows={6}
                        onChange={(e) => setField('advicePrompt', e.target.value)}
                    />
                </div>
```
(`setField` and `Label` already exist/are imported; `value.advicePrompt` is now on the type.)

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit -p tsconfig.json && pnpm build`. Expected: exit 0, `/document-templates` routes build.

- [ ] **Step 3: Commit**

```bash
git add src/components/document-templates/DocumentTemplateEditor.tsx
git commit -m "feat(document-templates): add AI advice prompt field to editor"
```

---

### Task 4: WISE — `advicePrompt` on the template model + API

**Files (ain-enterprise-monorepo):** Modify `apps/wise/src/lib/models/document-template.ts`, `apps/wise/src/app/api/document-templates/route.ts`. Stage ONLY these two.

- [ ] **Step 1: Model schema + interface**

In `apps/wise/src/lib/models/document-template.ts`:
- In `DocumentTemplateSchema`, add after the `name` field:
```ts
    /** AI advice 시스템 프롬프트 (비우면 기본값) */
    advicePrompt: { type: String },
```
- In the `DocumentTemplate` interface, add after `name?: string;`:
```ts
  /** AI advice system prompt. Empty → global default. */
  advicePrompt?: string;
```

- [ ] **Step 2: API passthrough**

In `apps/wise/src/app/api/document-templates/route.ts`:
- In `RawTemplate`, add after `name?: string | null;`:
```ts
  advicePrompt?: string | null;
```
- In `toDTO`, add after `name: doc.name ?? undefined,`:
```ts
    advicePrompt: doc.advicePrompt ?? undefined,
```
- In the upsert `$set`, add after `name: body.name ?? undefined,`:
```ts
          advicePrompt: body.advicePrompt ?? undefined,
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/wise && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "document-template|error TS" | head`. Expected: empty.

- [ ] **Step 4: Commit (only these two files)**

```bash
cd /Users/shyun/comcom/ain-enterprise/ain-enterprise-monorepo
git add apps/wise/src/lib/models/document-template.ts apps/wise/src/app/api/document-templates/route.ts
git commit -m "feat(wise): carry advicePrompt on document template model + API"
```

---

### Task 5: WISE — pass template advicePrompt into advice generation

**Files (ain-enterprise-monorepo):** Modify `apps/wise/src/hooks/use-document-advice.ts`, `apps/wise/src/components/log-book-detail.tsx`. Stage ONLY these.

- [ ] **Step 1: Hook accepts an advicePrompt and sends it in the body**

In `apps/wise/src/hooks/use-document-advice.ts`, change the hook to accept an optional prompt and include it in the request body. Specifically:
- Change the signature to `export function useDocumentAdvice(documentId: string, advicePrompt?: string): UseDocumentAdviceState {`.
- In `generate`, change the `authStreamFetch(... , {})` body argument from `{}` to `{ advicePrompt }` (the hook already builds the URL; just pass the body object). 
- Add `advicePrompt` to the `useCallback` dependency array.

Resulting `generate` body call:
```ts
      const { reader } = await authStreamFetch(
        `${API_URL}/api/document/${encodeURIComponent(documentId)}/advice/stream`,
        { advicePrompt },
      );
```
and the deps: `}, [authStreamFetch, documentId, advicePrompt]);`

- [ ] **Step 2: log-book-detail loads the template and passes its advicePrompt**

In `apps/wise/src/components/log-book-detail.tsx`:
- Add the import: `import { useDocumentTemplate } from '../hooks/use-document-template';`
- Where `document` is available, derive the template by the document's category label and pass its advice prompt to the advice hook. Replace the existing `const advice = useDocumentAdvice(documentId);` line with:
```tsx
  const { data: template } = useDocumentTemplate(document?.labels?.category ?? '');
  const advice = useDocumentAdvice(documentId, template?.advicePrompt);
```
(The `useDocumentTemplate` hook fetches `/api/document-templates?label=`; with an empty label it returns null/none — acceptable, advice then uses the default. The `react-query` call is safe to run unconditionally.)

- [ ] **Step 3: Typecheck + build**

Run: `cd apps/wise && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "use-document-advice|log-book-detail|error TS" | head` (expect empty), then from repo root `pnpm build --filter @repo/wise` (expect success).

- [ ] **Step 4: Commit (only these two files)**

```bash
cd /Users/shyun/comcom/ain-enterprise/ain-enterprise-monorepo
git add apps/wise/src/hooks/use-document-advice.ts apps/wise/src/components/log-book-detail.tsx
git commit -m "feat(wise): pass template advicePrompt into advice generation"
```

---

### Task 6: ADK — accept advicePrompt override (service + controller + test)

**Files (ain-adk-v0):** Modify `src/services/document-advice.service.ts`, `src/controllers/api/document.api.controller.ts`, `tests/services/document-advice.service.test.ts`

- [ ] **Step 1: Extend the service test (failing)**

In `tests/services/document-advice.service.test.ts`, add a test inside the `describe` block:
```ts
	it("uses the provided advicePrompt as the system prompt", async () => {
		const { modelModule, memoryModule, model } = makeModules();
		const service = new DocumentAdviceService(modelModule, memoryModule);
		await collect(
			service.generateAdviceStream("doc-1", { advicePrompt: "커스텀 프롬프트" }),
		);
		expect(model.generateMessages).toHaveBeenCalledWith(
			expect.objectContaining({ systemPrompt: "커스텀 프롬프트" }),
		);
	});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `yarn jest tests/services/document-advice.service.test.ts -t "uses the provided advicePrompt"`
Expected: FAIL (the service ignores options / signature mismatch).

- [ ] **Step 3: Add the `options` param to the service**

In `src/services/document-advice.service.ts`, change the method signature and the system-prompt line. Signature:
```ts
	async *generateAdviceStream(
		documentId: string,
		options?: { advicePrompt?: string },
		signal?: AbortSignal,
	): AsyncGenerator<StreamEvent> {
```
And replace the `const systemPrompt = await documentAdvicePrompt(this.memoryModule);` line with:
```ts
		const systemPrompt =
			options?.advicePrompt?.trim() ||
			(await documentAdvicePrompt(this.memoryModule));
```
(Everything else unchanged. The previous `generateAdviceStream("doc-1")` and `generateAdviceStream("doc-1")` calls in existing tests still type-check since `options`/`signal` are optional.)

- [ ] **Step 4: Update the controller to read the body + pass options**

In `src/controllers/api/document.api.controller.ts`, in `handleGenerateAdviceStream`, change the `setup` to read `advicePrompt` from the body and pass it:
```ts
			setup: async (signal) => {
				await this.getAuthorizedDocument(userId, id);
				const { advicePrompt } = req.body as { advicePrompt?: string };
				return this.documentAdviceService.generateAdviceStream(
					id,
					{ advicePrompt },
					signal,
				);
			},
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `yarn jest tests/services/document-advice.service.test.ts`
Expected: all advice tests PASS (including the new one).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.json` (expect no errors), then:
```bash
git add src/services/document-advice.service.ts src/controllers/api/document.api.controller.ts tests/services/document-advice.service.test.ts
git commit -m "feat(document-advice): accept per-call advicePrompt override"
```

---

### Task 7: ADK — build + refresh local-agents

- [ ] **Step 1: Build + full test**

Run: `yarn build && yarn test`. Expected: build done; all suites pass.

- [ ] **Step 2: Refresh local-agents install**

```bash
cd /Users/shyun/comcom/ain-enterprise/local-agents && rm -rf node_modules && pnpm install
```
Then restart the running agent (manual).

---

### Task 8: Manual verification

- [ ] **Step 1:** In intent-admin (`NEXT_PUBLIC_SIDEBAR_DOCUMENT=true` + `WISE_FRONT_MONGO_URL`), open the `logbook` template, enter an "AI advice prompt", Save, reload → the prompt persists.
- [ ] **Step 2:** In WISE, open a log book of that template → advice is generated using the template's prompt (verify the tone/instructions match the custom prompt; click "다시 생성" to re-run).
- [ ] **Step 3:** Clear the template's advice prompt, Save → new advice generations fall back to the global default prompt.
