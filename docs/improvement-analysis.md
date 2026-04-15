# AIN-ADK 개선 분석 보고서

## 개요

A2A 기반 멀티 에이전트 시스템(Client Orchestrator + Data Query Agent)에서 발생하는 3가지 핵심 문제를 분석하고 개선 방안을 제시합니다.

| # | 증상 | 근본 원인 분류 |
|---|------|---------------|
| 1 | Client에서 A2A intent 인식 후 실제 A2A call 미발생 | 프롬프트 + 구조적 문제 |
| 2 | Data Agent가 정상 반환했지만 Client에서 데이터 손상 (테이블 숫자 누락) | Aggregation 프롬프트 + 데이터 파이프라인 |
| 3 | Data Agent에서 intent 매핑 후 SQL tool call 미발생 | 프롬프트 + tool_choice 설정 |

---

## 문제 1: A2A Intent 인식 후 실제 Call 미발생

### 원인 분석

#### 1-A. A2A Tool의 빈약한 스키마 정보

**파일:** `src/modules/a2a/a2a.module.ts:82-98`

A2A 도구는 LLM에 다음과 같은 최소한의 정보만 제공합니다:

```typescript
{
  toolName: card.name.replaceAll(" ", "-"),  // 에이전트 이름 (하이픈 치환)
  description: card.description,             // 에이전트의 일반 설명만
  inputSchema: {
    type: "object",
    properties: {
      thinking_text: {                       // 파라미터가 이것 하나뿐
        type: "string",
        description: prompt                  // 범용적인 tool-select 프롬프트
      }
    },
    required: ["thinking_text"]
  }
}
```

반면 MCP 도구는 원래의 `inputSchema` properties를 그대로 유지하면서 `thinking_text`를 추가 파라미터로 넣기 때문에 LLM이 훨씬 구체적인 맥락을 가집니다.

**문제:** LLM은 A2A 도구에 대해 "이 도구가 정확히 뭘 할 수 있는지"에 대한 구체적 정보가 부족하여 도구 호출을 결정하지 못할 수 있습니다.

#### 1-B. tool_choice가 "auto"로 설정됨

LLM API 호출 시 `tool_choice` 파라미터가 명시적으로 설정되지 않아 기본값인 `"auto"`가 사용됩니다. 이는 LLM이 자체 판단으로 도구를 호출하지 않을 자유를 줍니다.

**파일:** `src/modules/models/base.model.ts:86-90` — `fetchStreamWithContextMessage`에 tool_choice 관련 파라미터가 없음

#### ~~1-C. A2A Tool 호출 후 제거 (splice)~~ — 의도된 설계

**파일:** `src/services/intents/fulfill.service.ts:167-175`

이 동작은 의도된 설계입니다. Intent 단위로 tools 배열이 새로 구성되며, splice는 해당 intent 내에서 동일 A2A tool의 무한루프를 방지하기 위한 것입니다. 실제로 무한루프가 발생하는 케이스가 있어서 도입된 안전장치입니다.

#### 1-D. A2A 호출 시 LLM의 reasoning이 무시됨

**파일:** `src/services/intents/fulfill.service.ts:205-208`

```typescript
const a2aStream = this.a2aModule.useTool(
    selectedTool,
    query,           // ← 원본 사용자 쿼리 전달
    thread.threadId,
);
```

LLM이 `thinking_text` 인자로 전달한 추론 내용이 무시되고, 원본 `query`가 그대로 A2A 에이전트에 전달됩니다. Multi-intent 모드에서 subquery가 아닌 전체 query가 전달되면 하위 에이전트가 적절한 처리를 하지 못할 수 있습니다.

#### 1-E. Fallback Handler에 의한 우회

**파일:** `src/services/intents/fulfill.service.ts:254-262`

```typescript
if (!intent && this.onIntentFallback) {
    const fallbackStream = this.onIntentFallback({ triggeredIntent, thread });
    if (fallbackStream !== undefined) {
        return fallbackStream;  // tool 실행 완전히 우회
    }
}
```

