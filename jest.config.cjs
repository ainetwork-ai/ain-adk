const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
	testEnvironment: "node",
	testMatch: ["**/*.test.ts"],
	transform: {
		...tsJestTransformCfg,
	},
	moduleNameMapper: {
			"^@/(.*)\\.js$": "<rootDir>/src/$1",
			"^@/(.*)$": "<rootDir>/src/$1"
		},
};
