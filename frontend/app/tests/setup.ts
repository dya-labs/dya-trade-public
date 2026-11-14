import * as matchers from "@testing-library/jest-dom/matchers"
import { cleanup } from "@testing-library/react"
import { afterEach, expect } from "vitest"

afterEach(cleanup)

expect.extend(matchers)

// Synthetic storage keys for repository tests; never used by application runtime.
process.env.FINANCIAL_HISTORY_KEYS = JSON.stringify({ test: "ab".repeat(32) });
process.env.FINANCIAL_HISTORY_ACTIVE_KEY_ID = "test";
process.env.FINANCIAL_HISTORY_ALLOW_PLAINTEXT_MIGRATION = "1";