Intent 매칭이 실패하면(`intent === undefined`) fallback handler가 도구 실행을 완전히 우회합니다. Trigger 프롬프트에서 LLM이 `intentName`을 null로 반환하면 이 경로를 타게 됩니다.

### 개선 방안

#### [1-A 해결] A2A Tool의 스키마 강화

```typescript
// src/modules/a2a/a2a.module.ts getTools() 내부
const tool: ConnectorTool = {
    toolName: card.name.replaceAll(" ", "-"),
    connectorName: name,
    protocol: CONNECTOR_PROTOCOL_TYPE.A2A,
    // 개선: description에 skills 정보 포함
    description: this.buildEnrichedDescription(card),
    inputSchema: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "하위 에이전트에 전달할 구체적인 질문 또는 요청",
            },
            thinking_text: {
                type: "string",
                description: prompt,
            },
        },
        required: ["query", "thinking_text"],
    },
};
```

AgentCard의 `skills` 정보를 활용하여 description을 보강합니다:

```typescript
private buildEnrichedDescription(card: AgentCard): string {
    let desc = card.description;
    if (card.skills?.length) {
        desc += "\n\nCapabilities:\n";
        desc += card.skills
            .map(s => `- ${s.name}: ${s.description}`)
            .join("\n");
    }
    return desc;
}
```

#### [1-B 해결] tool_choice 제어 옵션 추가

`ModelFetchOptions`에 tool_choice를 추가하여, intent가 매칭되었을 때 LLM이 반드시 도구를 호출하도록 유도합니다:

```typescript
// src/modules/models/base.model.ts
export type ModelFetchOptions = {
    reasoning?: "none" | "minimal" | "low" | "medium" | "high";
    verbosity?: "low" | "medium" | "high";
    toolChoice?: "auto" | "required" | { name: string };  // 추가
};
```

Intent가 매칭된 경우 첫 번째 inference loop에서 `tool_choice: "required"`를 사용하면 LLM이 반드시 도구를 한 번은 호출하게 됩니다.

#### [1-D 해결] A2A 호출 시 subquery/reasoning 전달

```typescript
// fulfill.service.ts A2A tool call 부분
const a2aQuery = toolArgs.query || query;  // LLM이 지정한 query 우선 사용
const a2aStream = this.a2aModule.useTool(
    selectedTool,
    a2aQuery,
    thread.threadId,
);
```

---

## 문제 2: 데이터 반환 후 Client에서 정리 실패 (테이블 숫자 누락)

### 원인 분석

#### 2-A. Aggregation 프롬프트의 데이터 보존 지시 부재

**파일:** `src/services/prompts/aggregate.ts:4-15`

```
You are an assistant that combines multiple task responses into a single, coherent response.

Guidelines:
- Preserve all important information from each response
- Create a natural, flowing response that addresses the original query
- Don't use section headers like "[Task 1]" - integrate smoothly
- If responses have related information, synthesize them logically
- Keep the tone consistent with the original responses
- Be concise - don't add unnecessary filler
```

**핵심 문제점:**
- "Preserve all important information"은 모호함 — LLM이 "핵심만" 남기고 숫자를 요약/반올림할 수 있음
- "Be concise"는 테이블 데이터 축약을 유발
- "Synthesize them logically"는 테이블 구조 파괴를 유발
- 수치 데이터 정확성 보존에 대한 지시가 전혀 없음

#### 2-B. Non-text Part 미처리 (file, data parts)

**파일:** `src/modules/a2a/a2a.module.ts:196-200`

```typescript
} else if (typedEvent.status.state === "completed") {
    // TODO: handle 'file', 'data' parts  ← 미구현
    const texts = typedEvent.status.message?.parts
        .filter((part) => part.kind === "text")
        .map((part: TextPart) => part.text)
        .join("\n");
```

