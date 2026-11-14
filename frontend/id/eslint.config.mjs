import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          { name: "@/lib/near/http/request", message: "Use a named endpoint service; schemas belong at the API boundary." },
          { name: "axios", message: "Use a named endpoint service." },
        ],
      }],
      "no-restricted-syntax": ["error", {
        selector: "CallExpression[callee.name='fetch']",
        message: "Use a named endpoint service instead of fetching in a component or hook.",
      }, {
        selector: "CallExpression[callee.property.name='fetch']",
        message: "Use a named endpoint service instead of fetching in a component or hook.",
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "dist/**",
    ".vinext/**",
    ".wrangler/**",
    "storybook-static/**",
    "build/**",
    "next-env.d.ts",
    "public/charting_library/**",
    "vendor/tradingview/**",
  ]),
]);

export default eslintConfig;
