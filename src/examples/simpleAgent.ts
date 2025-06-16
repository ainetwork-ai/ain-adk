import { AINAgent } from "../ainagent.js";
import { IntentAnalyzer } from "../modules/intent/analyzer.js";

const agent = new AINAgent();
const intentAnalyzer = new IntentAnalyzer();

agent.addIntentAnalyzer(intentAnalyzer);
agent.start(3010);