하위 에이전트가 `data` 또는 `file` part로 구조화된 데이터(JSON 테이블, CSV 등)를 반환할 경우 완전히 무시됩니다.

#### 2-C. Aggregation 시 토큰 제한 미관리

**파일:** `src/services/intents/aggregate.service.ts:102-118`

```typescript
private buildAggregateQuery(originalQuery, results) {
    const resultsText = results
        .map((r, i) => `[Task ${i + 1}] ${r.subquery}\n[Response ${i + 1}] ${r.response}`)
        .join("\n\n---\n\n");

    return `Original Query: ${originalQuery}\n\nAll task results:\n${resultsText}\n\n...`;
}
```

여러 하위 에이전트의 응답(큰 테이블 데이터 포함)을 단순 연결하여 LLM에 전달합니다. 결합된 텍스트가 LLM의 context window나 output token 한도를 초과하면 응답이 잘리면서 데이터가 손실됩니다.

#### 2-D. Fulfill 프롬프트의 A2A 결과 처리 지시

**파일:** `src/services/prompts/fulfill.ts:40-44`

```
<A2A_Tool>
   Results from A2A_Tool are text generated after thorough consideration by the requested Agent,
   and are complete outputs that cannot be further developed.
   There is no need to supplement the content with the same question or use new tools.
</A2A_Tool>
```

A2A 결과를 "완성된 출력"으로 취급하라고 지시하지만, 최종 응답 생성 시 원본 데이터를 그대로 포함하라는 명시적 지시가 없습니다. LLM이 A2A 결과를 "참고하여" 새로운 요약을 생성할 수 있습니다.

### 개선 방안

#### [2-A 해결] Aggregation 프롬프트 강화

```typescript
// src/services/prompts/aggregate.ts
const aggregatePrompt = `You are an assistant that combines multiple task responses into a single, coherent response.

Guidelines:
- **데이터 정확성 최우선**: 숫자, 통계, 테이블의 값은 원본 그대로 유지할 것. 반올림, 요약, 근사치 사용 금지.
- **테이블 구조 보존**: 원본 응답에 테이블이 있으면 해당 테이블을 그대로 포함할 것. 테이블을 서술형으로 변환하지 말 것.
- 여러 응답의 정보를 자연스럽게 통합하되, 데이터 값은 절대 변경하지 않을 것
- "[Task 1]" 같은 섹션 헤더는 사용하지 말고 자연스럽게 통합
- 원본 쿼리의 언어와 동일한 언어로 응답
- 데이터가 포함된 경우 간결한 요약보다는 정확한 데이터 전달을 우선할 것`;
```

#### [2-B 해결] Non-text Parts 처리 구현

```typescript
// src/modules/a2a/a2a.module.ts completed 상태 처리
} else if (typedEvent.status.state === "completed") {
    const parts = typedEvent.status.message?.parts ?? [];
    const textContent: string[] = [];

    for (const part of parts) {
        if (part.kind === "text") {
            textContent.push((part as TextPart).text);
        } else if (part.kind === "data") {
            // 구조화된 데이터를 읽기 좋은 텍스트로 변환
            textContent.push(JSON.stringify(part.data, null, 2));
        } else if (part.kind === "file") {
            // 파일 데이터 처리 (필요시)
            textContent.push(`[File: ${part.mimeType}]`);
        }
    }

    const texts = textContent.join("\n");
    // ...
}
```

#### [2-C 해결] Aggregation 입력 크기 관리

Aggregation 전에 전체 입력 크기를 체크하고, 토큰 한도에 근접하면 경고하거나 분할 처리합니다:

