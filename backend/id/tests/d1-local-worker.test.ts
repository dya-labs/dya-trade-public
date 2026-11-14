import { request as httpRequest } from "node:http";
import { expect, test } from "vitest";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticator } from "./fixtures/authenticator";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const origin = "http://localhost:3101";
// Run explicitly; ordinary D1 unit runs never touch developer state or start Vite.
const enabled = process.env.DYA_ID_RUN_LOCAL_WORKER === "1";
test.skipIf(!enabled)("local_migration_and_vite_use_same_database_and_default_aliases", async () => {
  const state = await mkdtemp(join(tmpdir(), "id-d1-local-worker-"));
  const env = {...process.env, DYA_ID_D1_LOCAL_STATE: state, WRANGLER_SEND_METRICS: "false"};
  let child: ChildProcess | undefined;
  let log = "", sessionCookie = "";
  const stop = async () => {
    if (!child?.pid) return;
    const exited = new Promise<void>(resolve => child!.once("exit", () => resolve()));
    process.kill(-child.pid, "SIGTERM"); await exited; child = undefined;
  };
  try {
    execFileSync("bun", ["--bun","wrangler","d1","migrations","apply","dya-id-local","--local","--config",join(root,"frontend/id/wrangler.local.jsonc"),"--persist-to",state], {cwd: root, env, stdio: "pipe"});
    execFileSync("bun", [join(root,"backend/id/scripts/init-d1.mjs")], {cwd: root, env, stdio: "pipe"});
    for (const entry of ["dev:id", "dev:id:d1", "workspace"]) {
      log = "";
      const args = entry === "workspace" ? ["run", "--filter", "id", "dev"] : ["run", entry];
      args.push("--host", "127.0.0.1");
      child = spawn("bun", args, {cwd: root, env, detached: true, stdio: ["ignore","pipe","pipe"]});
      const ready = Promise.withResolvers<string>();
      child.stdout?.on("data", data => {
        log += String(data);
        const address = log.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
        if (address) ready.resolve(address);
      });
      child.stderr?.on("data", data => {log += String(data);});
      child.once("error", ready.reject);
      child.once("exit", () => ready.reject(new Error("ID dev exited before ready")));
      const address = await ready.promise;
      const call = (path: string, body?: unknown, cookie = sessionCookie) => new Promise<Response>((resolve, reject) => {
        // Undici rewrites Host to the fallback port. Raw HTTP preserves the canonical Host.
        const request = httpRequest(`${address}/api/near/${path}`, {method: body === undefined ? "GET" : "POST", headers: {host: "localhost:3101", origin, "content-type": "application/json", cookie}}, response => {
          const chunks: Buffer[] = [];
          response.on("data", chunk => chunks.push(Buffer.from(chunk)));
          response.on("end", () => {
            const headers = new Headers();
            for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
            resolve(new Response(Buffer.concat(chunks), {status: response.statusCode, headers}));
          });
        });
        request.on("error", reject); request.end(body === undefined ? undefined : JSON.stringify(body));
      });
      if (!sessionCookie) {
        const passkey = authenticator(origin);
        const optionsResponse = await call("auth/register/options", {});
        expect(optionsResponse.status, await optionsResponse.clone().text()).toBe(200);
        const challengeCookie = optionsResponse.headers.get("set-cookie")!.split(";")[0];
        const options = await optionsResponse.json() as {challenge: string};
        const registered = await call("auth/register/verify", passkey.registration(options.challenge), challengeCookie);
        expect(registered.status).toBe(200);
        sessionCookie = registered.headers.get("set-cookie")!.match(/near_session=[^;,]+/)![0];
      }
      const response = await call("state"); expect(response.status).toBe(200);
      const body = await response.json() as {account: {id: string} | null};
      expect(body.account?.id).toBeTruthy();
      console.info("id.d1.local.entry", {entry, storage: "d1", persistedAccount: !!body.account});
      await stop();
    }
    // Wrangler migration history and initialization replay preserve the wallet.
    execFileSync("bun", ["--bun","wrangler","d1","migrations","apply","dya-id-local","--local","--config",join(root,"frontend/id/wrangler.local.jsonc"),"--persist-to",state], {cwd: root, env, stdio: "pipe"});
    execFileSync("bun", [join(root,"backend/id/scripts/init-d1.mjs")], {cwd: root, env, stdio: "pipe"});
  } finally { await stop(); await rm(state, {recursive:true,force:true}); }
}, 90000);
