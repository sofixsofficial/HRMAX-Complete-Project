/**
 * Jest configuration for the HR MAX mobile app.
 *
 * Uses the jest-expo preset (babel-preset-expo transform + React Native host
 * mocks), so component tests can render real screens. Only *.test.ts(x) files
 * under __tests__ are collected.
 */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.@(ts|tsx)'],
  clearMocks: true,
};