```typescript
// src/services/intents/aggregate.service.ts
private buildAggregateQuery(originalQuery: string, results: FulfillmentResult[]): string {
    const resultsText = results
        .map((r, i) => `[Task ${i + 1}] ${r.subquery}\n[Response ${i + 1}] ${r.response}`)
        .join("\n\n---\n\n");

    // 간이 토큰 추정 (1 토큰 ≈ 4자)
    const estimatedTokens = Math.ceil(resultsText.length / 4);
    if (estimatedTokens > 30000) {
        loggers.intent.warn(`Aggregate input is very large: ~${estimatedTokens} tokens`);
    }

    return `Original Query: ${originalQuery}
...
중요: 아래 데이터에 포함된 숫자, 테이블, 통계값은 반드시 원본 그대로 유지하세요.

All task results:
${resultsText}

Please provide a unified response that addresses the original query.`;
}
```

#### [2-D 해결] Fulfill 프롬프트에 데이터 보존 지시 추가

```
<A2A_Tool>
   A2A_Tool은 다른 Agent에게 질의를 보내고 답변을 받는 도구입니다.
   A2A_Tool의 결과는 완성된 출력이므로 추가 보완이 필요 없습니다.
   **결과에 포함된 테이블, 숫자, 데이터는 반드시 원본 그대로 최종 응답에 포함하세요.**
   데이터를 요약하거나 반올림하지 마세요.
</A2A_Tool>
```

---

## 문제 3: Data Agent에서 Intent 매핑 후 SQL Tool Call 미발생

### 원인 분석

#### 3-A. Fulfill 프롬프트의 모호한 도구 사용 지시

**파일:** `src/services/prompts/fulfill.ts:21-22`

```
Don't try to answer the user's question directly.
First break down the user's request into smaller concepts and think about the kinds of tools and queries you need to grasp each concept.
```

"Don't try to answer directly"는 도구 사용을 촉진하는 의도이지만, 프롬프트의 다른 부분과 결합하면 LLM이 혼란을 느낄 수 있습니다. 특히 `intent.prompt`가 추가되면 지시가 충돌할 수 있습니다.

#### 3-B. Intent의 커스텀 프롬프트 충돌 가능성

**파일:** `src/services/prompts/fulfill.ts:46-48`

```typescript
${agentPrompt}

${intent?.prompt || ""}
```

Intent에 설정된 커스텀 프롬프트가 기본 fulfill 프롬프트의 도구 사용 지시를 무의식적으로 덮어쓸 수 있습니다. 예를 들어 intent.prompt에 "주어진 데이터를 분석하여..."와 같은 지시가 있으면 LLM이 도구 호출 없이 바로 응답하려 할 수 있습니다.

#### 3-C. LLM의 tool_choice "auto" 기본값

위 1-B와 동일한 이슈. tool_choice가 "auto"이므로 LLM이 자체 판단으로 도구 호출을 건너뛸 수 있습니다.

#### 3-D. JSON.parse 에러 핸들링 부재

**파일:** `src/services/intents/fulfill.service.ts:183`

```typescript
const toolArgs = JSON.parse(toolCall.function.arguments);
```

LLM이 잘못된 JSON을 생성하면 여기서 unhandled exception이 발생하여 전체 inference loop가 중단됩니다. 에러 로그도 남지 않아 디버깅이 어렵습니다.

#### 3-E. "Tool not found" 시 silent continue

**파일:** `src/services/intents/fulfill.service.ts:178-180`

```typescript
if (!selectedTool) {
    // it cannot be happened...
    continue;
}
```

LLM이 도구 이름을 약간 다르게 생성하면(예: underscore vs hyphen) 도구를 찾지 못하고 조용히 넘어갑니다.

### 개선 방안

#### [3-A 해결] Fulfill 프롬프트 명확화

```typescript
// src/services/prompts/fulfill.ts 개선
return `
Today is ${new Date().toLocaleDateString()}.
You are a highly sophisticated automated agent that answers user queries by utilizing tools.

IMPORTANT RULES:
1. You MUST use available tools to fulfill the user's request. Do NOT generate answers from your own knowledge.
2. If the user asks for data, you MUST call the appropriate data retrieval tool.
3. Call tools repeatedly until you have all the information needed.
4. Only after gathering all necessary data via tools should you compose your final response.
5. The final response must faithfully reproduce all data obtained from tools.

