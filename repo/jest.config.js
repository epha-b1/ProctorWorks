module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  // Include tests from unit_tests/, API_tests/, and the new black-box
  // e2e_tests/ folder. A single regex keeps `npm test` exhaustive while
  // the per-suite scripts in package.json use --testPathPatterns to
  // narrow scope when needed.
  testRegex: '(unit_tests|API_tests|e2e_tests)/.+\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { diagnostics: false }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(uuid)/)',
  ],
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    '!src/main.ts',
    '!src/**/*.module.ts',
    '!src/**/entities/**',
    '!src/**/dto/**',
    '!src/database/**',
    '!src/config/**',
  ],
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'json-summary'],
  // Enforced coverage gate. If any metric drops below its floor `jest
  // --coverage` exits non-zero, failing `npm run test:cov` and therefore
  // `run_tests.sh`. Floors are pinned from the current baseline so the
  // gate only goes up over time; new contributions that dip below the
  // floor block the build.
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80,
    },
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
};
