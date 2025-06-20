# AI Network Agent Development Kit

AI Network Agent Development Kit은 자연어를 First-Order Logic(FOL)으로 변환하고 관리하는 시스템을 포함한 AI 에이전트 개발 키트입니다.

## 주요 기능

### FOL (First-Order Logic) 시스템

자연어 텍스트를 First-Order Logic 형식으로 변환하고 저장, 쿼리할 수 있는 시스템입니다.

#### 주요 구성 요소

- **FOLClient**: 자연어 ↔ FOL 변환 및 쿼리 인터페이스
- **FOLStore**: Facts 저장소 (Local, MongoDB, PostgreSQL 지원)
- **Facts**: Constants, Predicates, Facts로 구성된 FOL 데이터 구조

#### FOL 데이터 구조

```typescript
interface Facts {
  constants: { name: string; description: string }[]; // 상수들과 설명
  predicates: { name: string; description: string }[]; // 술어들과 설명
  facts: { name: string; description: string }[]; // 사실들과 설명
}
```

#### JSON 파일 구조

- **constants.json**: `{name: description}` 형태
- **predicates.json**: `{name: description}` 형태
- **facts.json**: `{name: description}` 형태
- **intent.json**: `{intent: facts[]}` 형태

#### 지원하는 Store 타입

- **FOLLocalStore**: 로컬 파일 시스템 기반 저장소
- **FOLMongoStore**: MongoDB 기반 저장소
- **FOLPostgreSqlStore**: PostgreSQL 기반 저장소

### 파일 구조

FOL 데이터는 다음과 같은 구조로 저장됩니다:

```
fol-store/
├── constants.json    # {name: description} 형태의 상수들
├── predicates.json   # {name: description} 형태의 술어들
├── facts.json        # {name: description} 형태의 사실들
└── intent.json       # {intent: facts[]} 형태의 매핑
```

## API 참조

### FOLClient 메소드

- `updateFacts(intent: string, text: string)`: 자연어를 FOL로 변환하여 저장
- `retrieveFacts(intent: string)`: 특정 intent의 Facts 조회
- `getFactsList()`: 모든 Facts 목록 조회
- `getFactsMap()`: Intent별 Facts 맵 조회
- `queryFacts(intent: string, query: string)`: FOL 기반 쿼리 실행

### FOLStore 인터페이스

- `saveFacts(intent: string, facts: Facts)`: Facts 저장
- `retrieveFacts(intent: string)`: Facts 조회
- `getAllFacts()`: 모든 Facts 조회

### 기타 모듈

- **Models**: OpenAI, Azure OpenAI 등 AI 모델 인터페이스
- **Intent**: 의도 분석 시스템
- **MCP**: Model Context Protocol 지원
- **A2A**: Agent-to-Agent 통신
- **Auth**: 인증 시스템
