import { z } from "zod";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/browser";
import { request } from "./request";
import { authenticationOptions, registrationOptions, signingCheck, snapshot, balances } from "./schemas/account";
import { ok } from "./schemas/common";

export const getSession = (signal?: AbortSignal) => request("state", snapshot, undefined, signal);
export const getBalances = (signal?: AbortSignal, selection?: { baseAssetId: string; quoteAssetId: string }) => request("live/balances" + (selection ? `?${new URLSearchParams(selection)}` : ""), balances, undefined, signal);
export const registrationOptionsRequest = (name: string) => request("auth/register/options", registrationOptions, { name });
export const verifyRegistration = (body: RegistrationResponseJSON) => request("auth/register/verify", z.object({ ok: z.literal(true), session: snapshot }), body);
export const loginOptions = (credentialId?: string) => request("auth/login/options", authenticationOptions, credentialId ? { credentialId } : {});
export const verifyLogin = (body: AuthenticationResponseJSON) => request("auth/login/verify", z.object({ ok: z.literal(true), confidentialUnlocked: z.boolean(), session: snapshot }), body);
export const logout = () => request("auth/logout", ok, {});
export const backupAuthorizationOptions = () => request("backup/authorize/options", authenticationOptions, {});
export const verifyBackupAuthorization = (body: AuthenticationResponseJSON) => request("backup/authorize/verify", ok, body);
export const backupRegistrationOptions = () => request("backup/register/options", registrationOptions, {});
export const verifyBackupRegistration = (body: RegistrationResponseJSON) => request("backup/register/verify", ok, body);
export const backupTestOptions = () => request("backup/test/options", authenticationOptions, {});
export const verifyBackupTest = (body: AuthenticationResponseJSON) => request("backup/test/verify", ok, body);
export const prepareSigningCheck = () => request("intents/prepare", z.object({ options: authenticationOptions }), {});
export const verifySigningCheck = (body: AuthenticationResponseJSON) => request("intents/verify", z.object({ result: signingCheck }), body);

export const getAllBalances = (signal?: AbortSignal) => request("live/balances?all=true", balances, undefined, signal);
