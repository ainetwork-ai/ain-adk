# AIN-ADK 코드 품질 점검: KISS / YAGNI / DRY

작성일: 2026-05-12
대상 브랜치: `feature/seonghwa/multi-modal-chat`
점검 범위: `src/` 전체 (94 TypeScript 파일)

## 종합 평가

전반적으로 모듈 경계와 DI 구조는 깔끔하지만, intent / workflow 도메인의 서비스 계층과 컨테이너 계층에 **반복 패턴**과 **거대 함수**가 누적되어 있습니다. 우선순위가 높은 항목부터 정리합니다.

---

## 🔴 우선순위 높음

### 1. ✅ `IntentFulfillService.intentFulfill`: 거대 함수 + 3중 분기 중복 (KISS + DRY) — **완료 (2026-05-12)**

**원본 상태**: [src/services/intents/fulfill.service.ts](src/services/intents/fulfill.service.ts) 183-453줄(약 270줄)의 단일 메서드 안에 3개 분기(`single intent` / `multi intent without aggregation` / `multi intent with aggregation`)가 거의 동일한 "스트림 이벤트 루프"를 반복.

**적용된 변경**
- `FinalStreamState` 타입 도입 — `finalMessageId`, `finalResponseText`, `collectionName`, `finalMessageStarted`를 mutable 객체로 묶어 분기 메서드 간 공유.
- 공통 스트림 소비 헬퍼 2종 추출:
  - `consumeFinalStream(stream, state)` — 사용자에게 스트리밍되는 최종 응답용. text/collection 누적 + `emitFinalResponseEvent` 호출.
  - `consumeIntermediateStream(stream, state)` — 중간 결과 수집용. `thinking_process`만 pass-through하고 텍스트는 return으로 반환.
- 클로저였던 `emitFinalResponseEvent`를 private 메서드로 승격, state 객체를 통해 `finalMessageStarted` 추적.
- 분기를 3개의 private 메서드로 분리: `fulfillSingleIntent`, `fulfillSequential`, `fulfillWithAggregation`.
- 메인 `intentFulfill`은 라우팅 + PII 마스킹 + 메시지 저장 + 종료 이벤트만 담당.
- 부수 정리: 항목 #8(`response` deprecated fallback)도 함께 제거 — `fulfillWithAggregation` 내부에서는 항상 `responseMessage`가 채워지므로 가드만 유지.

**결과**
- `intentFulfill` 메서드 길이: 약 270줄 → 약 90줄
- 파일 전체: 467줄 → 454줄 (헬퍼 추가에도 불구하고 소폭 감소)
- `tests/services/intents/fulfill.service.test.ts` 5/5 통과, 전체 21 suites / 97 tests 모두 통과.

---

### 2. ✅ Single/Multi Intent Trigger: 보일러플레이트 중복 (DRY) — **완료 (2026-05-12)**

**원본 상태**: `single-trigger.service.ts`(109줄)와 `multi-trigger.service.ts`(126줄)의 흐름(생성자 / fallback / 직렬화 / 메시지 빌드 / 모델 호출 / JSON 파싱)이 거의 동일했고, 라우터 `trigger.service.ts`(50줄)가 환경 변수에 따라 둘 사이를 선택하는 구조였습니다. 실 차이는 **프롬프트 / 메시지 템플릿 / 응답 파싱 스키마**뿐이었습니다.

**적용된 변경** ([src/services/intents/trigger.service.ts](src/services/intents/trigger.service.ts))
- 라우터 + 두 서브 클래스(`SingleIntentTriggerService`, `MultiIntentTriggerService`)를 `IntentTriggerService` 한 클래스로 통합.
- 모드별 차이만 `TriggerStrategy` 인터페이스에 캡슐화:
  - `buildSystemPrompt(memory, intentList)`
  - `buildTriggerMessage(threadMessages, query)`
  - `parseResponse(content, query) → TriggerOutcome | null`
  - `logIntentResult: boolean` (multi 모드만 결과 로그를 남기던 기존 동작 보존)
- `singleStrategy` / `multiStrategy` 두 const 객체로 구현, 환경변수 `DISABLE_MULTI_INTENTS`로 선택.
- 공통 흐름(intent 메모리 가드, intent 목록 직렬화, 모델 호출, intent 이름 → Intent 매핑, 빈 결과 fallback)은 `intentTriggering` 메서드 본체로 단일화.
- 메시지 템플릿의 history preamble 부분도 `buildHistoryPreamble` 헬퍼로 추출.
- `src/services/intents/single-trigger.service.ts`, `src/services/intents/multi-trigger.service.ts` **두 파일 삭제**.

