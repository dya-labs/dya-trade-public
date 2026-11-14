import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { createLocalPreference, createSessionPreference } from "@/lib/local-storage";
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); });
it("persists validated preferences across utility instances", () => {
  const preference = createLocalPreference("asset", z.string());
  expect(preference.read()).toBeUndefined();
  expect(preference.write("btc")).toBe(true);
  expect(createLocalPreference("asset", z.string()).read()).toBe("btc");
  preference.remove();
  expect(preference.read()).toBeUndefined();
});
it("ignores malformed or incompatible JSON", () => {
  const preference = createLocalPreference("asset", z.string());
  for (const value of ["invalid json", "123", "{}"]) {
    localStorage.setItem("asset", value);
    expect(preference.read()).toBeUndefined();
  }
});
it("handles blocked storage without interrupting the UI", () => {
  const preference = createLocalPreference("asset", z.string());
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  expect(preference.read()).toBeUndefined();
  expect(preference.write("btc")).toBe(false);
});

it("keeps session preferences separate from persistent preferences", () => {
  const local = createLocalPreference("asset", z.string());
  const session = createSessionPreference("asset", z.string());
  local.write("btc");
  session.write("eth");
  expect(local.read()).toBe("btc");
  expect(createSessionPreference("asset", z.string()).read()).toBe("eth");
  session.remove();
  expect(session.read()).toBeUndefined();
  expect(local.read()).toBe("btc");
});
it("validates session values and handles blocked session storage", () => {
  const preference = createSessionPreference("panel", z.enum(["ticket", "chart"]));
  sessionStorage.setItem("panel", JSON.stringify("unknown"));
  expect(preference.read()).toBeUndefined();
  vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => { throw new Error("blocked"); });
  expect(preference.read()).toBeUndefined();
  expect(preference.write("ticket")).toBe(false);
  expect(() => preference.remove()).not.toThrow();
});
