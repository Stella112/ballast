import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["lib/radar/**/*.test.ts", "lib/invoices/**/*.test.ts"], environment: "node" } });
