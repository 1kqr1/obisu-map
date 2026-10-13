// data/processed/*.json をフロントエンドの public/data/ にコピーする。
// リポジトリ全体の唯一の正データ (data/processed/) を単一ソースとして保ち、
// フロントエンドはビルド前にそこから複製するだけにする。
import { copyFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SRC_DIR = join(REPO_ROOT, "data", "processed");
const DEST_DIR = join(__dirname, "..", "public", "data");

const FILES = [
  "enforcement_segments_yamaguchi.json",
  "yamaguchi_enforcement_raw.json",
  "yamaguchi_x_information.json",
  "widget_yamaguchi.json",
  "yamaguchi_label_anchors.json",
  "fixed_cameras.json",
];

mkdirSync(DEST_DIR, { recursive: true });
// 旧ビルドの他県ファイルがpublicに残っていても配信しない。
for (const file of ["enforcement_segments_nagasaki.json", "nagasaki_enforcement_raw.json", "oita_enforcement_points.json"]) {
  rmSync(join(DEST_DIR, file), { force: true });
}

for (const file of FILES) {
  const src = join(SRC_DIR, file);
  if (!existsSync(src)) {
    console.error(`[copy-data] 見つかりません: ${src}`);
    process.exit(1);
  }
  copyFileSync(src, join(DEST_DIR, file));
  console.log(`[copy-data] ${file} をコピーしました`);
}
