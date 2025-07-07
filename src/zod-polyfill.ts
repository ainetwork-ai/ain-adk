// src/zod-polyfill.ts
import { ZodString, z } from "zod";

// TypeScript 인터페이스 확장
declare module "zod" {
	interface ZodString {
		/** Base64 형식 여부를 검사하는 메서드 */
		base64(): this;
	}
}

// 실제 구현: prototype에 메서드 붙이기
ZodString.prototype.base64 = function () {
	return this.refine(
		(val) => {
			try {
				// 디코딩 후 재인코딩했을 때 같으면 유효한 base64
				return Buffer.from(val, "base64").toString("base64") === val;
			} catch {
				return false;
			}
		},
		{ message: "Invalid base64 string" },
	);
};
