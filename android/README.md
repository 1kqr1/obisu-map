# 山口 きょうの取締り（Androidウィジェット）

山口県限定で、日本時間の今日の取締り予定をホーム画面に表示する個人作成の非公式アプリ。
Android 12以降に対応し、Galaxy S24を想定する。位置情報・連絡先の権限やログインは使用しない。

## 配布・インストール

GitHub Releasesの `android-v1.0.0` に、署名付き `yamaguchi-today-1.0.0.apk` とSHA-256を配置する。
友人にはリリースページまたはAPKのダウンロードリンクを共有する。

1. Android端末でAPKをダウンロードし、開いてインストールする。
2. 「山口 きょうの取締り」を開く。
3. 「ホーム画面にウィジェットを追加」を押す。
4. Android側の追加確認を完了する。

ホーム画面を長押しし、「ウィジェット」から追加することもできる。
外部APKのインストールが端末の設定で制限されている場合は、端末が示す案内を確認する。
Playストアでの配布は別途開発者登録と公開手続きが必要。

## 表示・更新

- HP計画と公式Xの追加情報を統合し、重複を除く。
- 前日夜から続く今日0〜6時の予定も表示する。
- 出典リンクは山口県警HPと公式Xに限定する。
- 初回は同梱した公表情報を使い、公開サイトのJSONで更新する。
- 今日の日付は常にAsia/Tokyoで判定し、昨日の一覧を今日として表示しない。
- HPの今日の計画がない場合は「未取得」と表示する。情報がないことを「取締りなし」としない。
- 約30分ごとの更新をJobSchedulerで試みる。Androidの省電力設定などにより遅延するため、更新ボタンも備える。
- 通信失敗時は前回のデータを保持し、端末の最終確認時刻と通信エラーを表示する。
- Xは現在API設定待ち。確認済み投稿であることを画面に明示する。

共通フィード：`https://orbis.1kqr1.com/data/widget_yamaguchi.json`

共通フィードは `scripts/build_widget_feed.py` が生成する。将来のiPhone WidgetKitからも同じデータを使用できる。

## ビルド・署名

`.github/workflows/android-widget.yml` でビルド、Javaのユニットテスト、Android Lint、API 35エミュレータ上のアプリ・AppWidgetHost表示テストを実行する。すべて成功した場合だけ配布する。

署名鍵はリポジトリに含めず、所有者PCの保護された保存先とGitHub Secretsで管理する。
`ANDROID_SIGNING_KEYSTORE`（base64）と `ANDROID_KEYSTORE_PASSWORD` をCIで利用する。
同じ署名鍵を継続使用することで、友人の端末に上書き更新できる。
バージョン更新時には `app/build.gradle` の `versionCode` と `versionName` を更新する。

ローカルでAndroid SDKとJDK 17を用意した場合は、Gradle 8.13で次を実行する。

```sh
gradle -p android testDebugUnitTest lintRelease assembleDebug
```

Galaxy S24実機、Android 12〜14実機での検証は未実施。エミュレータ上の検証と実機検証は区別する。

## iPhone対応の方針

ウィジェット表示部分をSwiftUI / WidgetKitで実装し、このJSONフィードを共用する。
友人へのテスト配布はTestFlight、継続的な一般配布はApp Storeを想定。
iPhone版はまだ実装していない。