...
`;
```

#### [3-B 해결] Intent 프롬프트 가이드라인 문서화 + 검증

Intent 프롬프트 작성 시 도구 사용 지시를 무효화하지 않도록 가이드라인을 제공하고, 자동 검증을 추가합니다:

```typescript
// 프롬프트 충돌 감지 (선택적)
if (intent?.prompt) {
    const directAnswerPatterns = ["직접 답변", "분석하여 답변", "data를 기반으로"];
    const hasConflict = directAnswerPatterns.some(p => intent.prompt?.includes(p));
    if (hasConflict) {
        loggers.intent.warn("Intent prompt may conflict with tool-use directive", {
            intentName: intent.name
        });
    }
}
```

#### [3-C 해결] 첫 호출 시 tool_choice: "required" 적용

Intent가 매칭된 상태에서는 최소 한 번은 도구를 호출하도록 강제합니다:

```typescript
// fulfill.service.ts intentFulfilling()
let isFirstCall = true;

while (true) {
    const functions = modelInstance.convertToolsToFunctions(tools);
    const options = {
        ...modelOptions,
        toolChoice: isFirstCall && tools.length > 0 ? "required" : "auto",
    };
    const responseStream = await modelInstance.fetchStreamWithContextMessage(
        messages, functions, options,
    );
    isFirstCall = false;
    // ...
}
```

#### [3-D 해결] JSON.parse 에러 핸들링 추가

```typescript
// fulfill.service.ts tool call 처리 부분
let toolArgs: Record<string, unknown>;
try {
    toolArgs = JSON.parse(toolCall.function.arguments);
} catch (parseError) {
    loggers.intent.error("Failed to parse tool arguments", {
        toolName,
        rawArgs: toolCall.function.arguments,
        error: parseError,
    });
    // LLM에게 에러 피드백을 주어 재시도 유도
    modelInstance.appendMessages(
        messages,
        `[Error] Failed to parse arguments for tool "${toolName}": Invalid JSON. Please retry with valid JSON arguments.`,
    );
    continue;
}
```

#### [3-E 해결] Fuzzy Tool Name Matching + 로깅 강화

```typescript
if (!selectedTool) {
    loggers.intent.warn("Tool not found", {
        requestedName: toolName,
        availableTools: tools.map(t => t.toolName),
    });
    // Fuzzy matching 시도
    selectedTool = tools.find(t =>
        t.toolName.toLowerCase().replace(/-/g, "_") ===
        toolName.toLowerCase().replace(/-/g, "_")
    );
    if (!selectedTool) {
        modelInstance.appendMessages(
            messages,
            `[Error] Tool "${toolName}" not found. Available tools: ${tools.map(t => t.toolName).join(", ")}`,
        );
        continue;
    }
}
```

---

## 추가 발견: 개선이 필요한 구조적 이슈

### 4. 에러 핸들링 전반적 부재

| 위치 | 문제 | 영향 |
|------|------|------|
| `a2a.module.ts:101-103` | A2A 연결 실패 시 silent catch | 도구 목록에서 조용히 누락, 디버깅 불가 |
| `a2a.module.ts:188-189` | `parts[0]` 접근 시 null check 없음 | 빈 parts 배열이면 crash |
| `fulfill.service.ts:183` | JSON.parse uncaught | 전체 스트림 중단 |
| `single-trigger.service.ts`, `multi-trigger.service.ts` | JSON 파싱 실패 시 fallback | 의도 없이 쿼리 그대로 처리됨 |

**개선:** 각 지점에 적절한 에러 핸들링과 로깅을 추가해야 합니다.

### 5. Observability (관찰 가능성) 부족

현재 디버그 레벨 로깅만 존재하여 프로덕션에서 문제 추적이 어렵습니다.

