import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from '@dya/ui/components/button';
import { TextMorph } from '@dya/ui/components/text-morph';

function TextMorphPreview() {
  const [step, setStep] = useState(0);
  const labels = ['Ready to continue', 'Processing transaction', 'Transaction confirmed'];
  return <main className="space-y-6 p-6">
    <TextMorph as="h2" className="text-xl font-medium">{labels[step % labels.length]}</TextMorph>
    <TextMorph className="block text-2xl tabular-nums" decimals={2} locale="en">{1234.5 + step * 13.25}</TextMorph>
    <Button onClick={() => setStep(value => value + 1)}>Change text</Button>
    <p className="text-sm text-muted-foreground">Click repeatedly to interrupt and retarget the morph. System reduced motion skips movement.</p>
  </main>;
}
const meta = { title: 'Shared/Text morph', component: TextMorphPreview } satisfies Meta<typeof TextMorphPreview>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
