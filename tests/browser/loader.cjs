/* eslint-disable @typescript-eslint/no-require-imports -- Webpack CommonJS loader contract. */
// Test harness only: transpiles the actual TSX with the installed TypeScript.
const ts = require("typescript");
module.exports = function (source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    fileName: this.resourcePath,
  }).outputText;
};
