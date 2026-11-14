import { DYA_BRAND } from "@dya/config";
import { Button } from "@dya/ui/components/button";
import { UserRound, ExternalLink, LogOut } from "@dya/ui/icons";

export function WalletSettings({ idOrigin, busy, onSignOut }: { idOrigin?: string; busy: boolean; onSignOut: () => void }) {
  return <div className="-mx-1.5 -mb-1.5 space-y-4">
    {idOrigin && <section aria-labelledby="wallet-account-heading" className="space-y-2">
      <h3 id="wallet-account-heading" className="px-2 text-xs font-medium text-muted-foreground">Account</h3>
      <Button variant="ghost" className="h-12 w-full justify-start rounded-[6px] border-0 px-2 transition-none hover:bg-hover focus-visible:bg-hover dark:hover:bg-hover" render={<a href={idOrigin} target="_blank" rel="noopener noreferrer" />}><UserRound aria-hidden="true" className="text-muted-foreground" /><span className="min-w-0 flex-1 text-left">Manage account in {DYA_BRAND.idName}</span><ExternalLink aria-hidden="true" className="text-muted-foreground" /></Button>
    </section>}
    <Button variant="ghost" className="h-12 w-full justify-start rounded-[6px] border-0 px-2 text-muted-foreground transition-none hover:bg-hover focus-visible:bg-hover dark:hover:bg-hover" disabled={busy} onClick={onSignOut}><LogOut aria-hidden="true" className="text-muted-foreground" />Sign out</Button>
  </div>;
}
