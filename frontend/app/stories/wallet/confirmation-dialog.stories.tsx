import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from '@dya/ui/components/button';
import { Alert, AlertDescription } from '@dya/ui/components/alert';
import { AlertDialogDrawer, AlertDialogDrawerContent, AlertDialogDrawerDescription, AlertDialogDrawerFooter, AlertDialogDrawerHeader, AlertDialogDrawerTitle, AlertDialogDrawerCancel, AlertDialogDrawerAction, AlertDialogDrawerBody } from '@dya/ui/components/alert-dialog-drawer';

function ConfirmationPreview({ compact, withContent, withError }: { compact: boolean; withContent: boolean; withError: boolean }) {
  const [open, setOpen] = useState(true);
  const hasBody = withContent || withError;
  return <main className="min-h-dvh bg-background p-6 text-foreground">
    <Button variant="outline" onClick={() => setOpen(true)}>Open confirmation</Button>
    <AlertDialogDrawer open={open} onOpenChange={setOpen}>
      <AlertDialogDrawerContent compact={compact}>
        <AlertDialogDrawerHeader><AlertDialogDrawerTitle>Sign out?</AlertDialogDrawerTitle><AlertDialogDrawerDescription className="sr-only">Confirm signing out of your account. Storybook preview only.</AlertDialogDrawerDescription></AlertDialogDrawerHeader>
        {hasBody && <AlertDialogDrawerBody>{withContent && <p className="text-sm text-muted-foreground">You can sign in again with your passkey.</p>}
        {withError && <Alert variant="destructive"><AlertDescription>Sign-out unavailable</AlertDescription></Alert>}</AlertDialogDrawerBody>}
        <AlertDialogDrawerFooter >
          <AlertDialogDrawerCancel>Cancel</AlertDialogDrawerCancel>
          <AlertDialogDrawerAction onClick={() => setOpen(false)}>Sign out</AlertDialogDrawerAction>
        </AlertDialogDrawerFooter>
      </AlertDialogDrawerContent>
    </AlertDialogDrawer>
  </main>;
}
const meta = {
  title: 'Shared/ConfirmationDialog', component: ConfirmationPreview,
  args: { compact: true, withContent: false, withError: false },
} satisfies Meta<typeof ConfirmationPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Compact: Story = {};
export const Spacious: Story = { args: { compact: false } };
export const WithContent: Story = { args: { withContent: true } };
export const WithError: Story = { args: { withError: true } };
