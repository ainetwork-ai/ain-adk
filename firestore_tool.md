# Firestore Tool 호출 가이드

## 데이터베이스 컬렉션 정보

### 컬렉션 구조 개요
우리 데이터베이스는 `snake_case` 네이밍 컨벤션을 사용합니다.

#### 주요 컬렉션
- **`intents`**: 인텐트 정보 저장
- **`intent_results`**: 인텐트 호출 정보 (유저 쿼리에 대해 어떤 인텐트가 트리거 되었는지 저장)
- **`messages`**: 메시지 정보 저장

### 컬렉션별 주요 필드 (예상 스키마)

#### intents 컬렉션
```json
{
  "id": "string",                    // 인텐트 고유 ID
  "name": "string",                  // 인텐트 이름 (예: "article_info_2025-06-13_blackrock-pours-dollar160m-into-ethlargest-inflow-since-february")
  "category": "string",              // 카테고리 (예: "article")
  "description": "string | null",    // 인텐트 설명
  "prompt": "string",                // 인텐트 프롬프트 (긴 텍스트)
  "context": "object",               // 컨텍스트 정보 (중첩 객체)
  "tools": "array",                  // 사용 가능한 도구 목록
  "created_at": "timestamp",         // 생성일시 (ISO 8601 형식)
  "updated_at": "timestamp",         // 수정일시 (ISO 8601 형식)
  "vector_store_id": "string"        // 벡터 저장소 ID
}
```

#### intent_results 컬렉션
```json
{
  "id": "string",                    // 결과 고유 ID (timestamp 기반)
  "intent_id": "string",             // 매칭된 인텐트 ID
  "intent_name": "string",           // 매칭된 인텐트 이름 (예: "article_recent")
  "is_matched": "boolean",           // 인텐트 매칭 성공 여부
  "query": "string",                 // 사용자 쿼리
  "score": "number"                  // 유사도 점수 (0-1 범위)
}
```

#### messages 컬렉션
```json
{
  "id": "string",                    // 메시지 고유 ID
  "agent_id": "string | null",       // 에이전트 ID (에이전트 메시지의 경우)
  "content": [                       // 메시지 내용 (배열 형태)
    {
      "text": {
        "value": "string",           // 메시지 텍스트
        "annotations": []            // 주석 정보
      },
      "type": "text"                 // 콘텐츠 타입
    }
  ],
  "created_at": "timestamp",         // 생성일시 (ISO 8601 형식)
  "deleted_at": "timestamp | null",  // 삭제일시
  "metadata": "object",              // 메타데이터 (구조는 가변적)
  "role": "user | assistant",        // 메시지 역할 (user: 사용자, assistant: 에이전트)
  "run_id": "string | null",         // 실행 ID
  "thread_id": "string",             // 스레드 ID (대화 세션 그룹핑)
  "updated_at": "timestamp"          // 수정일시
}
```

## 기본 스키마 구조

### 1. 쿼리 스키마
```json
{
  "collection": "string",        // 컬렉션 이름
  "filters": [                  // 필터 조건 배열
    {
      "field": "string",        // 필드 이름
      "operator": "string",     // 연산자
      "value": "any"           // 비교값
    }
  ],
  "orderBy": [                 // 정렬 조건 배열
    {
      "field": "string",        // 정렬할 필드
      "direction": "asc|desc"   // 정렬 방향
    }
  ],
  "limit": "number",           // 결과 개수 제한
  "offset": "number"           // 결과 시작 위치
}
```

### 2. 집계 스키마
```json
{
  "collection": "string",
  "aggregations": [
    {
      "type": "count|sum|avg|max|min",
      "field": "string"         // sum, avg, max, min의 경우 필수
    }
  ],
  "filters": [...],            // 집계 전 필터링
  "groupBy": ["string"]        // 그룹화할 필드들
}
```

## 필터 연산자

### 기본 비교 연산자
- `==` : 같음
- `!=` : 같지 않음
- `<` : 작음
- `<=` : 작거나 같음
- `>` : 큼
- `>=` : 크거나 같음

### 배열 연산자
- `array-contains` : 배열이 특정 값을 포함
- `array-contains-any` : 배열이 지정된 값 중 하나라도 포함
- `in` : 필드값이 지정된 배열의 값 중 하나와 일치
- `not-in` : 필드값이 지정된 배열의 값과 일치하지 않음

