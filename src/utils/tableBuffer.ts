/**
 * Utility for buffering markdown tables during streaming.
 * Detects table start/end patterns and buffers table content
 * to emit as a single chunk for better frontend rendering.
 */

export interface TableBuffer {
	/**
	 * Process incoming delta text.
	 * @returns Array of chunks ready to be emitted
	 */
	process(delta: string): string[];

	/**
	 * Flush any remaining buffered content.
	 * Call this when the stream ends.
	 * @returns Remaining buffered content
	 */
	flush(): string;

	/**
	 * Check if currently inside a table.
	 */
	isInTable(): boolean;
}

/**
 * Creates a table buffering transformer.
 *
 * How it works:
 * 1. Detects table start: line starting with `|`
 * 2. Buffers content while inside table
 * 3. Detects table end: line not starting with `|` after table content
 * 4. Emits buffered table as single chunk
 *
 * @returns TableBuffer instance
 */
export function createTableBuffer(): TableBuffer {
	let buffer = "";
	let inTable = false;

	return {
		process(delta: string): string[] {
			const chunks: string[] = [];
			buffer += delta;

			while (true) {
				if (!inTable) {
					// Look for table start pattern: newline followed by |
					// or buffer starts with | (beginning of stream)
					const tableStartMatch = buffer.match(/^(\|)|(\n\|)/);

					if (tableStartMatch) {
						const matchIndex = tableStartMatch.index ?? 0;
						const matchLength = tableStartMatch[0].length;
						const isNewlineStart = tableStartMatch[0].startsWith("\n");

						// Emit content before table
						if (matchIndex > 0 || (isNewlineStart && matchIndex === 0)) {
							const beforeTable = isNewlineStart
								? buffer.slice(0, matchIndex + 1) // include the newline
								: buffer.slice(0, matchIndex);
							if (beforeTable) {
								chunks.push(beforeTable);
							}
							buffer = buffer.slice(
								isNewlineStart ? matchIndex + 1 : matchIndex,
							);
						}

						inTable = true;
						continue;
					}

					// No table detected, emit all content
					if (buffer.length > 0) {
						// Keep last incomplete line in buffer (might be start of table)
						const lastNewline = buffer.lastIndexOf("\n");
						if (lastNewline >= 0) {
							chunks.push(buffer.slice(0, lastNewline + 1));
							buffer = buffer.slice(lastNewline + 1);
						}
					}
					break;
				}

				// Inside table: look for end pattern
				// Table ends when we have a complete line that doesn't start with |
				const lines = buffer.split("\n");

				// Check if we have a complete non-table line
				let tableEndIndex = -1;
				for (let i = 1; i < lines.length; i++) {
					const line = lines[i];
					// If line is complete (not the last partial line) and doesn't start with |
					if (i < lines.length - 1 || buffer.endsWith("\n")) {
						if (line.length > 0 && !line.startsWith("|")) {
							// Found end of table
							tableEndIndex = i;
							break;
						}
						// Empty line also ends table
						if (line.length === 0 && i < lines.length - 1) {
							tableEndIndex = i;
							break;
						}
					}
				}

				if (tableEndIndex >= 0) {
					// Emit table content
					const tableLines = lines.slice(0, tableEndIndex);
					const tableContent = tableLines.join("\n") + "\n";
					chunks.push(tableContent);

					// Keep remaining content
					buffer = lines.slice(tableEndIndex).join("\n");
					inTable = false;
					continue;
				}

				// Still in table, keep buffering
				break;
			}

			return chunks;
		},

		flush(): string {
			const remaining = buffer;
			buffer = "";
			inTable = false;
			return remaining;
		},

		isInTable(): boolean {
			return inTable;
		},
	};
}
