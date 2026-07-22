import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@emulators/core": resolve(__dirname, "../core/src/index.ts"),
    },
  },
  test: {
    globals: true,
  },
});
