/** @type {import('jest').Config} */
module.exports = {
  testPathIgnorePatterns: [
    "/node_modules/",
    "/open-computer/",
    "/frontend/", // frontend uses vitest (yarn --cwd frontend test:apex)
  ],
};
