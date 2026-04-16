# ADK Multi-Modal / Artifact Support Plan

## Overview

This document captures the recommended direction for evolving AIN-ADK from a text-only chat model into a multi-modal, artifact-aware architecture.

Primary goals:

- Support chat inputs beyond plain text
- Allow uploaded files to participate in thread/message context
- Allow agent responses to include downloadable artifacts
- Clean up core types so future modalities can be added without more structural rewrites
- Keep storage responsibilities separated between conversation memory and artifact binaries

## Progress Snapshot

Last updated: `2026-04-16`

Completed groundwork so far:

- added `ArtifactObject`, `ArtifactRef`, and related artifact type scaffolding
- added `IArtifactStore` abstraction and `ArtifactModule`
- wired optional `artifactModule` into the SDK module registry and `AINAgent`
- exported artifact module types from the public module surface
- added structured query input types for multipart request normalization
- added initial query input validation and normalization utilities
- added legacy `message: string` to structured-input adapter logic at the query controller boundary
- added structured error code support for request validation failures
- updated README to mention the optional artifact layer
- added initial tests for artifact module wiring
- added tests for query input normalization and controller-level query input adaptation
- moved repository tests into the top-level `tests/` directory so they are not emitted in build artifacts
- updated Jest and TypeScript config so test files and Jest globals are recognized correctly
- introduced canonical multipart message part types alongside legacy message compatibility
- added shared message normalization and intent-serialization utilities
- updated new thread message writes to use canonical multipart messages
- updated intent-trigger history serialization to use shared canonical helpers
- added tests for legacy-to-canonical message normalization and multipart serialization
- updated non-stream `/query` responses to include a canonical `message` payload alongside compatibility `content`
- updated query/fulfillment service boundaries to return the final canonical model message
- added text-content extraction helpers so compatibility response text can be derived from canonical message parts
- updated controller tests and README examples for the structured `/query` response shape
- added canonical streaming message events: `message_start`, `part_delta`, and `message_complete`
- kept `text_chunk` during the transition as a compatibility stream event for existing consumers
- updated A2A consumption to fall back to canonical `message_complete` when compatibility text chunks are absent
- added tests covering canonical stream event emission and A2A compatibility fallback
- extended fulfillment results with canonical `responseMessage` payloads while preserving compatibility text
- updated aggregation prompt construction to use shared canonical message serialization
- updated multi-intent intermediate fulfillment context to reuse canonical model messages
- added tests covering canonical fulfillment results, aggregation serialization, and stream compatibility
- added canonical tool/thought message part creation helpers
- updated fulfillment tool execution to emit `tool_start` and `tool_output` stream events
- kept provider-facing tool result fallback through existing `appendMessages(..., toolResult)` behavior
- added MCP and A2A tool execution tests covering canonical tool events and compatibility behavior
- added an optional structured `input` bridge to `BaseModel.generateMessages`
- added model input message helpers for text and structured query input
- updated internal model calls to pass both compatibility `query` text and canonical `input` messages
- added tests covering structured model input propagation without changing provider-facing fallback behavior
- added an optional structured append bridge to `BaseModel.appendMessages`
- added a canonical `TOOL` message helper for tool-call/tool-result append payloads
- updated fulfillment tool result append calls to pass both compatibility text and canonical `TOOL` messages
- added MCP and A2A tests covering structured append payloads while preserving string fallback behavior
- added provider-facing model fallback serializers for multipart messages and threads
- updated structured query normalization to reuse shared model fallback serialization rules
- added tests covering artifact, data, tool, and thread fallback serialization
- added artifact metadata and download API skeletons
- added ownership checks for artifact metadata and download access
- added tests covering artifact service access control and download controller behavior

Not completed yet:

- full multipart `MessageObject` migration across all runtime paths
- full query/request/response contract refactor across streaming and provider-facing paths
- artifact upload/download runtime APIs
- stream event redesign
- A2A artifact reference support
- workflow boundary refactor
- migration adapters for old message records

---

## Current State Summary

The current implementation is effectively text-only, even though some types are loosely structured.

### Text-only assumptions in the current code

