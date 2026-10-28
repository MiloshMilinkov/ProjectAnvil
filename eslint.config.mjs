import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import ts from "typescript-eslint";
import react from "eslint-plugin-react";
import hooks from "eslint-plugin-react-hooks";
import accessibility from "eslint-plugin-jsx-a11y";
import globals from "globals";

const eslintConfig = defineConfig([
  js.configs.recommended,
  ...ts.configs.recommended,
  globalIgnores([
    ".next/**",
    "out/**",
    "next-env.d.ts",
    "dist/**",
    ".wrangler/**",
    ".vinext/**",
    ".sites-runtime/**",
    "backups/**",
    "outputs/**",
    "work/**",
    "test-results/**",
    "playwright-report/**",
    "blob-report/**",
    "playwright/.cache/**",
    "playwright/.auth/**",
  ]),
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      react,
      "react-hooks": hooks,
      "jsx-a11y": accessibility,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs["jsx-runtime"].rules,
      ...hooks.configs.recommended.rules,
      // TypeScript checks component props and modern React DOM attributes.
      "react/prop-types": "off",
      "react/no-unknown-property": "off",
      // Preserve the existing accessibility checks without a framework parser.
      "jsx-a11y/alt-text": ["error", { elements: ["img"], img: ["Image"] }],
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-proptypes": "error",
      "jsx-a11y/aria-unsupported-elements": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/role-supports-aria-props": "error",
      // Browser recovery paths intentionally tolerate unavailable device storage.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Preserve named default exports without installing an import resolver.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ExportDefaultDeclaration > :matches(ObjectExpression, ArrayExpression, ArrowFunctionExpression, FunctionExpression, ClassExpression, Literal, FunctionDeclaration[id=null], ClassDeclaration[id=null])",
          message: "Name the value before exporting it as the default.",
        },
      ],
    },
  },
  {
    files: ["tests/browser/**/*.ts"],
    rules: {
      // Playwright inspects destructured fixture parameters, even when unused.
      "no-empty-pattern": ["error", { allowObjectPatternsAsParameters: true }],
    },
  },
  {
    files: ["tests/**/*.cjs"],
    rules: {
      // The isolated backend harness deliberately transpiles modules to CommonJS.
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
