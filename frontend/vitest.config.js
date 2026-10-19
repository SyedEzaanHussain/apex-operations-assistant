import { defineConfig } from "vitest/config";

// Component tests for the Apex UI. Run with: yarn test:apex
export default defineConfig({
  esbuild: { jsx: "automatic" },
  css: { postcss: { plugins: [] } }, // tests don't need Tailwind processing
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/pages/Apex/__tests__/setup.js"],
    include: ["src/pages/Apex/__tests__/**/*.test.jsx"],
  },
});