## 쿼리 작성 예제

### 기본 필터링
```json
{
  "collection": "intents",
  "filters": [
    {
      "field": "category",
      "operator": "==",
      "value": "article"
    },
    {
      "field": "created_at",
      "operator": ">=",
      "value": "2025-06-01T00:00:00Z"
    }
  ]
}
```

### 복합 필터링
```json
{
  "collection": "intent_results",
  "filters": [
    {
      "field": "score",
      "operator": ">=",
      "value": 0.8
    },
    {
      "field": "is_matched",
      "operator": "==",
      "value": true
    },
    {
      "field": "id",
      "operator": ">=",
      "value": "2025-07-01T00:00:00.000Z"
    }
  ],
  "orderBy": [
    {
      "field": "id",
      "direction": "desc"
    }
  ],
  "limit": 50
}
```

### 메시지 필터링
```json
{
  "collection": "messages",
  "filters": [
    {
      "field": "role",
      "operator": "==",
      "value": "user"
    },
    {
      "field": "created_at",
      "operator": ">=",
      "value": "2025-04-01T00:00:00Z"
    },
    {
      "field": "deleted_at",
      "operator": "==",
      "value": null
    }
  ],
  "orderBy": [
    {
      "field": "created_at",
      "direction": "desc"
    }
  ]
}
```

## 집계 쿼리 예제

### 인텐트 매칭 성능 분석
```json
{
  "collection": "intent_results",
  "filters": [
    {
      "field": "id",
      "operator": ">=",
      "value": "2025-07-01T00:00:00.000Z"
    }
  ],
  "aggregations": [
    {
      "type": "count"
    },
    {
      "type": "avg",
      "field": "score"
    }
  ]
}
```

### 인텐트별 매칭 통계
```json
{
  "collection": "intent_results",
  "filters": [
    {
      "field": "is_matched",
      "operator": "==",
      "value": true
    },
    {
      "field": "id",
      "operator": ">=",
      "value": "2025-07-01T00:00:00.000Z"
    }
  ],
  "groupBy": ["intent_name"],
  "aggregations": [
    {
      "type": "count"
    },
    {
      "type": "avg",
      "field": "score"
    }
  ]
}
```

### 매칭 성공률 분석
```json
{
  "collection": "intent_results",
  "filters": [
    {
      "field": "id",
      "operator": ">=",
      "value": "2025-06-01T00:00:00.000Z"
    }
  ],
  "groupBy": ["is_matched"],
  "aggregations": [
    {
      "type": "count"
    }
  ]
}
```

## 실제 사용 시나리오

### 1. 카테고리별 인텐트 분석
```json
{
  "collection": "intents",
  "filters": [
    {
      "field": "created_at",
      "operator": ">=",
      "value": "2025-06-01T00:00:00Z"
    }
  ],
  "groupBy": ["category"],
  "aggregations": [
    {
      "type": "count"
    }
  ]
}
```

### 2. 인텐트 매칭 성능 모니터링
```json
{
  "collection": "intent_results",
  "filters": [
    {
      "field": "id",
      "operator": ">=",
      "value": "2025-07-01T00:00:00.000Z"
    },
    {
      "field": "score",
      "operator": ">=",
      "value": 0.5
    }
  ],
  "groupBy": ["intent_name"],
  "aggregations": [
    {
      "type": "count"
    },
    {
      "type": "avg",
      "field": "score"
    }
  ]
}
```

### 3. 매칭 실패 분석
```json
{
  "collection": "intent_results",
  "filters": [
    {
      "field": "is_matched",
      "operator": "==",
      "value": false
    },
    {
      "field": "id",
      "operator": ">=",
      "value": "2025-07-01T00:00:00.000Z"
    }
  ],
  "orderBy": [
    {
      "field": "id",
      "direction": "desc"
    }
  ],
  "limit": 100
}
```

### 4. 낮은 점수 쿼리 분석
```json
{
  "collection": "intent_results",
  "filters": [
    {
      "field": "is_matched",
      "operator": "==",
      "value": true
    },
    {
      "field": "score",
      "operator": "<=",
      "value": 0.3
    }
  ],
  "orderBy": [
    {
      "field": "score",
      "direction": "asc"
    }
  ],
  "limit": 50
}
```