**결과**
- 라인 수: 50 + 109 + 126 = **285줄 → 216줄** (약 69줄 감소, 파일 2개 삭제)
- 외부 공개 API(`IntentTriggerService` 클래스 + `intentTriggering` 메서드) 변경 없음.
- 신규 모드를 추가할 때 새 `TriggerStrategy` 객체만 작성하면 됨.

**회귀 가드 테스트 추가** ([tests/services/intents/trigger.service.test.ts](tests/services/intents/trigger.service.test.ts))
- 리팩토링 이전에는 trigger 서비스 단위 테스트가 없었으므로 동작 동등성을 보장하기 위해 13건의 테스트를 신규로 추가:
  - 공통 fallback 4건: intent 메모리 없음 / intent 목록 비어 있음 / 빈 응답 / JSON 파싱 실패
  - 단일 모드 3건: subquery=원본 query / intentName 매핑 / 단일 프롬프트 템플릿
  - 멀티 모드 4건: 전체 매핑 / 빈 subquery 필터링 / 응답 필드 누락 시 기본값 / 멀티 프롬프트 템플릿
  - history preamble 2건: thread 메시지 포함 여부
- 전체 22 suites / 110 tests 모두 통과.

---

### 3. Model 호출 준비 패턴 반복 (DRY)

`getModel()` → `getModelOptions()` → `generateMessages({...})`까지의 준비 과정과 모델 호출(`fetch` 또는 `fetchStreamWithContextMessage`) 패턴이 최소 4곳에서 반복됩니다.

