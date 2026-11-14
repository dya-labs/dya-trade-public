import { useEffect, useState } from "react";
import { Button } from "@dya/ui/components/button";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stepper } from "@dya/ui/components/stepper";

const meta = {
  title: "Shared/Stepper",
  component: Stepper,
  args: { steps: ["Important", "Configure", "Deposit"], current: 1, "aria-label": "Deposit steps" },
  decorators: [Story => <div className="w-full max-w-sm rounded-[var(--radius-dialog)] bg-popover p-3"><Story /></div>],
} satisfies Meta<typeof Stepper>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FirstStep: Story = {};
export const SecondStep: Story = { args: { current: 2 } };
export const ThirdStep: Story = { args: { current: 3 } };
export const Completed: Story = { args: { current: 3, complete: true } };
export const Compare: Story = {
  render: args => <div className="space-y-6">
    {[1, 2, 3].map(current => <section key={current} className="space-y-3"><h2 className="text-sm text-muted-foreground">Step {current}</h2><Stepper {...args} current={current} complete={false} /></section>)}
    <section className="space-y-3"><h2 className="text-sm text-muted-foreground">Completed</h2><Stepper {...args} current={3} complete /></section>
  </div>,
};


function InteractiveStepper() {
  const [position, setPosition] = useState(1);
  return <div className="space-y-6">
    <Stepper steps={["Important", "Configure", "Deposit"]} current={Math.min(position, 3)} complete={position === 4} aria-label="Deposit steps" />
    <div className="flex gap-2">
      <Button variant="outline" disabled={position === 1} onClick={() => setPosition(value => value - 1)}>Back</Button>
      <Button className="flex-1" onClick={() => setPosition(value => value === 4 ? 1 : value + 1)}>{position === 4 ? "Restart" : position === 3 ? "Complete" : "Next"}</Button>
    </div>
  </div>;
}
export const Interactive: Story = { render: () => <InteractiveStepper /> };


export const Loading: Story = { args: { current: 2, loading: true } };

function AsyncStepper() {
  const [phase, setPhase] = useState<"ready" | "loading" | "done">("ready");
  useEffect(() => {
    if (phase !== "loading") return;
    const timer = setTimeout(() => setPhase("done"), 1800);
    return () => clearTimeout(timer);
  }, [phase]);
  return <div className="space-y-6">
    <Stepper steps={["Important", "Configure", "Deposit"]} current={phase === "done" ? 3 : 2} loading={phase === "loading"} aria-label="Deposit steps" />
    <p role="status" className="text-center text-sm text-muted-foreground">{phase === "loading" ? "Creating deposit address…" : phase === "done" ? "Deposit address ready" : "Ready to create deposit address"}</p>
    <Button className="w-full" disabled={phase === "loading"} onClick={() => setPhase(phase === "done" ? "ready" : "loading")}>{phase === "done" ? "Reset" : phase === "loading" ? "Creating…" : "Create deposit address"}</Button>
    <p className="text-xs text-muted-foreground">Simulated delay for preview.</p>
  </div>;
}
export const LoadingToComplete: Story = { render: () => <AsyncStepper /> };
