import {
	buildSourceCountNotice,
	parseClaimedRowCount,
} from "@/services/workflow-table/source-count";

describe("parseClaimedRowCount", () => {
	it("reads the count an agent states in prose", () => {
		expect(
			parseClaimedRowCount(["브랜드스토어 판매내역은 총 381건 조회되었습니다."]),
		).toBe(381);
	});

	it("handles thousands separators", () => {
		expect(parseClaimedRowCount(["총 1,234 건이 조회되었습니다."])).toBe(1234);
	});

	it("reads through markdown emphasis, wherever the agent puts it", () => {
		// 실제로 관측된 두 형태 — 같은 모델이 실행마다 강조 위치를 바꾼다.
		expect(
			parseClaimedRowCount(["브랜드스토어 판매내역은 총 **347건** 조회되었습니다."]),
		).toBe(347);
		expect(
			parseClaimedRowCount(["브랜드스토어 판매내역은 **총 347건** 조회되었습니다."]),
		).toBe(347);
		expect(parseClaimedRowCount(["총 **347** 건"])).toBe(347);
		expect(parseClaimedRowCount(["`총 347건`"])).toBe(347);
	});

	it("sums across results and across periods within one result", () => {
		expect(
			parseClaimedRowCount([
				"대상일1: 총 381건 조회\n대상일2: 총 283건 조회",
				"총 10건 조회되었습니다.",
			]),
		).toBe(674);
	});

	it("returns undefined when no result states a count", () => {
		expect(parseClaimedRowCount(["조회 결과가 없습니다.", ""])).toBeUndefined();
		expect(parseClaimedRowCount([])).toBeUndefined();
	});

	it("ignores counts that are not row counts", () => {
		// "총액" 같은 다른 단위는 `건`이 아니므로 잡히지 않는다.
		expect(parseClaimedRowCount(["총 매출 199,580,509원"])).toBeUndefined();
	});
});

describe("buildSourceCountNotice", () => {
	it("states both counts when the source held more", () => {
		expect(buildSourceCountNotice(381, 30)).toBe("총 381건 중 30건 표시");
	});

	it("groups thousands", () => {
		expect(buildSourceCountNotice(1234, 200)).toBe("총 1,234건 중 200건 표시");
	});

	it("still states the counts when the table is complete", () => {
		// 완전한 표도 "완전하다"고 말해야 한다 — 문구가 없는 것과
		// 문구를 본 적이 없는 것을 독자가 구분할 수 없기 때문이다.
		expect(buildSourceCountNotice(283, 283)).toBe("총 283건 중 283건 표시");
	});

	it("says the query found nothing when the source claimed nothing", () => {
		// recordCount 0 인 조회는 에이전트가 행을 한 줄도 쓰지 않으므로 표도 0행이 된다.
		expect(buildSourceCountNotice(0, 0)).toBe("조회된 데이터가 없습니다");
	});

	it("says the same when the agent wrote a sentence instead of a count", () => {
		// "조회된 데이터가 없습니다" 처럼 건수를 안 적은 경우 — 파서는 undefined 를 준다.
		expect(buildSourceCountNotice(undefined, 0)).toBe("조회된 데이터가 없습니다");
	});

	it("does not call a lost table empty", () => {
		// 소스가 건수를 주장했는데 0행이면 잃어버린 것이다. "없다"고 하면 거짓말이 된다.
		expect(buildSourceCountNotice(347, 0)).toBe("총 347건 중 0건 표시");
	});

	it("stays silent when the claim is smaller than what was rendered", () => {
		// 주장 건수가 더 작으면 파싱이 틀렸을 가능성이 크다 — 숫자를 지어내지 않는다.
		expect(buildSourceCountNotice(5, 30)).toBeUndefined();
	});

	it("stays silent when no count was found and the table has rows", () => {
		expect(buildSourceCountNotice(undefined, 30)).toBeUndefined();
	});
});
