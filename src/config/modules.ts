import type {
	A2AModule,
	MCPModule,
	MemoryModule,
	ModelModule,
} from "@/modules";

export interface AgentModules {
	modelModule: ModelModule;
	a2aModule?: A2AModule;
	mcpModule?: MCPModule;
	memoryModule?: MemoryModule;
}

let _modules: AgentModules | null = null;

export function setModules(modules: AgentModules): void {
	_modules = modules;
}

export function getModules(): AgentModules {
	if (!_modules) {
		throw new Error("Modules not initialized. AINAgent must be created first.");
	}
	return _modules;
}

export function getModelModule(): ModelModule {
	return getModules().modelModule;
}

export function getA2AModule(): A2AModule | undefined {
	return getModules().a2aModule;
}

export function getMCPModule(): MCPModule | undefined {
	return getModules().mcpModule;
}

export function getMemoryModule(): MemoryModule | undefined {
	return getModules().memoryModule;
}
