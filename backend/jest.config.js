/**
 * Unit tests only — no database, no Nest container.
 *
 * The code worth testing here is the arithmetic: line totals, document totals,
 * weighted average costing, and how a bundle's price is split back across its
 * components. Those are pure functions, so they can be tested directly and run
 * in under a second, which is what makes them worth running on every change.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  collectCoverageFrom: ['common/**/*.ts', '!common/*.module.ts'],
};
