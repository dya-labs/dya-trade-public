/** Browser and SimpleWebAuthn cancellation shapes used by wallet confirmation screens. */
export function isConfirmationCancelled(error: unknown): boolean {
  return !!error && typeof error === "object" &&
    (("name" in error && error.name === "NotAllowedError") ||
      ("code" in error && error.code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"));
}