- `/query` and `/query/stream` now accept legacy `message` and structured `input.parts`, but inference still normalizes both into a text-first runtime path
- non-stream `/query` now returns a canonical `message` object plus compatibility `content`
- `/query/stream` now emits canonical message lifecycle events, but still duplicates text through compatibility `text_chunk`
- `QueryService` still processes `query: string` for inference, even though it can now receive structured input for persistence
- some runtime paths still assume `query: string`, but new message writes now converge on canonical `parts[]` messages
- thread history is still flattened into strings for intent triggering, but now through a shared multipart-aware serializer
- stream output is centered on `text_chunk`
- A2A paths read and write only text parts
- server middleware only handles JSON and URL-encoded input, not multipart uploads

### Important impacted files

- [src/controllers/query.controller.ts](/Users/shyun/comcom/ain-agent/ain-adk/src/controllers/query.controller.ts)
- [src/services/query.service.ts](/Users/shyun/comcom/ain-agent/ain-adk/src/services/query.service.ts)
- [src/types/memory.ts](/Users/shyun/comcom/ain-agent/ain-adk/src/types/memory.ts)
- [src/types/stream.ts](/Users/shyun/comcom/ain-agent/ain-adk/src/types/stream.ts)
- [src/modules/models/base.model.ts](/Users/shyun/comcom/ain-agent/ain-adk/src/modules/models/base.model.ts)
- [src/services/intents/single-trigger.service.ts](/Users/shyun/comcom/ain-agent/ain-adk/src/services/intents/single-trigger.service.ts)
- [src/services/intents/multi-trigger.service.ts](/Users/shyun/comcom/ain-agent/ain-adk/src/services/intents/multi-trigger.service.ts)
- [src/services/intents/fulfill.service.ts](/Users/shyun/comcom/ain-agent/ain-adk/src/services/intents/fulfill.service.ts)
- [src/services/a2a.service.ts](/Users/shyun/comcom/ain-agent/ain-adk/src/services/a2a.service.ts)
- [src/modules/a2a/a2a.module.ts](/Users/shyun/comcom/ain-agent/ain-adk/src/modules/a2a/a2a.module.ts)
- [src/index.ts](/Users/shyun/comcom/ain-agent/ain-adk/src/index.ts)

---

## Design Principles

- Treat text as one modality among many, not as the core special case
- Represent every message as multipart content
- Store artifact metadata in thread/message history, not raw binaries
- Keep artifact binary storage separate from memory storage
- Make storage pluggable because this is an SDK, not a fixed application
- Use adapters during migration, but move internal core types to the new model early
- Keep authorization and lifecycle rules explicit, because files introduce new security and retention concerns
- Prefer explicit request/response validation over unchecked type assertions
- Keep public SDK composition and documentation aligned with actual runtime behavior

---

## Target Architecture

## 1. Message and Thread Model

Move from:

```ts
content: {
  type: string
  parts: any[]
}
```

To a multipart-first model:

```ts
type ContentPart =
  | { kind: "text"; text: string }
  | {
      kind: "file";
      artifactId: string;
      name: string;
      mimeType: string;
      size: number;
      downloadUrl?: string;
      previewText?: string;
    }
  | { kind: "data"; mimeType: string; data: unknown }
  | { kind: "tool-call"; toolCallId: string; toolName: string; args: unknown }
  | { kind: "tool-result"; toolCallId: string; toolName: string; result: unknown }
  | { kind: "thought"; title: string; description?: string };

type MessageObject = {
  messageId: string;
  role: "USER" | "SYSTEM" | "MODEL" | "TOOL";
  parts: ContentPart[];
  timestamp: number;
  metadata?: Record<string, unknown>;
};
```

Recommended changes:

- Replace `content` wrapper with `parts[]` directly on `MessageObject`
- Add `TOOL` role if tool-originated messages should be explicit
- Preserve `ThreadObject` shape, but modernize its message structure
- Allow thread-level metadata for multimodal and indexing hints
- Introduce a message schema versioning strategy so old and new records can coexist during migration

Suggested versioning direction:

```ts
type MessageObject = {
  messageId: string;
  schemaVersion: 2;
  role: "USER" | "SYSTEM" | "MODEL" | "TOOL";
  parts: ContentPart[];
  timestamp: number;
  metadata?: Record<string, unknown>;
};
```

