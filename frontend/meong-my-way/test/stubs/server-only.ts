/**
 * Stand-in for the `server-only` package under test.
 *
 * Intentionally empty, and the emptiness is the whole point. The real package
 * throws on import unless the `react-server` export condition is set, which
 * Node does not set, so every module guarded by it would fail to load under
 * Vitest. `vitest.config.mts` aliases `server-only` to this file, which lets a
 * test import those modules without weakening the guard in the build that
 * actually ships.
 *
 * Not dead code: delete it and every test that reaches a server module fails
 * to load, which is three of the four suites.
 */
export {};
