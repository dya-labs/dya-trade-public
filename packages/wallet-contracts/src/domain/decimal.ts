import Decimal from "decimal.js";

export const D = Decimal.clone({ precision: 120, rounding: Decimal.ROUND_DOWN });
