# オービス情報集約Webアプリ

山口県・九州北部の速度取締り装置（オービス）情報を、公開されている各県警サイトのHTML/PDFから収集・構造化し、地図で確認できるようにする個人用Webアプリ。

**公開URL: https://1kqr1.github.io/obisu-map/**

要件・背景・データモデル・Phase 0調査結果の全体は [requirements.md](./requirements.md) を参照。

## 現在の状況（Phase 1: 山口県データパイプライン構築 ほぼ完了）

- [x] Phase 0: 山口県分の事前調査（データソースの実在性・粒度・利用規約の確認）
- [x] 山口県警「速度取締り計画」PDFのスクレイパー・パーサー（`scripts/scrape_yamaguchi.py`）
- [x] 警察署管轄 → 市区町村 対応表の作成（I-7、`data/manual/police_station_jurisdiction.json`）
- [x] OSM国道ライン × 市区町村境界による区間ジオメトリ生成（`scripts/build_segments.py`）
- [x] フロントエンド（地図表示・ルート検索、`frontend/`）
- [x] GitHub Pagesへのデプロイ（`.github/workflows/deploy-pages.yml`）
- [x] 山口県データの日次自動取得（`.github/workflows/scrape-yamaguchi.yml`、毎日6:00 JST）
- [ ] 固定式オービスの実データ（DS-4手動収集）。現状 `fixed_cameras.json` は空
- [ ] 九州北部への対象拡大（Phase 4）

## セットアップ

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## データ取得の実行

```bash
# 実サイトから取得
python scripts/scrape_yamaguchi.py

# ローカルPDFで検証（ネットワークアクセスなし）
python scripts/scrape_yamaguchi.py --local-pdf tests/fixtures/yamaguchi_sample_202608_late.pdf
```

出力: `data/processed/yamaguchi_enforcement_raw.json`

## 区間ジオメトリの生成

```bash
python scripts/build_segments.py
```

OSM上の国道ライン × 市区町村行政界（`data/manual/police_station_jurisdiction.json`）の交差から、
取締り区間のジオメトリを `data/processed/enforcement_segments.json` に出力する。
道路網・行政界はほぼ変化しないため、対応表を更新した時のみ再実行すればよい
（`yamaguchi_enforcement_raw.json` の `segment_id` から参照される）。

## フロントエンドの開発

```bash
cd frontend
npm install
npm run dev
```

`data/processed/*.json` を `frontend/public/data/` にコピーしてから起動する（`predev`/`prebuild` npm script）。
デプロイは `main` への push で GitHub Actions が自動的にビルド・公開する。

## 重要な注意

- 可搬式オービスの「取締り予定」は、山口県警のデータ上は**住所を含まない**（国道番号×実施警察署管轄×日時のみ）。地図表現は点マーカーではなく路線区間ハイライトを採用する。詳細は requirements.md 11.5節。
- 本アプリは取締り回避ではなく安全運転支援を目的とする。
