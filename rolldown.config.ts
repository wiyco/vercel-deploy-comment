import { defineConfig } from "rolldown";

export default defineConfig([
  {
    input: "src/main.ts",
    output: {
      file: "dist/index.js",
      format: "esm",
    },
    platform: "node",
  },
  {
    input: "src/post.ts",
    output: {
      file: "dist/post.js",
      format: "esm",
    },
    platform: "node",
  },
]);