Migration note:

- old records may be read through an adapter
- new writes should converge on a single canonical schema as early as possible

Completed groundwork in this phase:

- added canonical multipart `MessageContentPart` types
- preserved backward-compatible legacy message reads via a union `MessageObject`
- added shared helpers for:
  - canonical message creation
  - legacy-to-canonical normalization
  - thread/message serialization for intent prompts
- updated current `QueryService`, `QueryController`, and fulfillment flows to write new text messages in canonical form
- replaced direct `content.parts.join(" ")` logic in trigger services with shared serialization utilities

## 2. Artifact Model

Artifacts should be first-class objects, but separate from thread memory.

Suggested types:

```ts
type ArtifactObject = {
  artifactId: string;
  userId?: string;
  threadId?: string;
  messageId?: string;
  status: "uploaded" | "processing" | "ready" | "failed";
  name: string;
  mimeType: string;
  size: number;
  checksum?: string;
  storageKey: string;
  previewText?: string;
  previewStatus?: "pending" | "ready" | "failed";
  metadata?: Record<string, unknown>;
  createdAt: number;
};
```

Message parts should reference artifacts through `artifactId` plus metadata useful to the client and model.

Recommended modeling note:

- keep `ArtifactObject` as the canonical artifact record
- store only a compact `ArtifactRef` in message parts
- avoid embedding full artifact records directly in every message to reduce duplication and drift

## 3. Storage Split

Do not store artifact binaries inside the memory layer.

Recommended split:

- `MemoryModule`
  - threads
  - messages
  - intents
  - workflows
  - artifact references and metadata linkage
- `ArtifactStore` or `ArtifactModule`
  - binary file storage
  - download/open access
  - generated preview text
  - content hashing
  - store-specific lifecycle concerns

Minimal artifact store interface:

```ts
interface IArtifactStore {
  put(input: ArtifactPutInput): Promise<ArtifactObject>;
  get(artifactId: string): Promise<ArtifactObject | undefined>;
  delete(artifactId: string): Promise<void>;
  openDownload(artifactId: string): Promise<ArtifactDownloadResult>;
}
```

MVP note:

- Start with one pluggable store implementation at a time
- Do not build multi-store routing in the first pass

### Storage Optionality

Artifact storage should be optional at the SDK level.

Recommended behavior:

- If artifact storage is configured:
  - enable uploaded file handling
  - enable downloadable artifact outputs
  - enable persistent artifact references in threads
- If artifact storage is not configured:
  - allow only inline-safe content such as text and small structured `data` parts
  - disable file upload and downloadable artifact generation
  - return a clear error when a file-based artifact flow is requested

This gives the SDK a graceful degraded mode instead of forcing every deployment to provision object storage from day one.

### Storage Provider Mapping

The storage abstraction should support multiple backend implementations.

Likely implementations:

- `LocalArtifactStore`
  - useful for local development and simple deployments
- `S3ArtifactStore`
  - for AWS and S3-compatible object storage
- `AzureBlobArtifactStore`
  - Azure equivalent for object storage use cases

Azure mapping notes:

- the S3-like service on Azure is typically `Azure Blob Storage`
- `bucket`-style concepts map to `storage account + blob container`
- presigned URL behavior maps to `SAS URL`

This means the artifact-store abstraction should avoid S3-specific assumptions in naming or URL generation behavior.

### Module Integration in AIN-ADK

The current SDK is module-driven, so the plan should explicitly include artifact wiring at the same layer as existing modules.

Recommended direction:

- introduce an optional `ArtifactModule`
- expose it from `src/modules/index.ts`
- add it to `AgentModules` in `src/config/modules.ts`
- register it through `setModules(...)`
- inject it into services through the container
- add artifact routes/controllers/services alongside existing API modules

This matters because the work is not only a type redesign. It also changes the public SDK composition surface used when creating `AINAgent`.

### Public Export Surface

This change will also affect package exports and developer ergonomics.

Recommended additions:

- export artifact-related modules and types from the public SDK surface
- document the new constructor/module composition pattern
- include migration examples for text-only users upgrading to multimodal-ready agent setup

