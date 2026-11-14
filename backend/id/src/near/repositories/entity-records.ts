import { encodeFinancialRecord, decodeFinancialRecord } from "./financial-history";
import type { State } from "../../../../../packages/wallet-contracts/src/domain/state";

// Static identifiers only: no request input is ever interpolated into SQL.
export const ENTITY_TABLES = {
  tokens: "terminal_tokens",
  networks: "terminal_networks",
  accessRecords: "terminal_access_records",
  accounts: "terminal_accounts", sessions: "terminal_sessions", challenges: "terminal_challenges",
  liveOrders: "terminal_orders", liveTrades: "terminal_trades",
  deposits: "terminal_deposits", withdrawals: "terminal_withdrawals",
} as const;
export type EntityKey = keyof typeof ENTITY_TABLES;
interface SqlClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function loadRecords(client: SqlClient, requests: number[], lock = false, origin = "http://localhost:3101"): Promise<State> {
  const state: Record<string, unknown> = { requests };
  for (const [key, table] of Object.entries(ENTITY_TABLES)) {
    const { rows } = await client.query(`SELECT id, data FROM ${table}${lock ? " ORDER BY id FOR UPDATE" : ""}`);
    if (!rows.length && !["accounts", "sessions", "challenges"].includes(key)) continue;
    state[key] = Object.fromEntries(rows.map(row => [row.id, decodeFinancialRecord(key, String(row.id), row.data, origin)]));
  }
  return state as unknown as State;
}
export async function saveChangedRecords(client: SqlClient, before: State, after: State, origin = "http://localhost:3101") {
  for (const [key, table] of Object.entries(ENTITY_TABLES) as [EntityKey, string][]) {
    const previous = before[key] ?? {}, next = after[key] ?? {};
    for (const id of Object.keys(previous)) {
      if (!(id in next)) await client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    }
    for (const [id, data] of Object.entries(next)) {
      if (JSON.stringify(previous[id as keyof typeof previous]) === JSON.stringify(data)) continue;
      await client.query(`INSERT INTO ${table} (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [id, JSON.stringify(encodeFinancialRecord(key, id, data, origin))]);
    }
  }
  if (JSON.stringify(before.requests) !== JSON.stringify(after.requests))
    await client.query("UPDATE terminal_metadata SET requests = $1::jsonb WHERE id = 1", [JSON.stringify(after.requests)]);
}
