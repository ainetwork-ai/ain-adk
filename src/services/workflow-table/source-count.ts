/**
 * Reads the row count an agent claims in its own task result.
 *
 * A task result is prose written by a model: it states how many rows the query
 * returned ("총 381건 조회되었습니다") and then lists some of them. When it
 * lists fewer than it claims, nothing downstream can tell — the rendered table
 * looks complete and its total row reads as a grand total. Comparing the
 * claimed count against the rendered row count is the only signal available
 * without changing how agents answer.
 *
 * Deliberately conservative: an unparsed result yields `undefined` and the
 * caller stays silent. Showing a wrong count is worse than showing none.
 */

/** `총 381건`, `총 1,234 건`, `총 12건이 조회되었습니다` … */
const CLAIMED_COUNT = /총\s*([\d,]+)\s*건/g;

/**
 * Markdown emphasis around the count. Agents bold it, but not consistently:
 * one run writes `**총 347건**`, the next `총 **347건**`, so a pattern anchored
 * on `총` immediately followed by digits misses half the time. Stripping the
 * markers first makes both read the same.
 */
const EMPHASIS = /[*_`]/g;

/**
 * Sums the counts each source result claims. Returns undefined when no result
 * states one.
 *
 * Multiple matches inside a single result (e.g. a task covering two periods)
 * are summed, matching how the caller concatenates rows from every source.
 */
export function parseClaimedRowCount(texts: string[]): number | undefined {
	let total = 0;
	let found = false;

	for (const text of texts) {
		if (!text) {
			continue;
		}
		for (const match of text.replace(EMPHASIS, "").matchAll(CLAIMED_COUNT)) {
			const parsed = Number.parseInt((match[1] ?? "").replace(/,/g, ""), 10);
			if (Number.isFinite(parsed)) {
				total += parsed;
				found = true;
			}
		}
	}

	return found ? total : undefined;
}

/**
 * The notice line placed above a table, stating what the source held and what
 * is shown. Printed even when the two agree — a reader should be able to tell
 * "this table is complete" from the table itself, not from the absence of a
 * line they may never have seen.
 *
 * An empty table is the case a reader most needs explained, because "the query
 * found nothing" and "the rows went missing on the way here" look identical.
 * The two are told apart by the claimed count: a source that claims rows and
 * renders none lost them, and says so; one that claims none (or says nothing,
 * having written a sentence like "조회된 데이터가 없습니다" instead of a count)
 * simply had nothing to show.
 *
 * Silent only when the count is smaller than what was rendered — that means
 * the parse, not the table, is wrong, and a wrong number is worse than none.
 */
export function buildSourceCountNotice(
	sourceCount: number | undefined,
	renderedCount: number,
): string | undefined {
	if (renderedCount === 0 && (sourceCount === undefined || sourceCount === 0)) {
		return "조회된 데이터가 없습니다";
	}

	if (sourceCount === undefined || sourceCount < renderedCount) {
		return undefined;
	}

	return `총 ${sourceCount.toLocaleString("en-US")}건 중 ${renderedCount.toLocaleString("en-US")}건 표시`;
}
