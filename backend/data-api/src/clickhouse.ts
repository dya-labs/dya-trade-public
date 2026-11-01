import type { Config } from "./config";

export type Params = Record<string, string | number>;

// Decimals stay exact strings in canonical form ("4261.48", "0.000000012328") so no float rounding
// reaches clients and stored bars equal live-folded ones.
const outputSettings = {
  output_format_json_quote_decimals: "1",
  output_format_decimal_trailing_zeros: "0",
  output_format_json_quote_64bit_integers: "0",
};

/** Minimal client for ClickHouse's HTTP interface; parameters are always bound server-side. */
export class ClickHouse {
  constructor(readonly options: Config["clickhouse"], private readonly fetcher: typeof fetch = fetch) {}

  private async send(sql: string, params: Params, body?: string, database = this.options.database, timeoutMs = 60_000): Promise<string> {
    const url = new URL(this.options.url + "/");
    url.searchParams.set("database", database);
    for (const [name, value] of Object.entries(outputSettings)) url.searchParams.set(name, value);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(`param_${name}`, String(value));
    if (body !== undefined) url.searchParams.set("query", sql);
    if (timeoutMs > 60_000) url.searchParams.set("max_execution_time", String(Math.ceil(timeoutMs / 1000)));
    const response = await this.fetcher(url, {
      method: "POST",
      headers: { "X-ClickHouse-User": this.options.user, "X-ClickHouse-Key": this.options.password },
      body: body ?? sql,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`ClickHouse ${response.status}: ${text.slice(0, 500)}`);
    return text;
  }

  async query<T>(sql: string, params: Params = {}): Promise<T[]> {
    const text = await this.send(`${sql}\nFORMAT JSONEachRow`, params);
    return text ? text.trimEnd().split("\n").map(line => JSON.parse(line) as T) : [];
  }

  /**
   * DDL. Non-replicated MergeTree ALTERs wait for their rewrite, so migrations pass a long timeout;
   * it also lifts the server's per-query `max_execution_time` (60 s in the deployment profile).
   */
  async command(sql: string, params: Params = {}, database?: string, timeoutMs?: number): Promise<void> {
    await this.send(sql, params, undefined, database, timeoutMs);
  }

  async insert(table: string, rows: readonly object[]): Promise<void> {
    if (!rows.length) return;
    await this.send(`INSERT INTO ${table} FORMAT JSONEachRow`, {}, rows.map(row => JSON.stringify(row)).join("\n"));
  }
}
