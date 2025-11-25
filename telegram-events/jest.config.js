/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'node',
    clearMocks: true,
    restoreMocks: true,
    resetModules: true,
    testMatch: ['**/tests/**/*.test.js'],
};
