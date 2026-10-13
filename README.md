# オービス情報集約Webアプリ

山口県・長崎県・大分県の速度取締り装置（オービス）情報を、公開されている各県警サイトのHTML/PDF/CSVから収集・構造化し、地図で確認できるようにする個人用Webアプリ。

**公開URL: https://1kqr1.github.io/obisu-map/**

要件・背景・データモデル・調査記録の全体は [requirements.md](./requirements.md) を参照。

## 現在の状況（Phase 5: Should要件 一部完了）

- [x] Phase 0: 山口県分の事前調査（データソースの実在性・粒度・利用規約の確認）
- [x] Phase 1〜3: 山口県のデータパイプライン・地図表示・ルート検索
- [x] Phase 4: 九州北部の実データ調査 → 福岡県・佐賀県は対象外と確定（公式サイトに構造化データなし、SNSが主な告知手段のため）。長崎県（区間ベース）・大分県（点ベース、CSV+ジオコーディング）を実装
- [x] フロントエンド（地図表示・ルート検索・フィルタ、`frontend/`）
- [x] GitHub Pagesへのデプロイ（`.github/workflows/deploy-pages.yml`）
- [x] 3県データの日次自動取得（`.github/workflows/scrape-{yamaguchi,nagasaki,oita}.yml`）
- [x] FR-05（種別・県フィルタ）、FR-13（経路順ソート）
- [ ] 固定式オービスの実データ（DS-4手動収集）。現状 `fixed_cameras.json` は空
- [ ] FR-06（クラスタリング）・FR-14（到達距離）・FR-15（経由地追加）などCould要件

## セットアップ

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## データ取得の実行

県ごとに独立したスクリプト（1県の失敗が他県に影響しないようにするため）。

```bash
python scripts/scrape_yamaguchi.py   # → data/processed/yamaguchi_enforcement_raw.json（区間ベース）
python scripts/scrape_yamaguchi_x.py # → data/processed/yamaguchi_x_information.json（公式Xの追加情報）
python scripts/scrape_nagasaki.py    # → data/processed/nagasaki_enforcement_raw.json（区間ベース）
python scripts/scrape_oita.py        # → data/processed/oita_enforcement_points.json（点ベース、ジオコーディング込み）
```

ローカルの取得済みファイルで検証する場合:

```bash
python scripts/scrape_yamaguchi.py --local-pdf tests/fixtures/yamaguchi_sample_202608_late.pdf
python scripts/scrape_yamaguchi_x.py --local-posts data/manual/yamaguchi_x_verified_20261013.json
python scripts/scrape_oita.py --local-csv tests/fixtures/oita_sample_202608_early.csv tests/fixtures/oita_sample_202608_late.csv
python scripts/scrape_nagasaki.py --local-html /path/to/saved.html
```

## 区間ジオメトリの生成（山口県・長崎県）

```bash
python scripts/build_segments.py --prefecture yamaguchi --additional-schedules data/processed/yamaguchi_x_information.json
python scripts/build_segments.py --prefecture nagasaki
```

OSM上の国道ライン × 市区町村行政界（`data/manual/police_station_jurisdiction_<prefecture>.json`）の交差から、
取締り区間のジオメトリを `data/processed/enforcement_segments_<prefecture>.json` に出力する。
道路網・行政界はほぼ変化しないため、対応表を更新した時のみ再実行すればよい。
大分県は住所ベースのジオコーディングを使うため、この処理は不要（`scrape_oita.py`内で完結）。

## フロントエンドの開発

```bash
cd frontend
npm install
npm run dev
```

`data/processed/*.json` を `frontend/public/data/` にコピーしてから起動する（`predev`/`prebuild` npm script）。
デプロイは `main` への push で GitHub Actions が自動的にビルド・公開する。

## 重要な注意

- Android向けに「山口 きょうの取締り」ホーム画面ウィジェットを追加。山口県限定・日本時間の今日の予定を表示する。配布とインストールの案内は [android/README.md](./android/README.md)。iPhone版でも利用できる共通フィードは `data/processed/widget_yamaguchi.json`。

- 山口県はHPを基本データにし、公式Xの速度取締り本文、可搬式オービスの市内予告、飲酒運転強化日を補足する。重複した予定は1件にまとめ、HPにのみある予定は保持する。市内予告を特定地点・特定国道に変換しない。解析できない取締り投稿も原文とリンクを追加情報欄に表示する。添付画像・動画のOCRは未実装。
- X自動取得にはGitHubの **Settings → Secrets and variables → Actions** に `X_BEARER_TOKEN` の設定が必要。現在は未設定のため、2026-10-13に確認した16投稿（速度取締り14投稿、可搬式オービス1投稿、飲酒運転1投稿）の転記データを表示する。認証情報はPython取得処理だけで使用し、フロントエンド・リポジトリへ保存しない。
- X公式APIは従量課金。[公式仕様](https://docs.x.com/x-api/users/get-posts)に従いユーザーの投稿を取得し、初回は直近30日、以降は成功時の投稿ID以降をページングする。未設定時は取得せず、APIエラー・部分エラー・ページ上限時は既存データとカーソルを保持する。APIを実際に呼び出す検証は未実施。HP/Xの取得は06:00・18:15 JST、成功後にPagesを再ビルドする。

- 可搬式オービスの「取締り予定」の粒度は**県ごとに全く異なる**。山口県・長崎県は住所を含まず路線区間ハイライトで表現し、大分県は町丁レベルの住所がありジオコーディングした点で表現する。詳細は requirements.md 11.5/11.6節。
- 福岡県・佐賀県は公式サイトに構造化データがなく、主な告知手段がX（Twitter）であるため、データ収集の対象外としている（プロジェクト方針としてSNSスクレイピングは行わない）。
- 本アプリは取締り回避ではなく安全運転支援を目的とする。
