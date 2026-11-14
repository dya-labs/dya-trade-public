import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { DetailsDisclosure } from "@dya/ui/components/details-disclosure";

function Fixture({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return <div className="mx-auto w-full max-w-sm p-4"><DetailsDisclosure label="3 assets · 2 networks" open={open} onOpenChange={setOpen}><p className="text-sm text-muted-foreground">Breakdown content</p></DetailsDisclosure></div>;
}
const meta = { title: "Shared/DetailsDisclosure", component: Fixture } satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Closed: Story = {};
export const Open: Story = { args: { initiallyOpen: true } };
