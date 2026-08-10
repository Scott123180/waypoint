import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "packages/desktop/tests/e2e",
  testMatch: "**/*.spec.ts",
  // Electron app instances are launched per test; running them in parallel
  // makes window focus assertions unreliable.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    trace: "retain-on-failure",
  },
});
