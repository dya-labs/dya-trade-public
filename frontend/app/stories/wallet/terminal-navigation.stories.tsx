import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { BrandMark } from "@dya/ui/components/brand-mark";
import { buttonVariants } from "@dya/ui/components/button";
import { DYA_BRAND } from "@dya/config";
import { APP_NAVIGATION } from "@/lib/navigation";

function NavigationPreview({
  markHeight = 14,
  wordmarkSize = 14,
  brandGap = 6,
}: {
  markHeight?: number;
  wordmarkSize?: number;
  brandGap?: number;
}) {
  const [active, setActive] = useState("TRADE");
  return (
    <nav aria-label="Terminal navigation preview" className="flex min-h-14 flex-wrap items-center gap-8 bg-background px-4">
      <a href="/" onClick={event => event.preventDefault()} className="flex shrink-0 items-center" style={{ gap: brandGap }} aria-label={`${DYA_BRAND.name} home`}>
        <BrandMark aria-hidden="true" width={252} height={141} style={{ height: markHeight, width: "auto" }} />
        <span className="font-medium tracking-tight" style={{ fontSize: wordmarkSize }}>{DYA_BRAND.name}</span>
      </a>
      <div className="flex items-center gap-1">
        {APP_NAVIGATION.map(item => (
          <a
            key={item.label}
            href={item.href}
            aria-current={active === item.label ? "page" : undefined}
            onClick={event => {
              event.preventDefault();
              setActive(item.label);
            }}
            className={buttonVariants({
              variant: "ghost",
              className: `h-8! rounded-[6px]! gap-2 px-3 text-xs ${active === item.label ? "text-foreground" : "text-muted-foreground"} hover:bg-control dark:hover:bg-control`,
            })}
          >
            <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${active === item.label ? "bg-primary" : "bg-transparent"}`} />
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

const meta = {
  title: "App/TerminalNavigation",
  component: NavigationPreview,
  args: { markHeight: 14, wordmarkSize: 14, brandGap: 6 },
  argTypes: {
    markHeight: { control: { type: "range", min: 10, max: 20, step: 1 } },
    wordmarkSize: { control: { type: "range", min: 12, max: 18, step: 1 } },
    brandGap: { control: { type: "range", min: 4, max: 12, step: 1 } },
  },
} satisfies Meta<typeof NavigationPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
