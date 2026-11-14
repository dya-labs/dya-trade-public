import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import importPlugin from "eslint-plugin-import";
import globals from "globals";

// The rule set eslint-config-next applied before the SPA migration, minus its Next-only rules.
export default defineConfig([
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts}"],
    plugins: { react, "react-hooks": reactHooks, "jsx-a11y": jsxA11y, import: importPlugin },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    settings: { react: { version: "detect" } },
    rules: {
      ...Object.fromEntries(Object.entries(react.configs.recommended.rules).filter(([name]) => !["react/prop-types", "react/react-in-jsx-scope", "react/jsx-no-target-blank", "react/no-unknown-property"].includes(name))),
      ...reactHooks.configs.recommended.rules,
      "import/no-anonymous-default-export": "warn",
      "jsx-a11y/alt-text": ["warn", { elements: ["img"] }],
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-proptypes": "warn",
      "jsx-a11y/aria-unsupported-elements": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-unused-expressions": ["warn", { allowShortCircuit: false, allowTaggedTemplates: false, allowTernary: false }],
    },
  },
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
  globalIgnores([
    "dist/**",
    ".next/**",
    "next-env.d.ts",
    ".wrangler/**",
    "storybook-static/**",
  ]),
]);
