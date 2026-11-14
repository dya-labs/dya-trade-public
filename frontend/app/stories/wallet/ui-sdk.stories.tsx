import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExperimentalChoiceGroup } from "@dya/ui/components/experimental-choice-group";

const meta = {
  title: "Shared/UI SDK/Account choice",
  component: ExperimentalChoiceGroup,
  parameters: { layout: "centered" },
  decorators: [Story => <div className="w-full max-w-md space-y-4 p-4"><p className="text-sm text-muted-foreground">Interaction preview only. Selecting an option creates no wallet and changes no trading permissions.</p><Story /></div>],
  args: {
    label: "Account type", name: "accountType", defaultValue: "standard",
    choices: [
      { value: "standard", label: "Standard", description: "Your existing passkey signing flow." },
      { value: "trading", label: "Trading", description: "Preview the optional account experience. Setup and 24-hour trading are not enabled here.", badge: "Preview" },
    ],
  },
} satisfies Meta<typeof ExperimentalChoiceGroup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const RightToLeft: Story = { decorators: [Story => <div dir="rtl"><Story /></div>] };
