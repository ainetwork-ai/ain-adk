import type {
	WorkflowGraphBlock,
	WorkflowPieChartBlock,
	WorkflowRenderedGraphData,
	WorkflowRenderedPieChartData,
	WorkflowRenderedXYChartData,
	WorkflowXYChartBlock,
	WorkflowXYChartSeriesData,
} from "@/types/memory.js";

export type WorkflowGraphRenderResult = {
	content: string;
	data: WorkflowRenderedGraphData;
};

export class WorkflowGraphService {
	buildExtractionPrompt(
		block: WorkflowGraphBlock,
		resultsText: string,
	): string {
		return block.graphType === "xychart-beta"
			? this.buildXYChartExtractionPrompt(block, resultsText)
			: this.buildPieChartExtractionPrompt(block, resultsText);
	}

	renderGraph(
		block: WorkflowGraphBlock,
		rawContent: string,
	): WorkflowGraphRenderResult {
		if (block.graphType === "xychart-beta") {
			const spec = this.parseXYChartSpec(block, rawContent);
			const mermaid = this.renderXYChart(spec);
			return {
				content: `\`\`\`mermaid\n${mermaid}\n\`\`\`\n\n`,
				data: {
					spec,
					mermaid,
				},
			};
		}

		const spec = this.parsePieChartSpec(block, rawContent);
		const mermaid = this.renderPieChart(spec);
		return {
			content: `\`\`\`mermaid\n${mermaid}\n\`\`\`\n\n`,
			data: {
				spec,
				mermaid,
			},
		};
	}

	private buildXYChartExtractionPrompt(
		block: WorkflowXYChartBlock,
		resultsText: string,
	): string {
		return `Task results:
${resultsText}

Extract only the data needed to render a Mermaid xychart-beta graph.
Return only a valid JSON object with this shape:
{
  "title": "string (optional)",
  "xAxis": ["category label", "..."],
  "yAxis": {
    "label": "string (optional)",
    "min": "number (optional)",
    "max": "number (optional)"
  },
  "series": [
    {
      "kind": "bar or line",
      "label": "string (optional)",
      "data": [1, 2, 3]
    }
  ]
}

Rules:
- xAxis must be a non-empty array of strings.
- series must be a non-empty array.
- Every series.data array must contain only numbers.
- Every series.data length must exactly match xAxis length.
- Use "bar" or "line" for series.kind.
- Omit yAxis.min / yAxis.max if they cannot be determined confidently.
- Prefer the workflow block title when it is already provided.

Workflow block title:
${block.title || "(none)"}

Workflow graph instructions:
${block.prompt}`;
	}

	private buildPieChartExtractionPrompt(
		block: WorkflowPieChartBlock,
		resultsText: string,
	): string {
		return `Task results:
${resultsText}

Extract only the data needed to render a Mermaid pie graph.
Return only a valid JSON object with this shape:
{
  "title": "string (optional)",
  "showData": "boolean (optional)",
  "slices": [
    {
      "label": "string",
      "value": 1
    }
  ]
}

Rules:
- slices must be a non-empty array.
- Every slice.label must be a non-empty string.
- Every slice.value must be a positive number greater than zero.
- Prefer the workflow block title when it is already provided.
- Respect the block-level showData flag when it is provided.

Workflow block title:
${block.title || "(none)"}

Workflow block showData:
${block.showData === undefined ? "(unspecified)" : String(block.showData)}

Workflow graph instructions:
${block.prompt}`;
	}

	private parseXYChartSpec(
		block: WorkflowXYChartBlock,
		rawContent: string,
	): WorkflowRenderedXYChartData {
		const parsed = this.parseJsonObject(rawContent);
		const xAxis = Array.isArray(parsed.xAxis)
			? parsed.xAxis
					.map((value) => this.toNonEmptyString(value))
					.filter((value): value is string => Boolean(value))
			: [];
		if (xAxis.length === 0) {
			throw new Error("XY chart extraction must return xAxis: string[].");
		}

		const rawSeries = Array.isArray(parsed.series) ? parsed.series : [];
		if (rawSeries.length === 0) {
			throw new Error("XY chart extraction must return a non-empty series[].");
		}

		const series = rawSeries.map((entry, index) =>
			this.parseXYChartSeries(entry, xAxis.length, index),
		);
		const title = this.toNonEmptyString(parsed.title) || block.title;
		const rawYAxis = this.asRecord(parsed.yAxis);
		const yAxis = rawYAxis ? this.buildXYAxisConfig(rawYAxis) : undefined;

		return {
			graphType: "xychart-beta",
			...(title ? { title } : {}),
			xAxis,
			...(yAxis ? { yAxis } : {}),
			series,
		};
	}

