import type { AinAgentManifest } from "@/types/agent";

let _manifest: AinAgentManifest | null = null;

export function setManifest(manifest: AinAgentManifest): void {
	_manifest = manifest;
}

export function getManifest(): AinAgentManifest {
	if (!_manifest) {
		throw new Error(
			"Manifest not initialized. AINAgent must be created first.",
		);
	}
	return _manifest;
}
