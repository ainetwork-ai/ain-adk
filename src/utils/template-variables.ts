/**
 * Template variable resolver for scheduled jobs.
 *
 * Resolves `{{...}}` patterns in strings to actual values at execution time.
 * Supports date-based variables with optional format and offset.
 *
 * Built-in variables:
 * - {{today}}, {{yesterday}}, {{tomorrow}}
 * - {{today+N}}, {{today-N}} (day offset)
 * - {{startOfWeek}}, {{endOfWeek}}
 * - {{startOfMonth}}, {{endOfMonth}}
 * - {{now}} (datetime)
 *
 * Format override: {{today|YYYY/MM/DD}}
 */

const TEMPLATE_PATTERN = /\{\{(.+?)\}\}/g;
const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
const DEFAULT_DATETIME_FORMAT = "YYYY-MM-DD HH:mm:ss";
const TIMEZONE_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

type DateParts = {
	year: number;
	month: number;
	day: number;
	hours: number;
	minutes: number;
	seconds: number;
};

function padTwo(n: number): string {
	return n.toString().padStart(2, "0");
}

function getFormatter(timezone: string): Intl.DateTimeFormat {
	const cached = TIMEZONE_FORMATTER_CACHE.get(timezone);
	if (cached) {
		return cached;
	}

	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});
	TIMEZONE_FORMATTER_CACHE.set(timezone, formatter);
	return formatter;
}

function createUtcDateFromParts(parts: DateParts): Date {
	return new Date(
		Date.UTC(
			parts.year,
			parts.month - 1,
			parts.day,
			parts.hours,
			parts.minutes,
			parts.seconds,
		),
	);
}

function formatDate(date: Date, format: string): string {
	const year = date.getUTCFullYear().toString();
	const month = padTwo(date.getUTCMonth() + 1);
	const day = padTwo(date.getUTCDate());
	const hours = padTwo(date.getUTCHours());
	const minutes = padTwo(date.getUTCMinutes());
	const seconds = padTwo(date.getUTCSeconds());

	return format
		.replace("YYYY", year)
		.replace("MM", month)
		.replace("DD", day)
		.replace("HH", hours)
		.replace("mm", minutes)
		.replace("ss", seconds);
}

function getDateInTimezone(timezone?: string): Date {
	if (!timezone) {
		const now = new Date();
		return createUtcDateFromParts({
			year: now.getFullYear(),
			month: now.getMonth() + 1,
			day: now.getDate(),
			hours: now.getHours(),
			minutes: now.getMinutes(),
			seconds: now.getSeconds(),
		});
	}

	const formatter = getFormatter(timezone);
	const parts = formatter.formatToParts(new Date());
	const values: Partial<DateParts> = {};
	for (const part of parts) {
		switch (part.type) {
			case "year":
				values.year = Number.parseInt(part.value, 10);
				break;
			case "month":
				values.month = Number.parseInt(part.value, 10);
				break;
			case "day":
				values.day = Number.parseInt(part.value, 10);
				break;
			case "hour":
				values.hours = Number.parseInt(part.value, 10);
				break;
			case "minute":
				values.minutes = Number.parseInt(part.value, 10);
				break;
			case "second":
				values.seconds = Number.parseInt(part.value, 10);
				break;
		}
	}

	return createUtcDateFromParts({
		year: values.year ?? 0,
		month: values.month ?? 1,
		day: values.day ?? 1,
		hours: values.hours ?? 0,
		minutes: values.minutes ?? 0,
		seconds: values.seconds ?? 0,
	});
}

function addDays(date: Date, days: number): Date {
	const result = new Date(date);
	result.setUTCDate(result.getUTCDate() + days);
	return result;
}

function getStartOfWeek(date: Date): Date {
	const result = new Date(date);
	const day = result.getUTCDay();
	// Monday as start of week
	const diff = day === 0 ? -6 : 1 - day;
	result.setUTCDate(result.getUTCDate() + diff);
	return result;
}

function getEndOfWeek(date: Date): Date {
	const start = getStartOfWeek(date);
	return addDays(start, 6);
}

function getStartOfMonth(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function getEndOfMonth(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function resolveVariable(expression: string, timezone?: string): string {
	// Split format: "today|YYYY/MM/DD" → variable="today", format="YYYY/MM/DD"
	const pipeIndex = expression.indexOf("|");
	const variable =
		pipeIndex >= 0 ? expression.slice(0, pipeIndex).trim() : expression.trim();
	const format =
		pipeIndex >= 0 ? expression.slice(pipeIndex + 1).trim() : undefined;

	const now = getDateInTimezone(timezone);

	// Check for offset pattern: "today+N" or "today-N"
	const offsetMatch = variable.match(/^today([+-])(\d+)$/);
	if (offsetMatch) {
		const sign = offsetMatch[1] === "+" ? 1 : -1;
		const days = Number.parseInt(offsetMatch[2], 10);
		const date = addDays(now, sign * days);
		return formatDate(date, format ?? DEFAULT_DATE_FORMAT);
	}

	switch (variable) {
		case "today":
			return formatDate(now, format ?? DEFAULT_DATE_FORMAT);
		case "yesterday":
			return formatDate(addDays(now, -1), format ?? DEFAULT_DATE_FORMAT);
		case "tomorrow":
			return formatDate(addDays(now, 1), format ?? DEFAULT_DATE_FORMAT);
		case "startOfWeek":
			return formatDate(getStartOfWeek(now), format ?? DEFAULT_DATE_FORMAT);
		case "endOfWeek":
			return formatDate(getEndOfWeek(now), format ?? DEFAULT_DATE_FORMAT);
		case "startOfMonth":
			return formatDate(getStartOfMonth(now), format ?? DEFAULT_DATE_FORMAT);
		case "endOfMonth":
			return formatDate(getEndOfMonth(now), format ?? DEFAULT_DATE_FORMAT);
		case "now":
			return formatDate(now, format ?? DEFAULT_DATETIME_FORMAT);
		default:
			// Unknown variable — return as-is
			return `{{${expression}}}`;
	}
}

/**
 * Resolves all template variables in a string.
 *
 * @example
 * resolveTemplateString("{{yesterday}} 매출 분석", "Asia/Seoul")
 * // → "2026-03-30 매출 분석"
 */
export function resolveTemplateString(
	template: string,
	timezone?: string,
): string {
	return template.replace(TEMPLATE_PATTERN, (_, expr: string) =>
		resolveVariable(expr, timezone),
	);
}

/**
 * Resolves all template variables in a record of string values.
 *
 * @example
 * resolveTemplateRecord({ date: "{{today}}", range: "{{startOfMonth}}~{{today}}" }, "Asia/Seoul")
 * // → { date: "2026-03-31", range: "2026-03-01~2026-03-31" }
 */
export function resolveTemplateRecord(
	record: Record<string, string>,
	timezone?: string,
): Record<string, string> {
	const resolved: Record<string, string> = {};
	for (const [key, value] of Object.entries(record)) {
		resolved[key] = resolveTemplateString(value, timezone);
	}
	return resolved;
}