### 6. 스레드별 대화 흐름 분석
```json
{
  "collection": "messages",
  "filters": [
    {
      "field": "thread_id",
      "operator": "==",
      "value": "thread_r5WTAma1x91uWLbPcdMpBiyw"
    },
    {
      "field": "deleted_at",
      "operator": "==",
      "value": null
    }
  ],
  "orderBy": [
    {
      "field": "created_at",
      "direction": "asc"
    }
  ]
}
```

### 7. 에이전트별 응답 통계
```json
{
  "collection": "messages",
  "filters": [
    {
      "field": "role",
      "operator": "==",
      "value": "assistant"
    },
    {
      "field": "agent_id",
      "operator": "!=",
      "value": null
    },
    {
      "field": "created_at",
      "operator": ">=",
      "value": "2025-07-01T00:00:00Z"
    }
  ],
  "groupBy": ["agent_id"],
  "aggregations": [
    {
      "type": "count"
    }
  ]
}
```

### 8. 삭제된 메시지 분석
```json
{
  "collection": "messages",
  "filters": [
    {
      "field": "deleted_at",
      "operator": "!=",
      "value": null
    },
    {
      "field": "deleted_at",
      "operator": ">=",
      "value": "2025-07-01T00:00:00Z"
    }
  ],
  "groupBy": ["role"],
  "aggregations": [
    {
      "type": "count"
    }
  ]
}
```

### 9. 활성 스레드 목록
```json
{
  "collection": "messages",
  "filters": [
    {
      "field": "created_at",
      "operator": ">=",
      "value": "2025-07-08T00:00:00Z"
    },
    {
      "field": "deleted_at",
      "operator": "==",
      "value": null
    }
  ],
  "groupBy": ["thread_id"],
  "aggregations": [
    {
      "type": "count"
    }
  ]
}
```

### 10. 텍스트 길이별 메시지 분석
```json
{
  "collection": "messages",
  "filters": [
    {
      "field": "role",
      "operator": "==",
      "value": "user"
    },
    {
      "field": "created_at",
      "operator": ">=",
      "value": "2025-06-01T00:00:00Z"
    }
  ],
  "orderBy": [
    {
      "field": "created_at",
      "direction": "desc"
    }
  ],
  "limit": 100
}
```

## 성능 최적화 팁

### 1. 인덱스 활용
- 필터와 정렬에 사용되는 필드들에 대해 복합 인덱스 생성
- 자주 사용되는 쿼리 패턴을 위한 인덱스 미리 생성

### 2. 쿼리 최적화
- 가장 선택적인 필터를 먼저 적용
- 불필요한 필드 제외를 위한 projection 활용
- 적절한 limit 설정으로 과도한 데이터 로드 방지

### 3. 집계 최적화
- 사전 계산된 집계 데이터 활용 고려
- 큰 데이터셋의 경우 배치 처리 사용

## 주의사항

### 1. 제한사항
- 단일 쿼리에서 inequality 필터는 한 필드에만 적용 가능
- `array-contains`와 `in` 연산자는 함께 사용할 수 없음
- 복합 쿼리의 경우 인덱스 생성 필요

### 2. 데이터 타입
- 날짜는 ISO 8601 형식 문자열 또는 Timestamp 객체 사용
- 숫자는 정수 또는 부동소수점 타입 명시
- 배열 필터 시 요소 타입 일치 확인

### 3. 보안
- 클라이언트 측 쿼리의 경우 보안 규칙 적용
- 민감한 데이터에 대한 접근 제한 설정
- 쿼리 복잡도 제한으로 비용 관리

## 에러 처리

### 일반적인 에러
- `PERMISSION_DENIED`: 보안 규칙 위반
- `INVALID_ARGUMENT`: 잘못된 쿼리 구문
- `FAILED_PRECONDITION`: 인덱스 부족
- `RESOURCE_EXHAUSTED`: 할당량 초과

### 에러 대응 방안
```json
{
  "error_handling": {
    "retry_strategy": "exponential_backoff",
    "max_retries": 3,
    "timeout": 30000
  }
}
```