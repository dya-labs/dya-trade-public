export class ConfidentialAccessRequired extends Error {
  readonly code = "CONFIDENTIAL_ACCESS_REQUIRED";
  constructor(message = "Confirm your passkey to restore private balance access.") { super(message); this.name = "ConfidentialAccessRequired"; }
}