---

## API Direction

## 1. Query Input

Move from string-only input:

```json
{
  "message": "hello"
}
```

Toward multipart input:

```json
{
  "input": {
    "parts": [
      { "kind": "text", "text": "Summarize this file" },
      {
        "kind": "file",
        "artifactId": "art_123",
        "name": "report.pdf",
        "mimeType": "application/pdf",
        "size": 102400
      }
    ]
  }
}
```

Migration recommendation:

- Temporarily keep legacy `message: string`
- Convert legacy input into `parts: [{ kind: "text", text: message }]`

### Request Validation

The current codebase relies heavily on unchecked request casting. This plan should include a validation layer.

Recommended direction:

- validate query input shape before controller-to-service handoff
- validate message parts by kind
- validate artifact references before inference
- validate upload metadata such as mime type and size

This becomes especially important once multipart and artifact-bearing requests are accepted.

## 2. Query Output

Move away from returning only:

```json
{
  "content": "...",
  "threadId": "..."
}
```

Toward returning structured output:

```json
{
  "threadId": "...",
  "message": {
    "messageId": "...",
    "role": "MODEL",
    "parts": [
      { "kind": "text", "text": "Done" },
      {
        "kind": "file",
        "artifactId": "art_456",
        "name": "summary.csv",
        "mimeType": "text/csv",
        "size": 2048,
        "downloadUrl": "/api/artifacts/art_456/download"
      }
    ]
  }
}
```

## 3. Artifact APIs

Recommended new endpoints:

- `POST /api/artifacts`
- `GET /api/artifacts/:id`
- `GET /api/artifacts/:id/download`
- optional `DELETE /api/artifacts/:id`

Upload handling note:

- Introduce multipart parsing only where needed
- Prefer separating file upload from `/query` itself
- Let `/query` reference uploaded artifacts by ID

### Authentication and Download Strategy

Artifact download behavior should be explicit in the plan.

Recommended options:

- authenticated proxy download through ADK routes
- signed URL generation by the artifact store

Default recommendation:

- use authenticated proxy downloads as the simplest secure baseline
- allow stores such as S3 or Azure Blob to return signed URLs where appropriate

The selected strategy should be consistent with the existing auth middleware and user ownership checks.

### Error Contract

Because artifact flows introduce more failure modes, error responses should become more structured.

Recommended direction:

- preserve a simple `message` field for compatibility
- add optional stable error codes such as:
  - `ARTIFACT_STORE_NOT_CONFIGURED`
  - `ARTIFACT_NOT_FOUND`
  - `ARTIFACT_ACCESS_DENIED`
  - `ARTIFACT_TOO_LARGE`
  - `ARTIFACT_TYPE_NOT_ALLOWED`
- ensure upload, download, and query validation errors are distinguishable

---

## Stream Event Redesign

The current stream event model is too text-centric.

Recommended future event set:

- `thread_id`
- `message_start`
- `part_delta`
- `artifact_ready`
- `tool_call`
- `tool_result`
- `thinking_process`
- `message_complete`
- `error`

Example direction:

```ts
type StreamEvent =
  | { event: "thread_id"; data: ThreadMetadata }
  | { event: "message_start"; data: { messageId: string; role: MessageRole } }
  | { event: "part_delta"; data: { kind: "text"; delta: string } }
  | { event: "artifact_ready"; data: ArtifactRef }
  | { event: "tool_call"; data: ToolCallPayload }
  | { event: "tool_result"; data: ToolResultPayload }
  | { event: "thinking_process"; data: { title: string; description: string } }
  | { event: "message_complete"; data: { messageId: string } }
  | { event: "error"; data: { message: string } };
```

This keeps streaming extensible for both text and downloadable outputs.

Additional recommendation:

- include artifact status transitions in either stream events or artifact metadata polling
- support delayed readiness for files that require preview extraction or post-processing

---

## Model Layer Redesign

The model abstraction is currently string-first.

Current pressure points:

- `generateMessages({ query: string, thread })`
- `appendMessages(messages, message: string)`

Recommended direction:

