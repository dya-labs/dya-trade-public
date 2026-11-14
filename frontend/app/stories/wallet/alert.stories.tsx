import type { Meta, StoryObj } from '@storybook/react-vite';
import { Alert, AlertTitle, AlertDescription, AlertAction } from '@dya/ui/components/alert';
import { Button } from '@dya/ui/components/button';
import { Info, CircleAlert, TriangleAlert } from '@dya/ui/icons';

const variants = ['default', 'destructive', 'warning'] as const;
type Variant = typeof variants[number];
const examples = {
  default: { title: 'Account information', description: 'Your account preferences are available on this device.', Icon: Info },
  destructive: { title: 'Unable to sign out', description: 'Your session is still active.', Icon: CircleAlert },
  warning: { title: 'Confirmation expires soon', description: 'Review the details before continuing.', Icon: TriangleAlert },
} satisfies Record<Variant, { title: string; description: string; Icon: typeof Info }>;
function AlertGallery() {
  return <main className="min-h-dvh space-y-8 bg-background p-6 text-foreground">
    <header className="space-y-2"><h1 className="text-xl font-medium">Alert gallery</h1><p className="text-sm text-muted-foreground">Shared production Alert components. Use the theme toolbar and viewport controls to compare light/dark and narrow layouts.</p></header>
    {variants.map(variant => {
      const { title, description, Icon } = examples[variant];
      return <section key={variant} className="max-w-xl space-y-4">
        <h2 className="font-medium capitalize">{variant}</h2>
        <div className="space-y-2"><p className="text-xs text-muted-foreground">Message only</p><Alert variant={variant}><AlertDescription>{title}</AlertDescription></Alert></div>
        <div className="space-y-2"><p className="text-xs text-muted-foreground">Icon and message</p><Alert variant={variant}><Icon aria-hidden="true" /><AlertDescription>{title}</AlertDescription></Alert></div>
        <div className="space-y-2"><p className="text-xs text-muted-foreground">Icon, title and description</p><Alert variant={variant}><Icon aria-hidden="true" /><AlertTitle>{title}</AlertTitle><AlertDescription>{description}</AlertDescription></Alert></div>
        <div className="space-y-2"><p className="text-xs text-muted-foreground">With action (preview only)</p><Alert variant={variant}><Icon aria-hidden="true" /><AlertTitle>{title}</AlertTitle><AlertDescription>{description}</AlertDescription><AlertAction><Button variant="link" size="xs">Details</Button></AlertAction></Alert></div>
      </section>;
    })}
    <section className="max-w-sm space-y-3"><h2 className="font-medium">Long message / narrow container</h2><Alert variant="destructive"><CircleAlert aria-hidden="true" /><AlertTitle>Unable to complete this request</AlertTitle><AlertDescription>Your connection was interrupted before the operation could be confirmed. Check its current status before starting another request.</AlertDescription></Alert></section>
  </main>;
}
const meta = { title: 'Shared/Alert', component: Alert, args: { variant: 'default' } } satisfies Meta<typeof Alert>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Gallery: Story = { render: () => <AlertGallery /> };
export const Default: Story = { render: args => { const { title, description, Icon } = examples[args.variant ?? "default"]; return <div className="max-w-xl p-6"><Alert {...args}><Icon aria-hidden="true" /><AlertTitle>{title}</AlertTitle><AlertDescription>{description}</AlertDescription></Alert></div>; } };
export const Destructive: Story = { ...Default, args: { variant: 'destructive' } };
export const Warning: Story = { ...Default, args: { variant: 'warning' } };
