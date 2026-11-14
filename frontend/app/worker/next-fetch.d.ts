// Shared DYA ID / wallet-contracts code and the legacy market routes pass Next's `next` fetch cache option.
// Workers ignore it. This keeps that code type-checking without Next; delete it once those callers drop the option.
interface RequestInit {
  next?: { revalidate?: number | false; tags?: string[] };
}
