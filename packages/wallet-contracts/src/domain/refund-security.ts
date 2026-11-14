import type { Network } from "./networks";
import { keccak_256 } from "@noble/hashes/sha3.js";

/** Syntax/checksum validation is not proof of custody. */
export function validFixedRefundAddress(address: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/i.test(address)) return false;
  const value = address.slice(2);
  if (value === value.toLowerCase() || value === value.toUpperCase()) return true;
  const digest = Array.from(keccak_256(new TextEncoder().encode(value.toLowerCase())), b => b.toString(16).padStart(2, "0")).join("");
  return [...value].every((char, index) => !/[a-f]/i.test(char) || char === (parseInt(digest[index], 16) >= 8 ? char.toUpperCase() : char.toLowerCase()));
}
/** Provider-managed formats are checked by the provider when a quote is requested. */
export function validRefundInput(address: string) {
  return address.length > 0 && address.length <= 256 && !/[\s\u0000-\u001f\u007f]/.test(address) && !address.includes("://");
}
export function validNetworkRefundAddress(network: Pick<Network, "id" | "addressKind">, address: string) {
  if (!validRefundInput(address)) return false;
  if (network.addressKind === "evm") return validFixedRefundAddress(address);
  if (network.addressKind === "near" || network.id === "near")
    return address.length >= 2 && address.length <= 64 && /^(?:[a-z0-9]+(?:[-_][a-z0-9]+)*)(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*$/.test(address);
  return true;
}
