import { defineConfig } from "vite";
import { resolve } from "node:path";

// Foundry loads `dist/crows.mjs` as an ES module from its own static server, so
// the bundle must be a single self-contained ESM file with no code-splitting
// (Foundry does not serve dynamic chunk requests relative to the system root).
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/crows.mjs"),
      formats: ["es"],
      fileName: () => "crows.mjs"
    },
    rollupOptions: {
      output: {
        // One file. Chunking breaks Foundry's module loading.
        inlineDynamicImports: true,
        assetFileNames: "crows.[ext]"
      }
    }
  }
});
