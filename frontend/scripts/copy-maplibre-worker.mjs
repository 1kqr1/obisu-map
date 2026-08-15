// maplibre-glは実行時にimport.meta.urlから自身のWorkerファイルの場所を逆算する
// （サイドカーの maplibre-gl-worker.mjs を探しに行く）。Vite の本番ビルドはアプリ
// コードを1つのJSにバンドルしてしまうため、その仕組みが機能しない
// （import.meta.url がバンドル本体のURLになり、存在しないパスを探しに行って404になる。
// エラーは出ず、GeoJSONソースの処理が止まって地図に何も描画されなくなるだけなので気づきにくい）。
//
// 対策として maplibregl.setWorkerUrl() で明示的にURLを教える。ただし
// maplibre-gl-worker.mjs 自身が同ディレクトリの maplibre-gl-shared.mjs を
// import しているため、Viteの `?url` インポート（ファイルをそのまま1個だけ
// コピーする）では依存先が欠けて壊れる。両ファイルをセットで
// public/maplibre/ にコピーし、node_modules内と同じ相対関係を保つ。
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, "..", "node_modules", "maplibre-gl", "dist");
const DEST_DIR = join(__dirname, "..", "public", "maplibre");

const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

mkdirSync(DEST_DIR, { recursive: true });

for (const file of FILES) {
  const src = join(SRC_DIR, file);
  if (!existsSync(src)) {
    console.error(`[copy-maplibre-worker] 見つかりません: ${src}`);
    process.exit(1);
  }
  copyFileSync(src, join(DEST_DIR, file));
  console.log(`[copy-maplibre-worker] ${file} をコピーしました`);
}
