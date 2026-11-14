import { expect, it } from "vitest";
import { INTERVALS, anchorFor, pageIndex as serverPageIndex } from "../../../backend/data-api/src/candles/intervals";
import { pageIndex } from "@/lib/market-data/pages";

// The client computes which aligned page holds a timestamp; a mismatch would request the wrong history.
it("matches the data API's page index for every interval, including Monday weeks, 3d anchors and calendar months", () => {
  const firstOpenTimes = [1502942400000, 1602651600000, 1710316800000]; // BTCUSDT, NEARUSDT, NEARUSDC
  const times = [0, 345_600_000, 1_700_000_000_000, 1_791_838_457_707, Date.UTC(2024, 1, 29, 23, 59), Date.UTC(2025, 11, 31, 23, 59, 59, 999)];
  for (const interval of Object.keys(INTERVALS))
    for (const first of firstOpenTimes)
      for (const time of [...times, first, first - 1])
        expect([interval, first, time, pageIndex(interval, time, first)]).toEqual([interval, first, time, serverPageIndex(interval, time, anchorFor(interval, first))]);
});
