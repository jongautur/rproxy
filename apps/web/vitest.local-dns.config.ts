import { defineConfig } from "vitest/config";
import path from "path";

// DNS unit tests use mocks and do not need production environment credentials.
export default defineConfig({
  envDir: "/tmp/rproxy-unit-test-env",
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
