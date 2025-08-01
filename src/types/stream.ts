export type StreamEvent = {
	event: "tool_start" | "tool_output" | "text_chunk" | "error";
	data: Record<string, any>;
};
