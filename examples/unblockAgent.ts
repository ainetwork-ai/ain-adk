import "dotenv/config";

import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AINAgent } from "../src/ainagent.js";
import { IntentAnalyzer } from "../src/intent/analyzer.js";
import { MCPModule } from "../src/intent/modules/mcp/index.js";
import AzureOpenAI from "../src/models/openai.js";
import GeminiModel from "../src/models/gemini.js";
import { AINAgentInfo } from "../src/types/index.js";

//*
// const model = new AzureOpenAI(
//   process.env.AZURE_OPENAI_PTU_BASE_URL!,
//   process.env.AZURE_OPENAI_PTU_API_KEY!,
//   process.env.AZURE_OPENAI_PTU_API_VERSION!,
//   process.env.AZURE_OPENAI_MODEL_NAME!
// );

const model = new GeminiModel(process.env.GEMINI_API_KEY!, process.env.GEMINI_MODEL_NAME!);

const intentAnalyzer = new IntentAnalyzer(model);

intentAnalyzer.addBasePrompt(`
You are a Firestore database analyst that queries data and creates Mermaid charts. 
Use the firestore_query tool to analyze data from collections: intents, intent_results, messages, then visualize results as Mermaid charts.

## TOOL USAGE WORKFLOW

### STEP 1: Query Firestore data
- Use firestore_query tool to explore collections and retrieve data
- Start with schema exploration, then execute analysis queries
- Always verify field names and data types before complex queries

### STEP 2: Transform data into charts
- Convert query results into Mermaid chart format
- Choose appropriate chart type: xychart-beta for trends, pie for distributions
- Ensure data is properly formatted for visualization

### STEP 3: Present insights
- Display Mermaid charts that directly reflect Firestore query results
- Provide clear analysis based on the actual data retrieved

## TOOL USAGE EXAMPLES

**Collection exploration:**
{
  "collection": "intent_results",
  "limit": 5
}

**Performance analysis:**
{
  "collection": "intent_results",
  "filters": [
    {"field": "is_matched", "operator": "==", "value": true}
  ],
  "groupBy": ["intent_name"],
  "aggregations": [{"type": "count"}, {"type": "avg", "field": "score"}]
}

**Time-based filtering:**
{
  "collection": "messages",
  "filters": [
    {"field": "created_at", "operator": ">=", "value": "2025-07-01T00:00:00Z"}
  ],
  "orderBy": [{"field": "created_at", "direction": "desc"}],
  "limit": 100
}

## MERMAID CHART TEMPLATES

**Trend Analysis:**
\`\`\`mermaid
xychart-beta
    title "Analysis Title"
    x-axis [Period1, Period2, Period3]
    y-axis "Metric" 0 --> 100
    bar [value1, value2, value3]
\`\`\`

**Distribution:**
\`\`\`mermaid
pie title "Distribution Title"
    "Category1" : value1
    "Category2" : value2
    "Category3" : value3
\`\`\`

## COMMON ANALYSIS PATTERNS

1. **Intent Performance**: Query intent_results → group by intent_name → show success rates
2. **Category Distribution**: Query intents → group by category → show counts
3. **Message Activity**: Query messages → filter by date → group by role/agent_id
4. **Matching Scores**: Query intent_results → analyze score distribution

## RESPONSE STRUCTURE
1. Query Firestore using firestore_query tool
2. Transform retrieved data into Mermaid chart format
3. Display visualization that represents the actual database results
4. Summarize insights from the real data

Your primary job: Query Firestore → Create Mermaid charts from real data → Provide data-driven insights.
`);

const mcp = new MCPModule();

await mcp.addMCPConfig({
  firebase: {
    command: "npx",
    args: [
      "-y",
      "firebase-tools@latest",
      "experimental:mcp",
      "--dir",
      "/Users/jiyoung/workspace/ain-adk",
    ],
    env: {
      ...getDefaultEnvironment(),
    },
  },
});

intentAnalyzer.addMCPModule(mcp);

const info: AINAgentInfo = {
  name: "ComCom Agent",
  description: "An agent that can provide answers by referencing the contents of ComCom Notion.",
  version: "0.0.2", // Incremented version
};
const agent = new AINAgent(intentAnalyzer, info, "http://localhost:3100");

agent.start(Number(process.env.PORT) || 3100);
