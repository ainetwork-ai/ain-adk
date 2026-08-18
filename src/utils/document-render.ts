import type { Document, DocumentSlot } from "@/types/document";

/** Matches `{{slot:slotId}}` tokens (slotId: letters, digits, _ or -). */
const SLOT_TOKEN = /\{\{\s*slot:([A-Za-z0-9_-]+)\s*\}\}/g;

export type RenderSlotPlaceholder = (slot: DocumentSlot) => string;

const defaultPlaceholder: RenderSlotPlaceholder = (slot) => {
	switch (slot.status) {
		case "running":
			return `_${slot.label ?? slot.slotId} 조회 중…_`;
		case "failed":
			return `_${slot.label ?? slot.slotId} 조회 실패_`;
		default:
			return `_${slot.label ?? slot.slotId} (조회 전)_`;
	}
};

/**
 * Renders a document to final markdown by substituting each `{{slot:slotId}}`
 * token in `content` with the resolved fragment of the matching slot. Slots
 * that are not yet resolved fall back to a status placeholder.
 *
 * Tokens with no matching slot are left untouched.
 */
export function renderDocument(
	document: Document,
	placeholder: RenderSlotPlaceholder = defaultPlaceholder,
): string {
	const slotsById = new Map(
		(document.slots ?? []).map((slot) => [slot.slotId, slot]),
	);

	return document.content.replace(SLOT_TOKEN, (token, slotId: string) => {
		const slot = slotsById.get(slotId);
		if (!slot) {
			return token;
		}
		if (slot.status === "resolved" && slot.fragment) {
			return slot.fragment.content;
		}
		return placeholder(slot);
	});
}
