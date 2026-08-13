import { defineConfig } from "vite";

// GitHub Pages（プロジェクトサイト）へのデプロイのため、リポジトリ名をベースパスにする。
export default defineConfig({
  base: "/obisu-map/",
  // maplibre-glのWorkerスクリプト(.mjs)がVite依存プリバンドルの対象になると
  // 404で壊れる既知の問題があるため、プリバンドル対象から除外する。
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
});
