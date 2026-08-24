import { defineConfig } from "vite";

// カスタムドメイン(orbis.1kqr1.com)のルート直下にデプロイするため、ベースパスは "/"。
// （github.io/obisu-map/ のようなプロジェクトサイトのサブパス配信だった頃の名残でリポジトリ名を
//   ベースパスにしていたが、カスタムドメインはドメイン直下にサイトを配信するため不要になった）
export default defineConfig({
  base: "/",
  // maplibre-glのWorkerスクリプト(.mjs)がVite依存プリバンドルの対象になると
  // 404で壊れる既知の問題があるため、プリバンドル対象から除外する。
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
});
