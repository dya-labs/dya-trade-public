// Synthetic fixtures may start as plaintext. Production defaults remain strict.
process.env.FINANCIAL_HISTORY_KEYS = JSON.stringify({ test: "ab".repeat(32) });
process.env.FINANCIAL_HISTORY_ACTIVE_KEY_ID = "test";
process.env.FINANCIAL_HISTORY_ALLOW_PLAINTEXT_MIGRATION = "1";
