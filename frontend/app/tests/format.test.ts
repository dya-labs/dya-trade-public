import {expect,it} from "vitest"
import {money,percent,formatTokenAmount} from "@/lib/format"
it("formats worker fractions as percentages and quote currency as USDT",()=>{expect(percent("0.125")).toBe("12.5%");expect(money("100")).toBe("100.00 USDT");expect(money(null)).toBe("Unavailable")})

it("formats token balances conservatively without losing exact source precision",()=>{
 expect(formatTokenAmount("0.892986")).toBe("0.8929");
 expect(formatTokenAmount("1234.567891")).toBe("1,234.56");
 expect(formatTokenAmount("0.000001")).toBe("0.000001");
 expect(formatTokenAmount("0.000000000001")).toBe("<0.000001");
 expect(formatTokenAmount("0")).toBe("0");
 expect(formatTokenAmount("invalid")).toBe("Unavailable");
})