**개선 방안:**
- Intent trigger 결과 (매칭된/미매칭 intent) INFO 레벨 로깅
- Tool call 시도/성공/실패 INFO 레벨 로깅
- A2A 통신 요청/응답 요약 INFO 레벨 로깅
- Aggregation 입력/출력 크기 INFO 레벨 로깅

```typescript
// 예시: fulfill.service.ts tool call 후
loggers.intent.info("Tool call completed", {
    toolName,
    protocol: selectedTool.protocol,
    resultLength: toolResult.length,
    threadId: thread.threadId,
});
```

### 6. max_tokens 미설정

`ModelFetchOptions`에 `max_tokens` 또는 `max_output_tokens` 설정이 없습니다. 이로 인해:
- LLM 기본값에 의존하여 응답이 예기치 않게 잘릴 수 있음
- 특히 긴 테이블 데이터를 포함한 응답에서 중간에 잘리는 현상 발생 가능

**개선:**
```typescript
export type ModelFetchOptions = {
    reasoning?: "none" | "minimal" | "low" | "medium" | "high";
    verbosity?: "low" | "medium" | "high";
    toolChoice?: "auto" | "required" | { name: string };
    maxOutputTokens?: number;  // 추가
};
```

---

## 개선 우선순위

### Phase 1: 즉시 적용 (프롬프트 변경만으로 해결 가능)

| 항목 | 관련 문제 | 난이도 | 기대 효과 |
|------|----------|--------|----------|
| Fulfill 프롬프트 명확화 | #1, #3 | 낮음 | 도구 미호출 감소 |
| Aggregation 프롬프트 데이터 보존 지시 추가 | #2 | 낮음 | 숫자/테이블 손상 감소 |
| A2A Tool 결과 보존 지시 추가 | #2 | 낮음 | 데이터 정확성 향상 |

### Phase 2: 코드 변경 (안정성 향상)

| 항목 | 관련 문제 | 난이도 | 기대 효과 |
|------|----------|--------|----------|
| JSON.parse 에러 핸들링 | #3 | 낮음 | silent crash 방지 |
| Tool not found 로깅 강화 | #1, #3 | 낮음 | 디버깅 효율 향상 |
| A2A 호출 시 subquery 전달 | #1 | 중간 | 하위 에이전트 정확도 향상 |
| Non-text parts 처리 구현 | #2 | 중간 | 구조화된 데이터 보존 |

### Phase 3: 구조적 개선

| 항목 | 관련 문제 | 난이도 | 기대 효과 |
|------|----------|--------|----------|
| tool_choice 제어 옵션 추가 | #1, #3 | 중간 | 도구 호출 보장 |
| A2A Tool 스키마 강화 (skills 포함) | #1 | 중간 | LLM 판단력 향상 |
| max_tokens 옵션 추가 | #2 | 중간 | 응답 잘림 방지 |
| Aggregation 입력 크기 관리 | #2 | 높음 | 대용량 데이터 안정성 |
| Observability 강화 | 전체 | 중간 | 운영 안정성 |

---

## 요약

세 가지 문제의 공통된 근본 원인:

1. **프롬프트의 모호성**: LLM에게 "도구를 사용할 수도 있다"가 아닌 "반드시 도구를 사용해야 한다"로 명확히 지시해야 합니다.
2. **데이터 보존 지시 부재**: Aggregation과 최종 응답 생성 시 수치/테이블 데이터의 정확한 보존을 명시적으로 요구해야 합니다.
3. **Silent failure**: 에러가 발생해도 조용히 넘어가는 지점이 많아 문제 추적이 어렵습니다. 에러 핸들링과 로깅을 강화해야 합니다.
4. **A2A 파이프라인의 정보 손실**: 도구 스키마 빈약, 쿼리 전달 부정확, non-text parts 미처리 등 A2A 통신 파이프라인 전반에 걸친 개선이 필요합니다.