- [src/services/query.service.ts:94-104](src/services/query.service.ts#L94-L104) (`generateTitle`)
- [src/services/intents/aggregate.service.ts:86-110](src/services/intents/aggregate.service.ts#L86-L110)
- [src/services/intents/single-trigger.service.ts:39-85](src/services/intents/single-trigger.service.ts#L39-L85)
- [src/services/intents/multi-trigger.service.ts:38-86](src/services/intents/multi-trigger.service.ts#L38-L86)

**개선 제안**: `ModelModule`(또는 별도 helper)에 비스트리밍 호출용 `runOnce({ query, input, systemPrompt, options? })`와 스트리밍 호출용 얇은 헬퍼를 추가하면 호출부의 보일러플레이트를 줄일 수 있습니다.

---

## 🟡 우선순위 중간

### 4. `Container`: 21개의 동일한 lazy-singleton 게터 (KISS)

[src/container/index.ts](src/container/index.ts)(299줄)는 21개의 private 필드와 21개의 게터가 같은 패턴을 반복합니다.

```ts
if (!this._xxx) {
  this._xxx = new Xxx(...);
}
return this._xxx;
```

[container/index.ts:64-267](src/container/index.ts#L64-L267) 전체가 사실상 한 패턴이며, [container/index.ts:272-295](src/container/index.ts#L272-L295)의 `reset()`도 필드를 새로 추가할 때마다 잊지 않고 같이 갱신해야 하는 위험 지점입니다.

**개선 제안**:

```ts
private instances = new Map<string, unknown>();
private memoize<T>(key: string, factory: () => T): T {
  let v = this.instances.get(key) as T | undefined;
  if (!v) { v = factory(); this.instances.set(key, v); }
  return v;
}

// 사용:
getQueryService() {
  return this.memoize("queryService", () => new QueryService(...));
}

reset() { this.instances.clear(); }
```

21개 게터의 가독성은 유지하면서 `reset()`이 자동으로 모든 인스턴스를 비웁니다.

---

### 5. `QueryService.handleQuery`: 너무 많은 책임 (KISS)

[src/services/query.service.ts:146-311](src/services/query.service.ts#L146-L311) — 약 165줄에 다음 책임이 섞여 있습니다.

1. PII REJECT/MASK 분기 + reject 응답 4개 이벤트 emit ([174-222](src/services/query.service.ts#L174-L222))
2. Thread 로드/생성 + thread_id 이벤트 ([224-254](src/services/query.service.ts#L224-L254))
3. Intent triggering + 사용자 메시지 저장 ([261-293](src/services/query.service.ts#L261-L293))
4. Fulfill 스트림 위임 ([295-310](src/services/query.service.ts#L295-L310))

특히 [query.service.ts:179-218](src/services/query.service.ts#L179-L218)의 PII reject 분기는 **40줄짜리 인라인 이벤트 시퀀스**로, 별도 메서드(`*emitPIIRejection()`)로 빼면 본 흐름이 훨씬 명확해집니다.

또한 reject 메시지가 한국어로 **하드코딩**되어 있습니다 ("개인정보 내역은 처리할 수 없습니다."). 라이브러리 코드로는 부적절하므로 옵션화 또는 i18n 처리가 필요합니다.

---

### 6. `workflow-variable-resolver.service.ts`: 728줄 단일 파일 (KISS)

[src/services/workflow-variable-resolver.service.ts](src/services/workflow-variable-resolver.service.ts)는 변수 토큰 정규화, 날짜 파싱, 부분 포맷 추론 등 다수의 책임이 한 파일에 모여 있습니다. [44-99](src/services/workflow-variable-resolver.service.ts#L44-L99)의 `normalizePartSpecs`만 봐도 union 타입 분기, 빈 문자열 처리, 다중 fallback 토큰 추출 등을 모두 처리합니다.

**개선 제안**: 파일 분할
- `workflow-variable-parser.ts` (토큰/parts 정규화)
- `workflow-date-resolver.ts` (날짜 파싱/포맷 추론)
- `workflow-variable-resolver.service.ts` (orchestration만)

---

### 7. PII MASK 분기의 산재 (DRY 약함, KISS)

[query.service.ts:119-127](src/services/query.service.ts#L119-L127), [query.service.ts:220-222](src/services/query.service.ts#L220-L222), [fulfill.service.ts:406-408](src/services/intents/fulfill.service.ts#L406-L408)에서 동일한 `getMode() === MASK` 가드 + `filterText` 호출 패턴이 흩어져 있습니다.

**개선 제안**: `PIIService`에 `maskIfNeeded(text: string)` 메서드를 추가해 가드를 한 곳에 캡슐화.

---

## 🟢 우선순위 낮음

### 8. `AggregateService.serializeFulfillmentResult`의 레거시 분기 (YAGNI 의심) — **부분 처리됨**

[aggregate.service.ts:16-27](src/services/intents/aggregate.service.ts#L16-L27)에서 `result.responseMessage`가 없을 때 `"legacy-..."` messageId로 fallback 메시지를 만듭니다.

`FulfillmentResult`는 [fulfill.service.ts](src/services/intents/fulfill.service.ts)의 `fulfillWithAggregation`에서 항상 `responseMessage`와 함께 생성되므로 이 fallback 경로는 실제로 도달하지 않을 가능성이 큽니다.

> **부분 처리 (2026-05-12)**: #1 작업 중 `fulfill.service.ts` 내부의 동일 패턴 fallback은 제거했습니다. 남은 `aggregate.service.ts`의 fallback과 `FulfillmentResult.response`(@deprecated) 필드 자체의 제거는 후속 작업 필요.

### 9. JSDoc 과잉 (KISS, 선택사항)

[fulfill.service.ts:80-95](src/services/intents/fulfill.service.ts#L80-L95), [fulfill.service.ts:168-182](src/services/intents/fulfill.service.ts#L168-L182) 등 메서드 이름과 시그니처로 자명한 설명을 길게 적어둔 JSDoc이 다수 있습니다. 현재 코드 스타일이 "짧은 public API 설명"을 선호하는 쪽이라면 유지해도 되지만, 내부 private 메서드 중심의 장황한 JSDoc은 정리 여지가 있습니다.

---

## 권장 작업 순서

| # | 상태 | 작업 | 영향 | 난이도 |
|---|------|------|------|--------|
| 1 | ✅ 완료 (2026-05-12) | `IntentFulfillService.intentFulfill` 분기 분해 + 공통 스트림 루프 추출 | 매우 큼 | 중 |
| 2 | ✅ 완료 (2026-05-12) | Single/Multi Intent Trigger 공통 베이스 추출 (서브 클래스 2개 제거, strategy 패턴 도입) | 큼 | 낮음 |
| 3 |  | `Container`를 `memoize(key, factory)` 패턴으로 단순화 | 중간 (유지보수성) | 낮음 |
| 4 |  | `QueryService.handleQuery`에서 PII reject / thread 생성 분리 | 중간 | 낮음 |
| 5 |  | Model 호출 준비 패턴을 `ModelModule` 헬퍼로 통합 | 중간 | 낮음 |
| 6 |  | `workflow-variable-resolver` 파일 분할 | 중간 (가독성) | 중 |
| 7 |  | PII MASK 가드 → `maskIfNeeded()` 캡슐화 | 작음 | 낮음 |
| 8 | 🟡 부분 | `serializeFulfillmentResult`의 legacy fallback 사용처 확인 후 제거 (fulfill.service 측은 정리됨, aggregate.service 측 남음) | 작음 | 낮음 |

특히 **#1과 #2를 먼저 적용**하면 intent 도메인의 코드량이 약 200줄 이상 줄고, 새 트리거 모드나 fulfill 시나리오를 추가할 때의 부담이 크게 줄어듭니다.
