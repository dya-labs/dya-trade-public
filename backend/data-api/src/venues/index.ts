import { binance } from "../binance/venue";
import { bybit } from "./bybit";
import { gate } from "./gate";
import { kraken } from "./kraken";
import { kucoin } from "./kucoin";
import { mexc } from "./mexc";
import { intents } from "./intents/venue";
import { okx } from "./okx";
import { rhea } from "./rhea/venue";
import { safetrade } from "./safetrade";
import type { Venue } from "./types";

/** Supported venues by id. Registry sources and market ids (`<venue>:<symbol>`) refer to these ids. */
export const VENUES: Record<string, Venue> = { binance, bybit, okx, kucoin, gate, mexc, kraken, safetrade, rhea, intents };

export function venue(id: string): Venue {
  const found = VENUES[id];
  if (!found) throw new Error(`Unknown venue: ${id}`);
  return found;
}
