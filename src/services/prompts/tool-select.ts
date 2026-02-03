import type { MemoryModule } from "@/modules";

async function toolSelectPrompt(memoryModule: MemoryModule) {
	const toolSelectPrompt =
		(await memoryModule?.getAgentMemory()?.getToolSelectPrompt?.()) ||
		"사용자의 요청을 해결하기 위해 이 도구를 선택한 구체적인 이유와 목적 (Why & What). \
		한두줄 정도의 분량으로 입력 언어와 같은 언어로 생성하며, 정중한 표현을 사용한다.";

	return toolSelectPrompt;
}

export default toolSelectPrompt;