```ts
abstract generateMessages(params: {
  input: MessageObject;
  thread?: ThreadObject;
  systemPrompt?: string;
}): MessageType[];

abstract appendMessages(messages: MessageType[], message: MessageObject): void;
```

Provider behavior guidance:

- If a provider supports file/image/data natively, map parts directly
- If not, degrade unsupported parts into text summaries or `previewText`
- Keep provider-specific conversion logic inside model implementations, not in services

This is one of the highest-impact breaking changes in the plan.

Migration note:

- the provider interface change should be coordinated with upgrade notes and examples
- existing provider implementations will need a clear fallback path for unsupported parts

---

## Intent / Aggregation / Context Serialization

Current trigger and aggregation logic stringifies message history too aggressively.

Recommended change:

- Introduce a shared serializer for model context generation
- Text parts are included as-is
- File parts use `previewText` when available
- If no preview exists, serialize metadata such as filename, mime type, and size
- Data parts can be summarized or truncated depending on size

Suggested shared utility responsibilities:

- `serializeMessageForIntent`
- `serializeThreadForIntent`
- `serializePartForModelFallback`

This utility should be used by:

- single intent triggering
- multi intent triggering
- fulfill flow
- aggregate flow
- optional PII filtering layers

Additional recommendation:

- preview extraction should be a distinct step from serialization
- serializers should consume normalized artifact metadata and preview text, not raw binary content

### Workflow Compatibility Stance

Workflow support should remain text-first for now, but the design should not block a future multimodal workflow model.

Short-term recommendation:

- keep workflow execution input as text-only
- keep workflow templates and variable resolution centered on string substitution
- avoid expanding workflow APIs to multipart in the first milestone

Long-term design guidance:

- keep workflow execution service boundaries flexible enough to accept a future `MessageInput`
- avoid hardcoding string-only assumptions deeper than necessary
- document that workflow content may eventually evolve from `content: string` toward a structured input model

This keeps current scope under control while avoiding a dead-end design.

---

## Fulfillment and Tooling Changes

Tool and fulfillment flows should stop collapsing everything into plain text.

Required changes:

- Save model outputs as structured `parts[]`
- Let tool execution produce `tool-call` and `tool-result` parts where appropriate
- If a tool generates a file, save it as an artifact and emit a file part
- Preserve `thinking_process` separately from user-visible content

This affects:

- intent fulfillment
- aggregation of multi-step responses
- thread persistence of intermediate tool-generated content

Recommended follow-up:

- define whether generated artifacts are always attached to a model message or may also be attached to tool-originated messages
- define whether tool results should be normalized before persistence to avoid provider-specific payload leakage

---

## A2A Changes

The current A2A path is also text-first.

Target direction:

- agent card should advertise more than text-only capabilities where appropriate
- inbound A2A messages should parse multipart content
- outbound A2A responses should allow artifact references
- prefer artifact reference or downloadable URL exchange over raw binary transport

Important note:

- A2A binary transport can be more complex and less portable
- artifact reference exchange is the safer default for interoperability

Additional recommendation:

- define a canonical A2A-safe artifact reference payload shape early
- avoid depending on provider-local download URLs when cross-agent access control would break portability

---

## Artifact Processing Pipeline

The plan should explicitly include what happens between upload and usable model context.

Recommended pipeline:

1. upload artifact binary
2. create canonical `ArtifactObject`
3. persist message part with `ArtifactRef`
4. optionally extract preview text or metadata
5. mark artifact as `ready` or `failed`
6. make preview data available to serializers and model adapters

Notes:

- preview extraction may be synchronous for small text files and asynchronous for PDFs or large documents
- the artifact status model should support eventual readiness
- the SDK should avoid blocking the entire thread if preview extraction is delayed

---

## Security, Limits, and Governance

This area should be part of the plan from the start because artifacts introduce different operational risks than plain text.

Recommended considerations:

- allowed mime-type policy
- max file size per upload
- total artifact quota per user or thread
- optional malware scanning hook
- ownership checks on artifact metadata and download access
- safe handling of signed URL expiry
- log redaction for artifact metadata if file names are sensitive
- validation of cross-user artifact references before query execution

These do not all need to be implemented in the MVP, but the extension points should be designed up front.

