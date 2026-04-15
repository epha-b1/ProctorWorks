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
  // Enforced coverage gate. Floors are pinned from the current
  // demonstrated-achievable baseline so the gate only goes UP over
  // time; any contribution that drops below these floors fails the
  // build.
  //
  // These are intentionally NOT 100/100/100/100. Reaching true 100%
  // across the ~925 branches in this service surface would require
  // targeted unit tests for every defensive fallback (driver-error
  // wrappers, stale-cache branches, scheduler cron guards, etc.) —
  // many of which are unreachable without contrived mock graphs that
  // test nothing real. The project's "no shallow assert-true tests"
  // quality bar and the "minimal harmful distortion" rule outrank a
  // cosmetic 100%. See README "Coverage gate" for the next tranche
  // of work needed to push further.
  coverageThreshold: {
    global: {
      statements: 91,
      branches: 77,
      functions: 95,
      lines: 93,
    },
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
};
