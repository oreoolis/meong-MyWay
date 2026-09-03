/**
 * Stand-in for the `server-only` package under test.
 *
 * The real package throws on import unless the `react-server` export condition
 * is set, which Node does not set. Aliasing to this empty module (see
 * vitest.config.ts) lets server modules be imported by tests without weakening
 * the guard in the actual build.
 */
export {};