---

## Lifecycle and Cleanup

The current plan should also define retention and deletion rules.

Recommended decisions to make before implementation:

- what happens to artifacts when a thread is deleted
- whether orphaned artifacts are immediately deleted or retained for a grace period
- whether generated artifacts and uploaded artifacts share the same retention policy
- whether cleanup is synchronous or delegated to background jobs

Suggested baseline:

- deleting a thread removes message-to-artifact linkage immediately
- actual binary deletion can be deferred through cleanup jobs
- artifacts referenced by multiple messages or workflows should not be deleted blindly

---

## Breaking Change Assessment

This is not a tiny extension. If core types are cleaned up properly, the impact is medium to high and should likely be treated as a major-version-level transition.

### Highest-risk breaking areas

- `BaseModel` interface
- message and thread schema
- query request and response contracts
- stream event schema
- memory provider implementations
- A2A text-only assumptions

### Lower-risk additive areas

- artifact upload/download endpoints
- new optional artifact metadata on messages
- introducing an artifact storage abstraction

### Recommended migration strategy

- Add new core types first
- introduce legacy adapters for text-only input
- allow dual-read of old and new message format if needed
- write new format internally as early as possible
- document provider and memory migration steps clearly
- publish an explicit SDK upgrade guide for module wiring changes

Versioning recommendation:

- because the package is currently `0.x`, a breaking release may still be semantically acceptable without a `1.x` major jump
- even so, this change should be treated internally as a major-scope migration and documented as such

Documentation recommendation:

- update README request and response examples alongside implementation
- ensure API names and route paths in docs match real routes
- publish a focused upgrade guide for SDK users implementing custom model or memory modules

---

## Execution Plan

### Sequencing Principles

The highest-risk parts of this migration are:

- changing core message and stream contracts
- changing the public SDK module surface
- changing model-provider interfaces

To reduce churn, implementation order should follow this rule:

1. freeze canonical data contracts first
2. add infrastructure and wiring second
3. migrate service internals next
4. update provider-facing and protocol-facing integrations after service internals stabilize

Additional recommendation:

- tests and docs should not wait until the very end
- each phase that changes a public contract should update examples and add focused coverage immediately

## Phase 0. Contract Freeze and ADR-Level Decisions

- finalize canonical `MessageObject`, `ContentPart`, `ArtifactObject`, and `ArtifactRef` shapes
- finalize stream event vocabulary
- finalize artifact lifecycle states and preview lifecycle states
- finalize error code vocabulary
- finalize the first-milestone workflow stance as text-only
- finalize whether query output returns both `message` and a compatibility `content`

This phase is intentionally small but important. It reduces rework in every later phase.

## Phase 1. Core Type Redesign and Compatibility Adapters

- redesign `MessageObject`
- redesign `ThreadObject` message storage contract
- add `ContentPart` union
- add artifact domain types
- redesign `FulfillmentResult`
- redesign `StreamEvent`
- introduce schema versioning and legacy-read adapters
- add normalization helpers for old text-only message records

Completed groundwork in this phase:

- `ArtifactObject` / `ArtifactRef` / related artifact types scaffolded

## Phase 2. Artifact Storage Abstraction

- define `IArtifactStore`
- define artifact module or equivalent integration point
- separate artifact metadata from binary storage
- decide whether linkage metadata lives in thread memory, artifact store, or both
- define artifact status lifecycle
- decide download strategy: proxy route vs signed URL

Completed groundwork in this phase:

- `IArtifactStore` scaffolded
- `ArtifactModule` scaffolded

## Phase 3. SDK Module Wiring

- add optional `ArtifactModule` to the public constructor surface
- update module registry and getters
- update DI container services and controllers
- define failure behavior when artifact functionality is requested but no artifact module is configured

Completed groundwork in this phase:

- optional `artifactModule` added to `AINAgent`
- module registry/getter wiring added
- public module exports updated

## Phase 4. Shared Serialization and Normalization Utilities

- add message and thread serializers for intent/model use
- add file fallback summary behavior
- normalize how old and new message records are transformed for inference
- define workflow-safe serializer boundaries so workflows can stay text-only for now
- keep serializers independent from provider-specific model logic

