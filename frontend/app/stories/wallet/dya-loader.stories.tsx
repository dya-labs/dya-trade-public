import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppLoadingScreen } from "@dya/ui/components/app-loading-screen";
import { DyaLoader } from "@dya/ui/components/dya-loader";

const meta = {
  title: "Shared/DyaLoader",
  component: DyaLoader,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DyaLoader>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ChartLoading: Story = {
  render: () => <div className="flex min-h-screen items-center justify-center bg-background"><DyaLoader label="Loading chart" /></div>,
};

export const Fullscreen: Story = {
  render: () => <AppLoadingScreen active label="Loading app" />,
};
