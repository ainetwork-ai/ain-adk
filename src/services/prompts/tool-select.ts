import type { MemoryModule } from "@/modules";

async function toolSelectPrompt(memoryModule: MemoryModule) {
	const toolSelectPrompt =
		(await memoryModule?.getAgentMemory()?.getToolSelectPrompt?.()) ||
		"이 도구를 호출하는 이유와 기대하는 결과를 구체적으로 작성하세요. 어떤 데이터 또는 작업이 필요한지 명확히 기술합니다. \
		한두줄 정도의 분량으로 입력 언어와 같은 언어로 생성하며, 정중한 표현을 사용한다";

	return toolSelectPrompt;
}

export default toolSelectPrompt;
