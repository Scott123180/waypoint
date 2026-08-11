import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "packages/desktop/tests/e2e",
  testMatch: "**/*.spec.ts",
  // Electron app instances are launched per test; running them in parallel
  // makes window focus assertions unreliable.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  // The `github` reporter emits each failure as a workflow annotation, and
  // annotations are readable from the public API without a token — unlike raw
  // logs (403) and artifacts (401). Without it a CI failure reports only
  // "Process completed with exit code 1", which says nothing about which test
  // broke or why.
  reporter: process.env["CI"]
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    trace: "retain-on-failure",
  },
});
