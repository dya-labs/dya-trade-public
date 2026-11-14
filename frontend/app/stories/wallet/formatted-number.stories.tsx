import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
const meta = { title: "Shared/FormattedNumber", component: FormattedNumber, args: { value: "1234.56789" } } satisfies Meta<typeof FormattedNumber>;
export default meta;
export const Examples: StoryObj<typeof meta> = { render: () => <div className="space-y-4 p-4 text-sm">
  <p>Token: <FormattedNumber value="0.892986" symbol="ETH" exactTooltip /></p>
  <p>Small balance: <FormattedNumber value="0.000000000001" symbol="ETH" exactTooltip /></p>
  <p>Stablecoin balance: <FormattedNumber value="1.980277" symbol="USDC" exactTooltip /></p>
  <p>Below a cent: <FormattedNumber value="0.009" format="currency" exactTooltip /></p>
  <p>Small stablecoin balance: <FormattedNumber value="0.009" symbol="USDC" exactTooltip /></p>
  <p>Currency: <FormattedNumber value="1234.567" format="currency" /></p>
  <p>Price: <FormattedNumber value="0.0000001234567" format="price" symbol="USDC" /></p>
  <p>Percentage: <FormattedNumber value="1.25" format="percentage" /></p>
  <p>Compact: <FormattedNumber value="1234567" format="compact" /></p>
  <p>Estimate: <FormattedNumber value="0.9997" fractionDigits={2} symbol="USDC" estimated /></p>
  <p>Unavailable: <FormattedNumber value={null} symbol="ETH" /></p>
  <p>Zero: <FormattedNumber value="0" symbol="ETH" /></p>
</div> };
