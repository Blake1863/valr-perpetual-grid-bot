/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        module: 'ESNext',
        moduleResolution: 'Bundler',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        allowImportingTsExtensions: false,
        skipLibCheck: true,
        strict: true,
        target: 'ES2022',
      },
      diagnostics: { ignoreCodes: [151002] },
    }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