This phase should happen before broad service refactors so all later logic shares one canonical conversion path.

## Phase 5. Request Validation and Error Contract

- add request validation for multipart and artifact-bearing inputs
- add upload validation for size and mime type
- implement structured error code responses while preserving a compatibility `message`

Completed groundwork in this phase:

- query input validation added for legacy and structured request shapes
- structured error code support added to `AinHttpError` and error responses

## Phase 6. Query Contract Refactor and Internal Message Flow Migration

- add multipart input contract
- add structured output contract
- keep temporary legacy `message: string` adapter
- refactor controller and service boundaries to use structured messages
- update `QueryService` to accept structured input
- persist user messages as multipart messages
- persist model messages as multipart messages
- stop assuming final output is only a string

Completed groundwork in this phase:

- structured query input types added
- legacy `message` requests are normalized into structured input at the controller boundary
- structured `input.parts` requests are accepted and converted into the current text-based query flow
- non-stream `/query` responses now include a canonical `message` payload plus compatibility `content`
- `QueryService` and `IntentFulfillService` now return the final canonical model message for non-stream callers
- final text responses saved by the current fulfillment flow are now persisted and returned through a shared canonical text-message shape

## Phase 7. Stream Event Redesign

- introduce the new stream event shapes
- maintain compatibility where needed for text streaming clients
- add support for artifact readiness signaling

This phase should land before downstream consumers such as A2A are updated.

Completed groundwork in this phase:

- added `message_start`, `part_delta`, and `message_complete` stream events for canonical text-message progression
- updated current fulfillment flows to emit canonical stream events alongside compatibility `text_chunk`
- updated `QueryService` PII-rejection streaming path to emit canonical stream events
- updated A2A consumption to support canonical `message_complete` as a fallback completion signal
- added targeted tests for canonical stream event emission and A2A compatibility

## Phase 8. Intent and Fulfillment Refactor

- update trigger services to use serializer
- update fulfill flow to produce message parts
- update aggregate flow to aggregate structured outputs or summarized representations

Completed groundwork in this phase:

- extended `FulfillmentResult` with an optional canonical `responseMessage`
- kept `FulfillmentResult.response` as deprecated compatibility text during the migration
- added fulfillment result construction helpers that derive compatibility text from canonical messages
- updated multi-intent no-aggregation intermediate context to push canonical model messages with thinking metadata
- updated aggregation to serialize fulfillment `responseMessage` values through shared message serializers
- preserved legacy aggregation fallback behavior for callers that still provide only `response`
- added focused tests for canonical fulfillment stream completion, intermediate context, and aggregation serialization
- added shared helpers for canonical `tool-call`, `tool-result`, and `thought` parts
- updated MCP and A2A tool execution flows to emit canonical `tool_start` and `tool_output` stream events
- preserved existing `thinking_process` events as compatibility/UX progress signals
- preserved provider-facing string fallback by continuing to append tool results through `BaseModel.appendMessages`
- added focused tests for MCP and A2A tool event emission plus tool part helper construction

## Phase 9. Model Abstraction Migration

- change `BaseModel` interfaces
- update provider implementations
- define degradation strategy for unsupported modalities

Completed groundwork in this phase:

- introduced `ModelGenerateMessagesParams` as the named `BaseModel.generateMessages` parameter contract
- added optional `input?: CanonicalMessageObject` alongside the existing required `query: string`
- exported the new generate-message params type from the public module surface
- added shared helpers for creating canonical model input messages from text and structured query input
- updated title generation, PII, intent trigger, fulfillment, and aggregation model calls to include canonical `input`
- preserved the existing `query` fallback field so current provider implementations can keep using string-only input
- added focused tests for structured query propagation, fulfillment model input, aggregate model input, and model input helper construction
- introduced optional structured append input on `BaseModel.appendMessages` while preserving the required string fallback
- exported the structured append input type from the public module surface
- added a shared helper for constructing canonical `TOOL` messages from thought, tool-call, and tool-result parts
- updated MCP and A2A fulfillment tool append calls to pass canonical `TOOL` messages as opt-in provider input
- added focused tests for MCP and A2A structured append payloads plus canonical tool message helper construction
- added `serializePartForModelFallback`, `serializeMessageForModelFallback`, and `serializeThreadForModelFallback`
- kept intent serializers aligned by routing them through the same multipart fallback behavior
- updated structured query normalization to derive compatibility text through shared model fallback serializers
- added focused tests for artifact-without-preview, data, tool, and thread fallback serialization behavior

