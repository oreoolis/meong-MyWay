import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Test setup.
 *
 * Two suites with very different needs, separated by file extension rather
 * than directory so a test sits next to the thing it tests:
 *
 *   *.test.ts     unit — pure logic, no network, milliseconds
 *   *.itest.ts    integration — real AWS, real Bedrock, real money
 *
 * `npm test` runs only the unit suite, so the default loop stays free and
 * offline. The integration suite is opt-in via `npm run test:integration`.
 *
 * `.mts` because this file is ESM and the package is not marked as such;
 * loading it as CommonJS is deprecated in Vite.
 */
export default defineConfig({
  resolve: {
    // Native replacement for vite-tsconfig-paths — resolves the `@/*` alias
    // straight from tsconfig.json.
    tsconfigPaths: true,
    alias: {
      // `server-only` throws on import outside a React Server Component. Node
      // does not set the `react-server` export condition, so every module
      // guarded by it would fail to load here. Stubbing it keeps that guard
      // meaningful in the real build while letting the modules be tested.
      "server-only": path.resolve(import.meta.dirname, "test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    // Next.js loads .env.local itself; Vitest does not. Without this the
    // integration suite fails on missing S3_BUCKET_NAME rather than on
    // anything it is actually testing. The empty prefix loads every key, not
    // just VITE_-prefixed ones.
    env: loadEnv("development", import.meta.dirname, ""),
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.itest.ts"],
          // A full five-agent run is five sequential model calls plus
          // framework lookups; the default 5s timeout is nowhere near enough.
          testTimeout: 300_000,
          hookTimeout: 120_000,
          // The suite writes to shared AWS resources under one fixed test
          // user, so parallel files would overwrite each other.
          fileParallelism: false,
        },
      },
    ],
  },
});
