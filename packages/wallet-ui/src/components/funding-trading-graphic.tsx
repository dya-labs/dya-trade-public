import deposit from "../../../ui/src/brand/graphics/funding/deposit.webp?url";
import transfer from "../../../ui/src/brand/graphics/funding/transfer.webp?url";
import ready from "../../../ui/src/brand/graphics/funding/ready.webp?url";
import { bundledTokenIcon } from "../lib/bundled-token-icons";

const artwork = { funding: deposit, transfer, ready };

/** Generated atmosphere with real bundled token artwork, kept independently editable. */
export function FundingTradingGraphic({ stage }: { stage: keyof typeof artwork }) {
  return <div className="relative -m-4 h-40 w-[calc(100%+2rem)] max-w-none shrink-0 overflow-hidden rounded-lg" aria-hidden="true">
    <img src={artwork[stage]} alt="" width={768} height={512} className="size-full object-cover" draggable={false} />
    {stage === "funding" && <>
      <TokenLogo token="usd-coin" left="50%" top="15%" />
      <TokenLogo token="tether" left="50%" top="43%" />
      <TokenLogo token="dai" left="39%" top="65%" />
      <TokenLogo token="global-dollar" left="61%" top="65%" />
    </>}
    {stage === "transfer" && <>
      <TokenLogo token="usd-coin" left="15%" top="38%" plain />
      <TokenLogo token="tether" left="27%" top="45%" plain />
      <TokenLogo token="dai" left="13%" top="62%" plain />
      <TokenLogo token="global-dollar" left="25%" top="69%" plain />
      <TokenLogo token="usd-coin" left="70.5%" top="45%" large plain />
    </>}
  </div>;
}

function TokenLogo({ token, left, top, large = false, plain = false }: { token: "usd-coin" | "tether" | "dai" | "global-dollar"; left: string; top: string; large?: boolean; plain?: boolean }) {
  return <img src={bundledTokenIcon(token)} alt="" width={large ? 36 : 28} height={large ? 36 : 28} draggable={false}
    className={`absolute -translate-x-1/2 -translate-y-1/2 ${plain ? "" : "rounded-full bg-background ring-2 ring-background/70"}`}
    style={{ left, top }} />;
}