Why this comes after service refactors:

- by this point the canonical message model and serialization rules are already stable
- provider implementers can target a settled shape instead of a moving intermediate design

## Phase 10. Artifact API and Upload/Download Flow

- add artifact upload endpoint
- add artifact metadata endpoint
- add artifact download endpoint
- wire uploaded artifact references into query flow
- add auth and ownership checks for artifact access

Completed groundwork in this phase:

- added `ArtifactService` for artifact metadata lookup and download access
- added artifact ownership checks based on `artifact.userId`
- added `ArtifactApiController` handlers for metadata lookup and binary download
- added `/api/artifacts/:id` and `/api/artifacts/:id/download` route skeletons
- mounted artifact API routes only when an `ArtifactModule` is configured
- added focused tests for artifact service access control and artifact download response behavior

## Phase 11. A2A Expansion

- update A2A message parsing and sending
- update agent card capabilities and modes
- standardize artifact reference handling for A2A interoperability
- address existing A2A TODO and FIXME items while touching the protocol surface

## Phase 12. Workflow Boundary Review

- keep workflow APIs text-only in the first milestone
- review workflow service signatures for future structured input support
- document the future path from string workflows to multipart workflows without implementing it yet

## Phase 13. Migration and Compatibility Layer

- provide adapters for old text-only API usage
- support old message reading where necessary
- publish upgrade notes for provider and memory implementers

## Phase 14. Tests and Documentation Sweep

- text-only compatibility tests
- multipart message tests
- artifact upload/download tests
- thread retrieval with artifact references
- streaming artifact event tests
- A2A artifact reference tests
- authorization and ownership tests for artifact access
- delayed preview readiness tests
- cleanup and deletion behavior tests
- request validation tests
- README and route contract synchronization checks
- update README and examples

Completed groundwork in this phase:

- README updated with optional artifact layer/module references
- initial tests added for artifact module and SDK wiring
- query input normalization and controller adaptation tests added
- tests moved out of `src/` into `tests/` so package builds no longer include test files
- Jest and TypeScript test configuration updated for this repository

Important note:

- despite this dedicated final sweep, tests and documentation updates should also happen incrementally in earlier phases whenever a public contract changes

---

## MVP Recommendation

To reduce scope while still establishing the new foundation, the initial milestone should support:

- multipart `MessageObject`
- text plus uploaded file reference input
- artifact store abstraction
- optional artifact-store configuration
- optional preview extraction pipeline
- artifact metadata in thread/message history
- download-capable artifact responses
- stream support for `artifact_ready`
- A2A artifact references, not full raw binary transport
- authenticated artifact access baseline
- workflow remains text-only, with future structured-input compatibility considered in service boundaries

Defer for later:

- advanced multi-store routing
- native image reasoning across all providers
- large structured data ingestion beyond summarized fallback
- full binary-forwarding across A2A peers
- advanced malware scanning and enterprise governance policies
- true multipart workflow authoring and execution

---

## Recommendation Summary

This should be treated as a core architecture update, not a small feature patch.

Recommended implementation order:

1. contract freeze
2. core types and compatibility adapters
3. artifact storage abstraction
4. SDK module wiring
5. shared serialization utilities
6. request validation and error contract
7. structured query and internal message flow
8. stream event redesign
9. intent and fulfillment refactor
10. model abstraction changes
11. artifact APIs
12. A2A support
13. workflow boundary cleanup
14. migration cleanup
15. final test and documentation sweep

If followed in this order, the codebase will end up with a much cleaner multimodal foundation and future artifact-related features will no longer require cross-cutting rewrites.

### Final Storage Recommendation

- make artifact storage pluggable
- make artifact storage optional
- support degraded inline-only behavior when storage is absent
- target `Local`, `S3`, and `Azure Blob Storage` as the first practical backend shapes
