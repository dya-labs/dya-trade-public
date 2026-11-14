import { expect, test, vi } from "vitest";
import { harness, origin } from "./d1-harness";
import { D1Store } from "../src/near/repositories/d1-store";
import { StatementBudget } from "../src/near/repositories/request-budget";
import { hash } from "../src/near/repositories/store";
import { rememberConfidentialSession, withConfidentialSession } from "../src/near/services/confidential-sessions";
import { ConfidentialAccessRequired } from "../../../packages/wallet-contracts/src/domain/confidential-access-error";
import { StorageUnavailableError } from "../src/near/repositories/storage-error";

test("restored_ciphertext_requires_correct_key_and_owner_binding_and_frozen_storage_blocks_use", async () => {
  const h = await harness();
  vi.stubEnv("CONFIDENTIAL_SESSION_KEY", "55".repeat(32));
  const s = () => new D1Store(h.db, origin, new StatementBudget("paid"));
  const providerUse = vi.fn(async () => "used");
  try {
    await s().transaction(s => {
      s.accounts.a = { id: "a", kind: "passkey", counter: 3 };
      for (const name of ["first", "second"]) s.sessions[hash(name)] = { accountId: "a", expires: Date.now() + 3600000 };
    });
    await rememberConfidentialSession(s(), "first", "a", { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresIn: 3600, refreshExpiresIn: 3600 });
    const restored = await s().read(s => structuredClone(s.sessions[hash("first")].confidential!));
    vi.stubEnv("CONFIDENTIAL_SESSION_KEY", "66".repeat(32));
    await expect(withConfidentialSession(s(), "first", "a", providerUse)).rejects.toBeInstanceOf(ConfidentialAccessRequired);
    expect(providerUse).not.toHaveBeenCalled();
    vi.stubEnv("CONFIDENTIAL_SESSION_KEY", "55".repeat(32));
    await s().transaction(s => { s.sessions[hash("second")].confidential = restored; });
    await expect(withConfidentialSession(s(), "second", "a", providerUse)).rejects.toBeInstanceOf(ConfidentialAccessRequired);
    expect(providerUse).not.toHaveBeenCalled();
    await h.raw.prepare("UPDATE id_metadata SET readiness='initializing'").run();
    await expect(withConfidentialSession(s(), "first", "a", providerUse)).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(providerUse).not.toHaveBeenCalled();
  } finally { await h.mf.dispose(); vi.unstubAllEnvs(); }
});
