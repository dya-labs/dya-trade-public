import { expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { formatNumber } from "@dya/ui/lib/format-number";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
afterEach(cleanup);
it("preserves large decimal strings and conservative token balances", () => {
  expect(formatNumber("9007199254740993.123456", { format: "exact" })).toBe("9,007,199,254,740,993.123456");
  expect(formatNumber("0.000000001")).toBe("<0.000001");
  expect(formatNumber("0.892986")).toBe("0.8929");
  expect(formatNumber(0.000001)).toBe("0.000001");
  expect(formatNumber("0")).toBe("0");
});
it("never rounds a token amount up, so a stablecoin balance reads what can be spent", () => {
  expect(formatNumber("9.999847", { unit: "USDC" })).toBe("9.99");
  expect(formatNumber("1234.567", { unit: "USDT" })).toBe("1,234.56");
  expect(formatNumber("0.0186", { fractionDigits: 2 })).toBe("0.01");
  // Dollar values are valuations and round to the nearest cent.
  expect(formatNumber("9.999847", { format: "currency" })).toBe("$10.00");
});
it("uses explicit display formats and percentage points", () => {
  expect(formatNumber("1234.567", {format:"currency"})).toBe("$1,234.57");
  expect(formatNumber("0.0000001234567", {format:"price"})).toBe("0.000000123457");
  expect(formatNumber("1.256", {format:"percentage"})).toBe("1.26%");
  expect(formatNumber("1234567", {format:"compact"})).toBe("1.23M");
  expect(formatNumber("0.0001", {fractionDigits:2})).toBe("<0.01");
  for (const value of [null, undefined, "", "invalid", "Infinity", NaN]) expect(formatNumber(value)).toBe("-");
});
it("makes estimates opt-in and exposes the original value only when requested", () => {
  render(<FormattedNumber value="0.892986" symbol="ETH" estimated exactTooltip />);
  expect(screen.getByText("≈ 0.8929 ETH").getAttribute("title")).toBe("0.892986 ETH");
});
it("keeps unavailable values distinct from zero and omits misleading units", () => {
  render(<FormattedNumber value={null} symbol="ETH" estimated exactTooltip />);
  expect(screen.getByText("-").hasAttribute("title")).toBe(false);
});

it("preserves exact trailing zeros and centralizes legacy Intl precision without losing integer precision", () => {
  expect(formatNumber("99.80", {format:"exact"})).toBe("99.80");
  expect(formatNumber("-0.001", {format:"currency"})).toBe("-<$0.01");
  expect(formatNumber("9007199254740993.123456", {intl:{maximumFractionDigits:6}})).toBe("9,007,199,254,740,993.123456");
  expect(formatNumber("1.2", {intl:{minimumFractionDigits:4,maximumFractionDigits:4}})).toBe("1.2000");
});

it("uses two decimals and strict below-cent thresholds for dollars and USD stablecoins", () => {
  for (const unit of ["USD", "USDC", "USDT", "DAI", "USDS", "USDe"]) {
    expect(formatNumber("1.23456", {unit})).toBe("1.23");
    expect(formatNumber("0.009", {unit})).toBe("<0.01");
    expect(formatNumber("0.01", {unit})).toBe("0.01");
    expect(formatNumber("0", {unit})).toBe("0.00");
  }
  expect(formatNumber("0.009", {format:"currency"})).toBe("<$0.01");
  expect(formatNumber("0", {format:"currency"})).toBe("$0.00");
  expect(formatNumber("0.000123456", {format:"price", unit:"USDC"})).toBe("0.000123456");
  expect(formatNumber("0.000123456", {format:"exact", unit:"USDC"})).toBe("0.000123456");
  expect(formatNumber("0.009", {intl:{style:"currency",currency:"USD"}})).toBe("<$0.01");
});
it("infers stablecoin denomination from the component symbol and retains exact tooltip", () => {
 render(<FormattedNumber value="0.009" symbol="USDC" exactTooltip />);
 expect(screen.getByText("<0.01 USDC").getAttribute("title")).toBe("0.009 USDC");
});
