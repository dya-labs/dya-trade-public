"use client";
import { LabeledSelectTrigger } from '@dya/wallet-ui/components/labeled-select-trigger';
import { TokenChoiceRow } from '@dya/wallet-ui/components/token-choice-row';
import { AssetMark } from '@dya/wallet-ui/components/near/asset-mark';
import { TOKENS } from '@dya/wallet-contracts/src/domain/assets';
import { DialogDrawerHeader } from '@dya/ui/components/dialog-drawer';
import { overlayTitleClassName } from '@dya/ui/components/overlay-header';
const paymentTokens={USDC:{...TOKENS.USDC,blockchain:'near',coingeckoId:'usd-coin'},NEAR:{...TOKENS.wNEAR,symbol:'NEAR',blockchain:'near',coingeckoId:'near'}};

export type SetupPaymentAsset = 'USDC' | 'NEAR';
export function SetupPaymentMark({asset}:{asset:SetupPaymentAsset}) {
 return <AssetMark asset={paymentTokens[asset]} size={36}/>;
}
export function SetupPaymentTrigger({asset,disabled,onClick}:{asset:SetupPaymentAsset;disabled?:boolean;onClick:()=>void}) {
 return <LabeledSelectTrigger label="Pay with" value={asset} icon={<SetupPaymentMark asset={asset}/>} aria-label="Payment token" disabled={disabled} onClick={onClick}/>;
}
export function SetupPaymentPicker({selectedAsset,onBack,onSelect}:{selectedAsset:SetupPaymentAsset;onBack:()=>void;onSelect:(asset:SetupPaymentAsset)=>void}) {
 return <section className="min-w-0 space-y-4" aria-label="Select payment token">
  <DialogDrawerHeader onBack={onBack} backLabel="Back to setup"><h2 className={overlayTitleClassName}>Select token</h2><p className="sr-only">Choose USDC or NEAR for account setup.</p></DialogDrawerHeader>
  <div className="-mx-2 space-y-1">{(['USDC','NEAR'] as const).map(token=><TokenChoiceRow key={token} asset={paymentTokens[token]} selected={selectedAsset===token} onSelect={()=>onSelect(token)}/>)}</div>
 </section>;
}
