import ts from "typescript-eslint";
export default ts.config(
  { ignores: ["dist/**", "artifacts/**", "out/**", "node_modules/**"] },
  ...ts.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
);
