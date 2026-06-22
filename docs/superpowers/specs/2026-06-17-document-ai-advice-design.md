# Document AI Advice — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorming) → ready for implementation plan
**Repos touched:** `ain-adk-v0` (inference: type, prompt, service, controller, route, DI) and
`ain-enterprise-monorepo` (@repo/utils type, @repo/ui api, WISE log-book detail UI).

## Goal

Add an **AI advice** area at the bottom of the log book detail that generates a short,
operational suggestion based on the content already entered/loaded in the document
(field text + resolved workflow slots), streams it in, caches it on the document, and
renders it in a distinct code-block-style card.

## Decisions (from brainstorming)

1. **Inference location:** a dedicated ADK advice service + endpoint (not the generic
   query pipeline, not a workflow/slot). Input is the fully rendered document.
2. **Trigger + caching:** auto-generate when the document has no cached advice and its
   slots are all resolved (or it has no slots); cache the result on the document; a
   "regenerate" button re-runs it.
3. **Response:** streaming over SSE (same infra as slot fill).
4. **Prompt:** a default Korean advice prompt, overridable via agent memory.
5. **Out of scope:** the "오늘 매출에 대해 더 알아보기" button (later); generalizing to
   non-log-book documents (advice UI shows only on the log book detail for now).

## Data model

Add to `Document` (both `ain-adk-v0/src/types/memory.ts` — where `Document` is defined —
and the `@repo/utils` mirror `packages/utils/src/types/document.ts`):
```ts
export interface DocumentAdvice {
  /** Generated advice text (markdown/plain prose). */
  content: string;
  /** ISO timestamp when generated. */
  generatedAt: string;
}
// on Document:
advice?: DocumentAdvice;
```
> Confirm during implementation which file declares the canonical `Document` in
> `ain-adk-v0` (it is imported from `@/types/document.js` in services). Add `DocumentAdvice`
> next to that declaration and mirror it in `@repo/utils`.

## Backend (ain-adk-v0)

### Prompt — `src/services/prompts/document-advice.ts`
Follows the `generate-title.ts` pattern: an async function that returns
`(await memoryModule?.getAgentMemory()?.getDocumentAdvicePrompt?.()) || <default>`.
Default (Korean): instruct the model to read the log book content (operational notes +
sales data) and produce a concise advice in flowing paragraphs — brief acknowledgement of
the day, tomorrow's outlook, any numeric expectations grounded in the data, an operational
tip, and a short closing encouragement. Respond in the user's language; no markdown
headings; do not invent numbers not present in the input.
- Add `getDocumentAdvicePrompt?(): Promise<string | undefined>` to the agent memory
  interface (optional method, same shape as the other `getXxxPrompt` hooks).

### Service — `src/services/document-advice.service.ts`
`class DocumentAdviceService` constructed with `ModelModule` + `MemoryModule`.
`async *generateAdviceStream(documentId, signal?): AsyncGenerator<StreamEvent>`:
1. Load document via `memoryModule.getDocumentMemory().getDocument(documentId)`; throw if
   missing / no document memory.
2. `renderDocument(document)` → input text (already substitutes resolved slot fragments).
3. Build a single-turn request with the model module: system = advice prompt, user =
   rendered document text. Stream the model output, yielding `text_chunk` events.
   (Use the same ModelModule streaming path the query service uses for a plain completion —
   confirm the exact method during implementation.)
4. Accumulate the streamed text; on completion persist
   `document.advice = { content, generatedAt: now }` via `updateDocument` (bump version/
   updatedAt consistent with how slot fill writes).
5. Never leak a half-written cache: only persist when the stream finishes without error.

### Controller + route
- `DocumentApiController`: add `handleGenerateAdviceStream` (and a non-stream
  `handleGenerateAdvice`) mirroring `handleFillSlotStream` (use `streamEventsToSSE`).
- Routes (`document.routes.ts`): `POST /:id/advice/stream` and `POST /:id/advice`, behind
  the existing `checkDocumentMemory` guard.
- DI container: construct `DocumentAdviceService` and pass it to `DocumentApiController`
  (extend its constructor), following the existing wiring.

## Frontend (ain-enterprise-monorepo)

### @repo/utils
Mirror `DocumentAdvice` + `advice?` on the `Document` type.

### @repo/ui — `use-app-api.ts`
Add `generateDocumentAdviceStream(documentId, signal?)` using the existing
`useAuthStreamFetch` (POST to `${apiUrl}/api/document/:id/advice/stream`), returning the
reader the same way other stream calls do. (Reuse the existing SSE parsing util the slot
fill / chat stream uses to read `text_chunk` deltas.)

### WISE — `apps/wise/src/components/log-book-detail.tsx`
Add an **AI advice** card below `<DocumentBody>`:
- Distinct code-block-style container (border + subtle background, rounded), with a small
  "AI advice" label at top; body renders the advice text (markdown via `MarkdownRenderer`
  or plain text).
- State machine:
  - `document.advice` present → render it; show a "다시 생성" (regenerate) button.
  - absent AND all existing slots `resolved` (or no slots) → auto-start the stream on mount;
    render streaming text live; on completion the document is refetched (advice now cached).
  - absent AND some slot not yet resolved → show hint "데이터를 먼저 불러오면 조언이
    생성됩니다." (no auto-generate).
- Regenerate triggers the stream again (overwrites the cache on completion).
- Guard the fetch on `status === 'authenticated'` (consistent with the rest of the file).

## Error handling
- Backend: missing document / model error → SSE `error` event; nothing persisted.
- Frontend: stream error → card shows "조언을 생성하지 못했습니다." with the regenerate button.

## Testing / verification
- ain-adk-v0: `yarn build`; jest unit test for `DocumentAdviceService.generateAdviceStream`
  with mocked model + memory (asserts it renders the doc, streams text, and persists
  `advice` on completion; does not persist on error). Mirrors existing service tests.
- Frontend: `tsc` + WISE build; manual — open a log book with resolved slots, confirm advice
  auto-streams into the card and persists on reload; regenerate works; unresolved-slots
  state shows the hint.

## Out of scope
- The "오늘 매출에 대해 더 알아보기" button.
- Advice on non-log-book documents.
- Configurable prompt UI (the prompt is code-default + agent-memory override only).
