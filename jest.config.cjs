const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
	testEnvironment: "node",
	testMatch: ["**/*.test.ts"],
	moduleNameMapper: {
		"^@/(.*)\\.js$": "<rootDir>/src/$1",
		"^@/(.*)$": "<rootDir>/src/$1",
		"^(\\.{1,2}/.*)\\.js$": "$1",
	},
	transform: {
		...tsJestTransformCfg,
	},
};
