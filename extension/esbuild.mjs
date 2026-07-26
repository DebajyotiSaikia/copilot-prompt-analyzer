import esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: "info",
  target: "es2022",
};

const extensionConfig = {
  ...common,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  external: ["vscode"],
};

const webviewConfig = {
  ...common,
  entryPoints: ["webview/main.tsx"],
  outfile: "dist/webview.js",
  platform: "browser",
  format: "iife",
  define: {
    "process.env.NODE_ENV": production ? '"production"' : '"development"',
  },
};

const styleConfig = {
  ...common,
  entryPoints: ["webview/app.css"],
  outfile: "dist/webview.css",
};

// Kept out of the main bundle: ~3.3 MB that most sessions never need.
const mermaidConfig = {
  ...common,
  entryPoints: ["webview/mermaidEntry.ts"],
  outfile: "dist/mermaid.js",
  platform: "browser",
  format: "iife",
  define: {
    "process.env.NODE_ENV": production ? '"production"' : '"development"',
  },
};

if (watch) {
  for (const config of [
    extensionConfig,
    webviewConfig,
    styleConfig,
    mermaidConfig,
  ]) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
  }
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig),
    esbuild.build(styleConfig),
    esbuild.build(mermaidConfig),
  ]);
}
