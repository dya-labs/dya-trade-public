// Use the official module type without installing Workers globals in the Next/Node lane.
declare module "cloudflare:workers" {
  export const env: typeof import("@cloudflare/workers-types").CloudflareWorkersModule.env;
}
