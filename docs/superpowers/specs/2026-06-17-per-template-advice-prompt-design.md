# Per-Template AI Advice Prompt — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorming) → ready for implementation plan
**Repos touched:** `intent-admin` (template editor + API), `ain-enterprise-monorepo` (WISE model/API/UI), `ain-adk-v0` (advice endpoint + service).

## Goal

Make the AI advice prompt **per document template** instead of a single global prompt.
A template author edits an "AI advice prompt" on the template in intent-admin; when the log
book detail generates advice, WISE passes that template's prompt to the ADK advice endpoint,
which uses it as the system prompt (falling back to the global default when absent).

## Decisions (from brainstorming)

1. **Granularity:** per document **template** (not per individual document instance).
2. **Approach A — store on template + pass at generate time:** the prompt lives on the
   template (WISE front Mongo, edited via intent-admin). WISE reads it and passes it in the
   advice request body at generation time, so the latest template prompt is always used.
   No document/payload schema changes, no cross-DB access from ADK.
3. **Fallback:** if no `advicePrompt` is provided (empty or pre-existing templates), the ADK
   global default prompt (`src/services/prompts/document-advice.ts`) is used — backward
   compatible.

## Data model

Add one optional top-level field to the document template (both repos):
```ts
// DocumentTemplate
advicePrompt?: string;
```
No change to `Document`, `CreateDocumentPayload`, or the advice cache.

## Components & data flow

### intent-admin
- `src/types/document-template.ts`: add `advicePrompt?: string` to `DocumentTemplate`.
- `src/lib/document-template-validate.ts`: include `advicePrompt: cleanString(raw.advicePrompt)`
  in the validated/normalized result (pass-through; no hard validation).
- API routes (`route.ts` list/create `toDTO`, `[label]/route.ts` `toDTO`): the create body
  and update already go through `validateDocumentTemplate`, so persisting `advicePrompt`
  requires (a) `validateDocumentTemplate` returning it and (b) the create insert / update
  `$set` and the `toDTO` mappers including it.
- `DocumentTemplateEditor.tsx`: add an "AI advice 프롬프트" `Textarea` near label/name,
  bound to `value.advicePrompt`, placeholder "비우면 기본 프롬프트를 사용합니다".

### WISE (ain-enterprise-monorepo)
- `apps/wise/src/lib/models/document-template.ts`: add `advicePrompt` to
  `DocumentTemplateSchema` (`{ type: String }`) and `advicePrompt?: string` to
  `DocumentTemplate` interface.
- `apps/wise/src/app/api/document-templates/route.ts`: pass `advicePrompt` through
  `toDTO`, `RawTemplate`, and the upsert `$set`.
- `apps/wise/src/components/log-book-detail.tsx`: load the document's template via the
  existing `useDocumentTemplate(document.labels?.category)` hook and pass
  `template?.advicePrompt` into `useDocumentAdvice`.
- `apps/wise/src/hooks/use-document-advice.ts`: accept an `advicePrompt?: string` (via hook
  arg or `generate(advicePrompt?)`), and include it in the advice request body
  (`{ advicePrompt }`) sent to the ADK endpoint.

### ADK (ain-adk-v0)
- `DocumentApiController.handleGenerateAdviceStream`: read `advicePrompt?: string` from the
  request body and pass it to the service.
- `DocumentAdviceService.generateAdviceStream(documentId, options?, signal?)`: add
  `options?: { advicePrompt?: string }`; compute
  `const systemPrompt = options?.advicePrompt?.trim() || (await documentAdvicePrompt(this.memoryModule));`
  (everything else unchanged). The global default prompt remains the fallback.

## Error handling
- Empty/missing `advicePrompt` → global default (no error).
- Template fetch failure on the WISE side → advice still generates with the default
  (pass `undefined`).

## Testing / verification
- ADK: extend the advice service test — when `options.advicePrompt` is given, the model is
  invoked with that system prompt; when absent, the default is used. `yarn build`.
- intent-admin: tsc + build; manual — edit a template's advice prompt, save, reload → persists.
- WISE: tsc + build; manual — generate advice on a log book whose template has a custom
  prompt → advice reflects it; clearing the template prompt → falls back to default.

## Out of scope
- Per-document-instance prompts.
- Snapshotting the prompt onto the document (Approach B).
- A prompt-preview/test UI in the editor.
