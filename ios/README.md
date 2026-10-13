# 山口県警取り締まり情報 — iPhone（Scriptable版）

Apple Developer Programへ登録せず使える、Scriptableのホーム画面ウィジェット。専用のiOSアプリではなく、無料のScriptableアプリに追加するスクリプトです。

## 友人への配布

この案内ページを共有します: https://orbis.1kqr1.com/iphone/

1. ScriptableをApp Storeからインストールする。
2. 案内ページの「ウィジェット用コードをコピー」を押す。
3. Scriptableの＋で新しいスクリプトを作り、全文を貼り付ける。
4. 「山口県警取り締まり情報」という名前で保存し、▶でプレビューする。
5. ホーム画面にScriptableウィジェットを追加し、編集画面のScriptで上のスクリプトを選ぶ。

小は最大2件、中は2列4件、大は2列8件まで。幅375pt未満の端末では小1件・中2件に減らし、列幅も縮める。取得範囲の注意が必要な場合は行を減らす。小サイズは全体で地図へ、その他サイズは行から原情報へ、↻でScriptableを開いて再取得・プレビューできる。更新時刻はiOSによるため、Androidと同じ30分間隔を保証しない。自由な伸縮ではなくiPhoneの小・中・大のサイズを選ぶ。

## データ・表示

- Androidと同じ `https://orbis.1kqr1.com/data/widget_yamaguchi.json` を取得する。フィードschemaは変更しない。
- 日本時間の当日だけを選ぶ。前日の夜間から続く0〜6時のレコードも共通フィードに含まれる。
- 🚨=予定時間内、予定=開始前、終=予定時間終了、告=時間未公表。実施を確認した表示ではない。
- 予定時間内、開始前、時刻未公表、終了の順。国道番号を推測しない。
- `Color.dynamic`でライト/ダークに対応。44pt行と30ptバッジを使用。文字は11pt以上。
- 通信失敗時は検証済みの前回データをローカルに保存して再利用。今日の取得範囲を確認し、「未取得」と「公表予定なし」を区別する。
- 30分後、または次の0/6/18時を再取得の希望時刻として指定する。指定時刻に実行される保証はない。
- 位置情報・連絡先・写真・ログインを使わない。県警HP/公式X以外の出典URLは地図へ戻す。

## 開発・検証

正本: `scriptable/YamaguchiWidget.js`。フロントエンドのビルド前に `scripts/copy-iphone-widget.mjs` がバージョン付き配布ファイルとSHA-256を生成する。旧版の配布ファイルは残し、コードを無断で実行・自動更新しない。

```sh
node --test ios/scriptable/tests/*.test.mjs
npm --prefix frontend run build
```

Nodeで日付境界、並び順、キャッシュ、通信失敗と全サイズのScriptable API呼び出しを検証する。Node上のAPIテストはiPhone実機での表示確認とは別。iPhone/Scriptable実機では未確認なので、導入後に実際の画面とタップ動作を確認する。

参考: [Scriptable](https://apps.apple.com/jp/app/scriptable/id1405459188)、[ウィジェット](https://docs.scriptable.app/listwidget/)、[ダークモードの色](https://docs.scriptable.app/color/)、[WidgetStack](https://docs.scriptable.app/widgetstack/)。

専用アプリ版/WidgetKit/TestFlightは今回の対象外。将来は同じフィードを再利用できる。
