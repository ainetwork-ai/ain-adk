import type { MemoryModule } from "@/modules";

async function multiTriggerPrompt(
	memoryModule: MemoryModule,
	intentList: string,
) {
	const multiTriggerPrompt =
		(await memoryModule?.getAgentMemory()?.getMultiTriggerPrompt?.()) ||
		`Instructions:
1. **First, review the available intent list** to understand what intents are available and what each intent can handle
2. **Identify which intents from the list are relevant** to the user's question
3. **Decompose the question based on intent boundaries**:
   - Prioritize splitting the query where each subquery can map to an intent from the available list
   - If a portion of the query matches an available intent, create a subquery for it and set the intentName
   - If a portion of the query does NOT match any available intent, still create a subquery for it but leave intentName empty/null
   - Each subquery should be the minimal unit that represents a coherent request or action
   - If the query maps to a single intent (or single action), keep it as one subquery
4. For each subquery, provide a 2-3 sentence summary of what actions will be performed
5. Maintain the logical sequence of the original question when splitting into subqueries
6. **Important**: Use the intent list as a guide for decomposition, but don't force-fit queries into intents that don't match. It's acceptable to have subqueries without matching intents.
7. Determine if the final response needs aggregation:
   - Review all decomposed subqueries and their expected results
   - Set needsAggregation to TRUE if: the results from multiple subqueries should be combined and synthesized into a single, unified response
   - Set needsAggregation to FALSE if: the aggregation step is not required (e.g., only one subquery exists, OR the subqueries are independent and their individual results can be returned separately without combination)

Requirements:
- Prioritize using available intents when decomposing queries
- Use intent boundaries as the primary guide for splitting, but allow subqueries without matching intents when necessary
- Preserve the original meaning and context when splitting queries
- Set intentName only when there's a clear match with an available intent; leave it empty/null otherwise
- Even if the query is simple and maps to a single intent (or action), return it as a single-element array with one subquery object
- Set needsAggregation based on whether the user expects a unified combined answer or separate responses
`;

	return `
Today is ${new Date().toLocaleDateString()}.

${multiTriggerPrompt}

Output Format:
You MUST return the output in the following JSON format. Do not include any other text before or after the JSON:
{
  "needsAggregation": <true or false>,
  "subqueries": [
    {
      "subquery": "<subquery_1>",
      "intentName": "<intent_name_1>",
      "actionPlan": "<2-3 sentence description of what will be done for this subquery>"
    },
    {
      "subquery": "<subquery_2>",
      "intentName": "<intent_name_2>",
      "actionPlan": "<2-3 sentence description of what will be done for this subquery>"
    }
  ]
}

Available intent list:
${intentList}
`;
}

export default multiTriggerPrompt;
