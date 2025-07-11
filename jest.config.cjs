/** @type {import("jest").Config} **/
module.exports = {
        preset: "ts-jest",
        testEnvironment: "node",
        testMatch: ["**/*.test.ts", "**/*.test.js"],
        extensionsToTreatAsEsm: [".ts"],
        globals: {
                'ts-jest': {
                        useESM: true,
                },
        },
        moduleNameMapper: {
                '^@/(.*)\\.js$': '<rootDir>/src/$1.ts',
                '^(.+\\/src\\/.*)\\.js$': '$1.ts',
                ...require('ts-jest').pathsToModuleNameMapper(
                        require('./tsconfig.json').compilerOptions.paths,
                        { prefix: '<rootDir>/' },
                ),
        },
};
