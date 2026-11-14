"use client";
import type { ComponentProps } from "react";
import { startAuthentication } from "@dya/wallet-sdk";
import { WithdrawalForm as SharedWithdrawalForm } from "@dya/wallet-ui/components/near/withdrawal-form";

// Terminal authenticates through ID; standalone ID supplies native WebAuthn.
type Props = Omit<ComponentProps<typeof SharedWithdrawalForm>, "authenticate"> & {
  authenticate?: ComponentProps<typeof SharedWithdrawalForm>["authenticate"];
};
export function WithdrawalForm(props: Props) {
  return <SharedWithdrawalForm authenticate={options => startAuthentication({ ...options, popup: !!props.withdrawalSource })} {...props} />;
}
