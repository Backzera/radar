// Browser integration bundle, not a substitute for the Vinext production build.
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(import.meta.url),
  { webpack } = require("next/dist/compiled/webpack/webpack");
await new Promise((res, rej) => {
  const compiler = webpack({
    mode: "development",
    devtool: false,
    target: "web",
    entry: resolve("tests/browser/entry.tsx"),
    output: { path: resolve(".browser-build"), filename: "app.js" },
    resolve: { extensions: [".tsx", ".ts", ".js", ".mjs", ".json"] },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: [resolve("tests/browser/loader.cjs")],
        },
      ],
    },
    optimization: { minimize: false },
    performance: { hints: false },
  });
  compiler.run((e, stats) => {
    if (e || stats?.hasErrors()) {
      console.error(e ?? stats?.toString({ all: false, errors: true }));
      compiler.close(() => rej(e ?? new Error("Browser bundle failed")));
    } else
      compiler.close(() => {
        console.log(
          stats.toString({ all: false, assets: true, timings: true }),
        );
        res();
      });
  });
});