	private parsePieChartSpec(
		block: WorkflowPieChartBlock,
		rawContent: string,
	): WorkflowRenderedPieChartData {
		const parsed = this.parseJsonObject(rawContent);
		const rawSlices = Array.isArray(parsed.slices) ? parsed.slices : [];
		if (rawSlices.length === 0) {
			throw new Error("Pie chart extraction must return a non-empty slices[].");
		}

		const slices = rawSlices.map((entry, index) => {
			const slice = this.asRecord(entry);
			const label = this.toNonEmptyString(slice?.label);
			const value = this.toFiniteNumber(slice?.value);
			if (!label) {
				throw new Error(
					`Pie chart slice at index ${index} must include a non-empty label.`,
				);
			}
			if (value === undefined || value <= 0) {
				throw new Error(
					`Pie chart slice "${label}" must use a positive numeric value.`,
				);
			}
			return { label, value };
		});

		const title = this.toNonEmptyString(parsed.title) || block.title;
		const showData =
			block.showData ??
			(typeof parsed.showData === "boolean" ? parsed.showData : undefined);

		return {
			graphType: "pie",
			...(title ? { title } : {}),
			...(showData === undefined ? {} : { showData }),
			slices,
		};
	}

	private renderXYChart(spec: WorkflowRenderedXYChartData): string {
		const lines = ["xychart-beta"];
		if (spec.title) {
			lines.push(`  title ${JSON.stringify(spec.title)}`);
		}

		lines.push(
			`  x-axis [${spec.xAxis.map((value) => JSON.stringify(value)).join(", ")}]`,
		);

		const yAxisLine = this.buildXYAxisLine(spec);
		if (yAxisLine) {
			lines.push(yAxisLine);
		}

		for (const series of spec.series) {
			const labelPrefix = series.label
				? ` ${JSON.stringify(series.label)}`
				: "";
			lines.push(`  ${series.kind}${labelPrefix} [${series.data.join(", ")}]`);
		}

		return lines.join("\n");
	}

	private renderPieChart(spec: WorkflowRenderedPieChartData): string {
		const lines = [spec.showData ? "pie showData" : "pie"];
		if (spec.title) {
			lines.push(`  title ${JSON.stringify(spec.title)}`);
		}

		for (const slice of spec.slices) {
			lines.push(`  ${JSON.stringify(slice.label)} : ${slice.value}`);
		}

		return lines.join("\n");
	}

	private buildXYAxisLine(
		spec: WorkflowRenderedXYChartData,
	): string | undefined {
		if (!spec.yAxis) {
			return undefined;
		}

		const label = spec.yAxis.label || "value";
		if (spec.yAxis.min !== undefined && spec.yAxis.max !== undefined) {
			return `  y-axis ${JSON.stringify(label)} ${spec.yAxis.min} --> ${spec.yAxis.max}`;
		}

		return spec.yAxis.label
			? `  y-axis ${JSON.stringify(spec.yAxis.label)}`
			: undefined;
	}

	private parseXYChartSeries(
		entry: unknown,
		expectedLength: number,
		index: number,
	): WorkflowXYChartSeriesData {
		const record = this.asRecord(entry);
		if (!record) {
			throw new Error(`XY chart series at index ${index} must be an object.`);
		}
		const kind = record?.kind;
		if (kind !== "bar" && kind !== "line") {
			throw new Error(
				`XY chart series at index ${index} must use kind "bar" or "line".`,
			);
		}

		const data = Array.isArray(record.data)
			? record.data
					.map((value) => this.toFiniteNumber(value))
					.filter((value): value is number => value !== undefined)
			: [];
		if (data.length !== expectedLength) {
			throw new Error(
				`XY chart series at index ${index} must contain exactly ${expectedLength} numeric values.`,
			);
		}

		const label = this.toNonEmptyString(record.label);
		return {
			kind,
			...(label ? { label } : {}),
			data,
		};
	}

	private buildXYAxisConfig(
		yAxis: Record<string, unknown>,
	): WorkflowRenderedXYChartData["yAxis"] | undefined {
		const label = this.toNonEmptyString(yAxis.label);
		const min = this.toFiniteNumber(yAxis.min);
		const max = this.toFiniteNumber(yAxis.max);
		if (label === undefined && min === undefined && max === undefined) {
			return undefined;
		}

		return {
			...(label ? { label } : {}),
			...(min === undefined ? {} : { min }),
			...(max === undefined ? {} : { max }),
		};
	}

	private parseJsonObject(rawContent: string): Record<string, unknown> {
		const jsonText = this.extractJsonValue(rawContent);
		const parsed = JSON.parse(jsonText) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("Graph extraction did not return a JSON object.");
		}
		return parsed as Record<string, unknown>;
	}

	private extractJsonValue(rawContent: string): string {
		const trimmed = rawContent.trim();
		const unfenced = trimmed.startsWith("```")
			? trimmed
					.replace(/^```[a-zA-Z]*\n?/, "")
					.replace(/\n?```$/, "")
					.trim()
			: trimmed;
		const firstBrace = unfenced.indexOf("{");
		const lastBrace = unfenced.lastIndexOf("}");
		if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
			throw new Error("Graph extraction did not return a JSON object.");
		}
		return unfenced.slice(firstBrace, lastBrace + 1);
	}

	private asRecord(value: unknown): Record<string, unknown> | undefined {
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined;
	}

	private toNonEmptyString(value: unknown): string | undefined {
		return typeof value === "string" && value.trim().length > 0
			? value.trim()
			: undefined;
	}

	private toFiniteNumber(value: unknown): number | undefined {
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
		if (typeof value === "string" && value.trim().length > 0) {
			const parsed = Number(value.trim().replace(/,/g, ""));
			return Number.isFinite(parsed) ? parsed : undefined;
		}
		return undefined;
	}
}
