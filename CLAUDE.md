# CLAUDE.md

このファイルは、このリポジトリで作業する Claude Code セッション（このセッション自身の将来の継続、および別セッション）向けの引き継ぎメモです。プロジェクトの目的や仕様は `README.md` を参照してください。ここには **コードから自明ではない設計判断・落とし穴・検証済み事実** のみを記録します。

## プロジェクトの正体

「Even G2 スマートグラス用の合唱歌詞プロンプター」だが、これは **ネイティブ iOS (Swift) アプリではない**。Even Realities の "Even Hub" プラットフォーム向けアプリで、実体は TypeScript/HTML の Web アプリ（`@evenrealities/even_hub_sdk` を使用）。Even Realities 公式スマホアプリがホストする WebView 内で動作し、`EvenAppBridge`（JS↔ネイティブの橋渡し）経由でグラス（G2）とリング型コントローラ（R1）にコンテナ（テキスト/リスト/画像）を描画・入力を受け取る。BLE 接続自体は Even Realities 公式アプリが握っており、このプロジェクトのコードが直接 Bluetooth を扱うことはない。

`npx degit even-realities/evenhub-templates/text-heavy` で得た公式テンプレートを土台にしている。テンプレート由来のパターン（`textContainerUpgrade` によるちらつきなしの更新、bridge 書き込みの直列化、イベントルーティングの実装）は意図的に踏襲しており、根拠なく変えていない。

## 確認済みの制約（ドキュメントより実装を優先して確認したもの）

- **ファイルシステム API は存在しない**。iOS の Files アプリ／ドキュメントピッカー／クリップボード API は SDK から提供されない（`pickImageFromAlbum()` による単一画像選択のみ）。そのため歌詞の取り込みは「URL から `fetch()` して同期・ローカルキャッシュ」という設計にした（ユーザーとの合意事項。変更する場合は要確認）。
- ただし **画面側（電話側）の通常の HTML `<textarea>`/`<input>` は SDK の制限と無関係に動く**（WKWebView 標準のテキスト編集機能なので、システムのコピー＆ペーストも通常通り使える）。
- `fetch()` は `app.json` の `permissions` に `network` パーミッションを宣言し、`whitelist` に完全な URL（オリジン）を列挙する必要がある。ワイルドカードやベアホスト名は不可。加えてブラウザ側の CORS 制約も別途かかる（`app.json` への追加は CORS を上書きしない）。GitHub の raw/Gist は CORS ヘッダを標準で返すため候補として推奨。
- `localStorage` は「バックグラウンド後も常に永続化される」とドキュメントで明言されている唯一のストレージ。IndexedDB/OPFS はクォータが「未規定・ベストエフォート」とされているため、曲ライブラリの永続化には `localStorage` を採用（`src/library.ts`）。
- グラスのテキストコンテナ：576×288px、LVGL の行高は固定 27px。`textContainerUpgrade` は最大 2000 文字、`createStartUpPageContainer`/`rebuildPageContainer` は各コンテナ最大 1000 文字。フォントは LVGL 内蔵の単一フォントのみで太字・斜体・見出し装飾は表示されない（`src/lyrics.ts` で Markdown 記法を除去している理由）。

## SDK バージョンに関する罠

テンプレートの `package.json` は `"@evenrealities/even_hub_sdk": "^0.0.10"` だったが、**npm の caret 仕様では major=minor=0 のとき `^0.0.10` は厳密に `0.0.10` にしか解決されない**（`0.0.11` 以降には上がらない）。このバージョンには `LONG_PRESS_EVENT` もコンテキストメニュー機能も存在しない（`OsEventTypeList` 列挙値を実際に `node_modules` の型定義で確認して判明）。

「曲の先頭に戻る」操作に長押しを使うため、`^0.0.14` へ明示的に引き上げ済み（`package.json`）。バージョンを変更する場合は、必ず `node_modules/@evenrealities/even_hub_sdk/dist/index.d.ts` の `OsEventTypeList` 列挙とエクスポート一覧を確認してから機能を使うこと。ドキュメント（hub.evenrealities.com）に書かれている機能が、実際にインストールされる SDK バージョンにまだ無いことがある。

## app.json スキーマの根拠

hub.evenrealities.com のドキュメントだけでなく、`node_modules/@evenrealities/evenhub-cli/main.js` にバンドルされている zod スキーマを直接 grep して仕様を確定させた（ドキュメントの要約だけでは `permissions` のキー名など誤りがあったため）。確定した仕様：

- `package_id`: 正規表現 `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$`（小文字英数字をドットで連結。ハイフン・アンダースコア不可）
- `version` / `min_app_version`: 厳密な `x.y.z` 形式
- `name`: 最大 20 文字
- `permissions`: 配列。判別ユニオンで、**`name`**（`type` ではない）フィールドが `"network"` のときのみ `whitelist: string[]`（省略可、既定 `[]`）を持てる。他の値（`g2-microphone` / `phone-microphone` / `album` / `location` / `camera`）は `name` と `desc` のみ。`desc` は必須・1〜300文字。
- `supported_languages`: `en, de, fr, es, it, zh, ja, ko` のいずれかのみ（小文字化される）

このスキーマは CLI のバリデータそのものなので、ドキュメントと食い違う場合は **常にこちらを信用してよい**。

## イベントルーティングの癖

`OsEventTypeList.CLICK_EVENT` は protobuf 上の値が `0` であり、protobuf はワイヤ上でゼロ値フィールドを省略する。そのため単純タップは `eventType: undefined` として届く。`src/performer.ts` の `eventTypeOf()` はこれを踏まえ、「エンベロープ（`sysEvent`/`textEvent`）自体が存在する場合に限り `undefined` を CLICK として扱う」という判定にしている（エンベロープが無い場合に CLICK 扱いすると、スクロールや終了イベントまで誤ってタップとして処理されてしまう）。

スクロール系イベント（`SCROLL_TOP_EVENT`/`SCROLL_BOTTOM_EVENT`）は `event.textEvent` 経由、タップ/ダブルタップ/システムライフサイクルは主に `event.sysEvent` 経由。`CLICK_EVENT`/`DOUBLE_CLICK_EVENT` は `sysEvent`・`textEvent` の両方をチェックする防御的な実装にしている（公式テンプレートの実装パターンを踏襲）。

**`spec.md` 対応でのリング操作の再割当て**（`src/performer.ts`）：

| イベント | 動作 |
|---|---|
| `CLICK_EVENT` | 次のデータへ（節内で画面に収まっていなければ次の表示ウィンドウへスクロール、収まっていれば次の節へ） |
| `SCROLL_TOP_EVENT`（UP） | 現在の UP/DOWN 単位で前の境界へジャンプ |
| `SCROLL_BOTTOM_EVENT`（DOWN） | 現在の UP/DOWN 単位で次の境界へジャンプ |
| `DOUBLE_CLICK_EVENT` | UP/DOWN の移動単位（練習番号／ページ番号／見出し2／見出し3）を選ぶ画面（グラス側）を開く |

`LONG_PRESS_EVENT` は使っていない（旧実装にあった「曲頭に戻る」機能は削除済み）。ユーザーの判断により、実機では長押しがシステムメニューに奪われてアプリに届かない可能性が高いとされたため。グラス側に終了操作は無く、電話画面の「終了してライブラリに戻る」ボタンが唯一の終了手段（`stop()` が `bridge.shutDownPageContainer(1)` を呼ぶ）。

**UP/DOWN の移動単位の選び方**（練習番号／ページ番号／見出し2／見出し3の4択）：スマホ側 `Settings.upDownMode`（`src/settings.ts`）は演奏開始時の**既定値**でしかない。実際にどの単位で移動するかは `performer.ts` の `startPerformance` 内のローカル変数 `upDownMode` が持ち、ダブルタップで開く画面（`openModePicker`/`renderPicker`/`movePicker`/`confirmPicker`）で選び直せる。この選択は Settings には書き戻さない（次回の演奏はまたスマホ側の既定値から始まる）。この画面は SDK 0.0.14 にある `ListContainerProperty`/`MenuContainerProperty`（選択状態を OS 側が持ってくれる本来の「リスト/メニュー」コンテナ）ではなく、既存の body/footer `TextContainer` に選択肢を素朴に描画し（選択行を `"> "` で示す）、CLICK/UP/DOWN を自前でハンドリングする実装にしている——理由は、List/Menu コンテナの選択イベントのスキーマ（`List_ItemEvent`/`MenuItemClickEvent`）をこのシミュレータに対して一度も検証しておらず、確実に動くと分かっている `textContainerUpgrade` の経路だけで実現できるため。グラス側曲選択（下記「コーディング方針」）で本格的にリスト/メニューコンテナが要る場合は、その時に改めて型定義とシミュレータ実機動作を確認すること。
「見出し3」は `src/lyrics.ts` が `### Title` をパースして作る `PhysicalLine.sectionIndex`（`###` に出会うたびに増えるだけの通し番号、曲全体で単調増加・楽章をまたいでもリセットしない）。`##`（見出し2/楽章）と違い専用のフッター表示枠が無いため、`###` の行自体は（`###` を取り除いた上で）本文にそのまま表示される — 見出し2のように本文から消えて別枠に回されるわけではない。

## crypto.randomUUID() の罠

`crypto.randomUUID()` はセキュアコンテキスト（HTTPS または localhost）でのみ利用可能。しかし公式ドキュメントに記載された開発時の動作確認フロー（QR コードでの実機サイドロード）は `http://<LANのIP>:5173` という非セキュアコンテキストでアプリを配信する。このため `src/library.ts` では `crypto.randomUUID()` ではなく、セキュアコンテキスト制限のない `crypto.getRandomValues()` で ID を生成している（`randomId()` 関数）。本番パッケージ（Even Hub 経由の HTTPS 配信）では問題にならないが、開発時のサイドロードテストで確実に動かすためにこの実装にしている。

## この開発環境での検証状況（重要・訂正あり）

**訂正**：以前このファイルには「サンドボックスに GUI がなく `evenhub-simulator` は実行できない」と書いていたが、これは誤り。このプロジェクトは Claude Code が **ユーザー本人の Mac（実デスクトップ環境）上で** 操作しており、`evenhub-simulator`（Tauri 製のネイティブ GUI アプリ）は普通に起動できる。`Bash` でバックグラウンド起動（`&` + `disown`）すれば、実際に glasses ウィンドウが立ち上がって動作する。

### シミュレータの自動化 API（スクリーンショット・入力送信）

`evenhub-simulator` は `--automation-port <PORT>` を付けて起動すると、ローカルに HTTP の自動化サーバーが立つ。**このエンドポイント群はどのドキュメントにも書かれていない**（バイナリを `strings` で解析して発見した）。動作確認に非常に有用なので記録しておく：

```bash
node_modules/.bin/evenhub-simulator http://localhost:<vite のポート> --automation-port 9898 &
```

| エンドポイント | 用途 |
|---|---|
| `GET /api/ping` | ヘルスチェック（`pong` を返す） |
| `GET /api/screenshot/glasses` | **グラス側表示（Glasses Display）の PNG スクリーンショットを返す**（576×288） |
| `GET /api/screenshot/webview` | 電話画面（companion webview）側のスクリーンショット |
| `GET /api/console` | ブラウザコンソールログを JSON で取得（`{"entries":[{id,level,message,ts}], "total"}`） |
| `POST /api/input` | グラス側の入力をシミュレート。body は `{"action": "..."}`。有効な action は **`up` / `down` / `click` / `double_click` の4つのみ**（`long_press` はこのシミュレータのバージョンでは非対応 — SDK 0.0.14 の `LONG_PRESS_EVENT` 自体はあるが、自動化 API がまだ追従していない） |

これにより、実機なしでも「実際にグラスに何が描画されるか」をスクリーンショットで確認でき、R1/タッチパッド操作もシミュレートできる。**次回以降このアプリの動作検証をする際は、まずこの自動化 API を使うこと。**

### 電話画面（webview）側 UI は見た目は確認できるが操作は自動化できない

**訂正**：以前このファイルには「自動化 API はグラス側の入力・スクリーンショットのみが対象」と書いていたが、これは不正確だった。`GET /api/screenshot/webview` で電話画面（companion webview）側のスクリーンショットも撮れる（上の表を参照）。自動化できないのは webview 内の**操作**（フォーム入力・ボタンクリックなど）だけで、`/api/input` はグラス側の `click`/`up`/`down`/`double_click` のみが対象。

見た目を検証したい場合は、`index.html` の `<script type="module" src="/src/main.ts">` の直前に一時的な `<script>` を挿入して `localStorage` に検証したい状態（曲一覧、同期エラー状態など）を直接シードする、または `src/main.ts` の初期 `view` を一時的にハードコードする方法が有効（どちらも `GET /api/screenshot/webview` で見た目を確認した後、必ず元に戻す）。

`src/ui.ts` のロジック（イベント委譲、フォームの送信処理など）そのものをコード外から動かして検証したい場合は、`startPerformance()` を直接呼び出す一時的なテストハーネス（`test-harness.html` + `src/test-harness.ts` を作って `index.html` の代わりにシミュレータへ読み込ませる）を作り、検証後に削除するのが有効（実際にこの方法で `src/performer.ts` の全ナビゲーション・境界値を検証した）。

### 実際に見つかった不具合とその修正

**セッション1（節ベースの旧実装時代）**：**ダブルタップでの終了後、`SYSTEM_EXIT_EVENT` がアプリ側に返ってこない。** `bridge.shutDownPageContainer(1)` を呼ぶとグラス側のコンテナは正しく消える（スクリーンショットで確認済み）が、その後シミュレータからコンソールに一切新しいイベントが来ない（`/api/console` の件数が増えない）。この問題は `spec.md` 対応でダブルタップ終了そのものを廃止したことで構造的に解消済み（電話側の「終了してライブラリに戻る」ボタンが唯一の終了経路になり、`stop()` がそこから直接 `shutDownPageContainer(1)` を呼ぶ）。

**セッション2（`spec.md` 対応：歌詞表示・リング操作の全面書き換え）**で新たに発見した不具合：

1. **`createStartUpPageContainer` に `textColor` を含めると、このシミュレータ（`evenhub-simulator` 0.7.2 相当）は `unknown field \`textColor\`` で `unhandledrejection` を起こし、コンテナ作成自体が失敗する。** SDK の型定義では `TextContainerProperty.textColor` は作成時に省略可能な正当なフィールド（省略時はデバイス既定の輝度4）とドキュメントされているが、このシミュレータの Rust 側デシリアライザが未対応（strict スキーマ）。**対策**：作成時の `TextContainerProperty` には `textColor` を含めず、直後の最初の `textContainerUpgrade` で輝度を設定する（`performer.ts` の `body`/`footer` 定義と `render()` を参照）。`textContainerUpgrade` 側は同じフィールドを問題なく受け付ける。
2. **フッターの右寄せ・中央寄せ用スペース詰めで、目標幅ぴったりに合わせようとすると1px でもオーバーすると末尾の文字がまるごと消える。** LVGL 側は行の許容幅を1pxでも超えると自動改行し、フッターコンテナの高さ（1行分強）では折り返した2行目がほぼ完全にクリップされるため、末尾の練習番号／ページ番号がごく小さい断片だけ見える状態になる（一見「文字化け」のように見えるが実際は改行によるクリップ）。**対策**：`pxToSpaces()` を `Math.round` ではなく常に切り捨て（`Math.floor`）にし、さらに `FOOTER_SAFETY_MARGIN_PX`（数px）だけ目標幅を狭める。1文字分未満のズレで済むトレードオフ。
3. **フッターコンテナの輝度だけを更新する `textContainerUpgrade`（`content` を省略）は安全に「内容はそのまま」にならない可能性がある。** 点滅演出の各ステップで `content` を毎回同送するように変更済み（`scheduleFooterBlink()`）。
4. **【未解決・シミュレータ固有の疑い】フッターコンテナの右端付近に、内容と無関係な細い縦棒状のアーティファクトが常に表示される。** 意図的に大きな余白（24px）を確保しても同じ位置付近に別要素として現れ続けたため、自分の合成文字列のオーバーフローではなくコンテナに紐づく別の描画要素（カーソル/インジケータ的なもの）だと判断した。ボディコンテナ（`isEventCapture:1`）側では同じ現象は見られない。原因はバイナリ解析までは追えておらず、実機で再現するかも不明。実害（文字が読めなくなる等）は無いため対応保留。次にフッター周りを触るセッションは、まずこれが解消しているか（シミュレータのバージョンアップ等で）確認すること。

### 検証済み・未検証の整理（セッション3: ダブルタップの移動単位選択 UI 追加時点）

検証済み（シミュレータ + 自動化 API のスクリーンショット・コンソールログで確認。`src/test-harness.ts`+`test-harness.html` を一時的に作成し、`parseSong`/`startPerformance` を直接叩いて検証、確認後に削除した）：
- 見出し2 (`## N. Title`) による楽章分割・楽章タイトルのフッター中央表示
- **見出し3 (`### Title`)**：`sectionIndex` が `###` に出会うたびに増え、行自体は（`###` を除いて）本文に残ること
- `<N>`/`[X]` の行頭マーカー解析（順不同・混在パターン含む）と、値がマーカー変更まで持続する挙動
- フッター：練習番号（左）・曲名（中央）・ページ番号（右）のスペース詰めによる寄せ、複数値にまたがる場合の `"start-end"` 表記
- **強制OFF判定**：曲全体でページ番号／練習番号が既定値のまま変化しない場合に、設定のON/OFFに関わらず非表示になること
- **表示ウィンドウのスライドアルゴリズム**：40行の段落で、実際の画面行数（このレイアウトでは `MAX_BODY_LINES=8`）に対して `(1-8)(8-15)(15-22)...` と1行オーバーラップで進み、末尾だけクランプで多めにオーバーラップすること（spec.md の16行/5行の例と同じ式で検算済み）を実機相当の描画で確認
- CLICK による節内スクロール送り／次ブロックへの遷移
- UP/DOWN（`practice` モード）による練習番号境界への前後ジャンプ
- **UP/DOWN（`heading2` モード）**：楽章境界へのジャンプ（間の楽章に `###` が無くても正しく次の楽章の先頭まで飛ぶこと）
- **UP/DOWN（`heading3` モード）**：`###` 境界への前後ジャンプ
- **DOUBLE_CLICK での移動単位選択画面**：開くと現在の単位にカーソルが立つこと、UP/DOWNでのカーソル移動とその上下端でのクランプ、CLICKでの確定（確定後は本文・フッターとも直前の表示に復元され、余計なフッター点滅が起きないこと）、選択画面表示中の2回目のDOUBLE_CLICKが無視されること
- フッター内容が変わった際の点滅トリガー（`footerChanged` 判定）
- 電話側「終了してライブラリに戻る」に相当する `handle.stop()` が `bridge.shutDownPageContainer(1)` を呼んでグラス側コンテナを実際に閉じ、正しい `lastPosition` で `onExit` を呼ぶこと
- `tsc --noEmit` / `vite build`

未検証（今後の課題）：
- **UP/DOWN の `page` モード**：`practice` モードと全く同じ関数（`findBoundary`）がフィールド違いで読むだけの対称的な実装のため個別のシミュレータ実行はしていない（コードレビューでの確認のみ）。
- **長押し**：spec.md がリング操作として定義しておらず、今回の実装でも使用していない（ユーザー判断：実機ではシステムメニューに奪われる可能性が高い）。
- **実機（G2 本体・R1 リング）** 固有の挙動：実際の BLE 遅延、タッチパッドの感度、輝度設定の見え方など。
- 上記「実際に見つかった不具合」4番のフッター右端アーティファクトの原因。

**電話画面側 UI の見た目は `GET /api/screenshot/webview` で確認可能**（グラス側だけでなくこちらもスクリーンショットが撮れる）。ボタンクリックやフォーム入力など webview 内の**操作**は自動化できないが、**見た目**は検証済み：曲一覧の空状態・同期済み/同期エラー状態の行、設定パネル（輝度スライダー・チェックボックス・UP/DOWNモード既定値の select（練習番号／ページ番号／見出し2／見出し3の4択））、演奏中画面（新しいリング操作ヘルプ文言・「終了してライブラリに戻る」ボタン）を、`index.html` に一時的な `localStorage` シード用 `<script>` を挿入する方法、および `main.ts` の初期 `view` を一時的に書き換える方法（どちらも確認後に元に戻す）でレンダリングさせて確認した。

**動作確認を報告する際は、上記のうちどこまで検証したかを具体的に伝えること**（「シミュレータで確認済み」と言うだけでなく、自動化 API で何を検証し、何が未検証かまで明示する）。

## 一次情報源の優先順位

ドキュメント（hub.evenrealities.com）とインストール済みパッケージの記述が食い違うことがある。矛盾したときは以下の優先順で判断すること：

1. `node_modules/@evenrealities/even_hub_sdk/dist/index.d.ts` — 実際の型・イベント列挙・API シグネチャ
2. `node_modules/@evenrealities/evenhub-cli/main.js` 内の zod スキーマ — `app.json` の正確な検証ルール（grep で該当箇所を探す。ファイル全体は難読化されているが、スキーマのリテラル文字列は平文で残っている）
3. `node_modules/@evenrealities/even_hub_sdk/README.md` — イベントルーティングなど型定義だけでは分からない挙動の説明
4. `hub.evenrealities.com/docs` — 上記と矛盾しない範囲でのみ参照

## 設計上の確定事項（ユーザーと合意済み。変更時は要確認）

- 歌詞の取り込み方法は **URL からの Markdown 取得＋ローカルキャッシュ**（貼り付け方式や単発表示ではない）。
- 1 タップ／1 スワイプで進める単位は **節・段落単位**（行単位でも全文自動スクロールでもない）。
- `spec.md`（歌詞表示・リング操作仕様）に基づき、**1 URL（ライブラリの1エントリ）が複数の楽章を含みうる**（`## N. Title` 見出し区切り）。主用途はマタイ受難曲やドイツ・レクイエムのような長大な曲を1ファイルで通し演奏すること（演奏会プログラム全体を1ファイルにまとめる用途にも使える）。楽章はライブラリ上の別エントリにはならず、演奏中にグラスのフッター中央（曲名欄）が自動で切り替わる。ライブラリ画面の曲名（フォーム入力）とはこの「現在の楽章タイトル」は別概念（見出しが無い曲・見出し前のコンテンツはライブラリの曲名にフォールバックする）。
- **グラス側に終了操作は無い**。DOUBLE_CLICK は（当初 spec.md にあった「直前スクロール方向へ10単位移動」から、セッション3で）UP/DOWN の移動単位選択画面を開く操作に再割当てされ、長押しは実機ではシステムメニューに奪われる可能性が高くアプリに機能を割り当てられないとユーザーが判断したため、どちらも終了操作に使わない。電話画面の「終了してライブラリに戻る」ボタンが唯一の終了手段であり、`performer.ts` の `stop()` はここから直接 `bridge.shutDownPageContainer(1)` を呼ぶ（旧実装はダブルタップ経由でのみこれを呼んでいた）。
- フッター（練習番号・曲名・ページ番号の情報表示行）は**単一の TextContainer**として実装し、内容が変わったら**行全体を1回ゆっくり点滅**させる設計にしている。spec.md は「変更された情報だけ」点滅するとも読めるが、`TextContainerUpgrade` に部分書式（リッチテキスト）は無く輝度はコンテナ単位でしか制御できない上、コンテナは作成後に再配置できない（`xPosition` は `TextContainerUpgrade` に無い）ため、3コンテナに分けて個別点滅・個別位置調整するのは実装・検証コストに見合わないと判断した簡略化。右寄せ・中央寄せの「計算で合わせる」自体は `pretext.getTextWidth`/`getAdvW` を使ったスペース詰めで実現している（`performer.ts` の `composeFooterLine`）。

## コーディング方針

- 素の TypeScript + Vite。React 等のフレームワークは意図的に不使用（この規模ではオーバーヘッドの方が大きいと判断）。
- UI（`src/ui.ts`）は DOM 文字列組み立て＋イベント委譲という単純なパターンに統一。フォームや行ごとに個別リスナーを貼らない。
- 曲選択は現状「電話画面のみ」（MVP）。グラス側でのリスト/メニューコンテナを使った曲切り替えは SDK 0.0.14 で利用可能（`ListContainerProperty`, `MenuContainerProperty` 等がエクスポートされている）だが、選択イベントの正確なスキーマは型定義から未確認のため未実装。将来追加する場合は型定義を先に確認すること。

## よく使うコマンド

```bash
npm run dev       # Vite 開発サーバー
npm run build     # tsc --noEmit + vite build（型チェック含む）
npm run simulate  # デスクトップシミュレータ起動（GUI 必須）
npm run pack      # evenhub pack app.json dist（配布用パッケージング。バージョン管理なし）
npm run release   # scripts/release.sh — バージョン付き .ehpk を releases/ に出力（下記手順のステップ1〜2に相当）
```

## Even Hub プライベートビルド登録手順

`npm run pack` だけでは `.ehpk` を作るところまでしかできない。**アップロードは Web ポータル、インストールはスマホアプリ側の操作で、どちらも CLI 化はできない**（`evenhub-cli` に publish/upload 相当のコマンドは存在しないことを `--help` とバンドル内文字列の両方で確認済み。`node_modules/@evenrealities/evenhub-cli/README.md` にも "upload it through the EvenHub site" とだけ書かれている）。この事実は hub.evenrealities.com/docs（`/docs/test/private-testing`）でも確認済み。

**初回のみ**：Even Hub のアカウントは **Even Realities 公式スマホアプリの中で作成する**（Web ポータル単体にはサインアップ機能が無い）。作成したアカウントで https://hub.evenrealities.com/login からも同じ認証情報でサインインできる。

再登録のたびに行う手順：

1. **`app.json` の `version` を上げる**（セマンティックバージョニング、`x.y.z`）。Even Hub は同じバージョンの再アップロードを想定していない。上げ忘れると `npm run release` が「既に同名ファイルがある」で止まる（安全装置）。
2. **`npm run release`** を実行する（`scripts/release.sh`）。内部で `npm run build` → `evenhub pack app.json dist -o releases/chorus-prompter-vX.Y.Z.ehpk --sdk-ver <package.jsonのSDKバージョン>` を行う。
   - `--sdk-ver` を明示しているのは、指定を省略すると CLI が **npm 上の最新 SDK** を基準に `min_app_version` を自動導出してしまい、SDK を上げていないのに実行結果が変わる（再現性が無い）ため。必ず `package.json` の `@evenrealities/even_hub_sdk` の実際のバージョンに固定する。
   - `releases/*.ehpk` は `.gitignore` 済み（配布物であり、ソースではないためコミットしない）。
3. **https://hub.evenrealities.com/login でサインイン → このアプリのプロジェクトを開く → 「Private builds」タブ → 生成された `.ehpk` をアップロード**（Webブラウザでの手動操作）。
4. **スマホの Even Realities アプリ → 「Even Hub」タブ（Developer Mode）→ Me → Apps → Private builds** から該当バージョンを見つけて **Install**（スマホでの手動操作）。

**わかっている制約・未確認の点**：
- `package_id`（`app.json` の `com.igarashi.chorusprompter`）は一度登録すると変更できない（別 ID にすると別アプリ扱いになる）。
- Draft/Test/Submitted/Released というステータス遷移がストア公開には存在するらしいが、**プライベートビルドとしてインストールするだけならこの審査フローを通らない**という前提で手順を組んでいる（`README.md` の記載・`evenhub pack` の登場文脈と整合）。実際に Store 提出まで行う場合は `/docs/ship/app-submission` を別途確認すること。
- Web ポータル（`https://evenhub.evenrealities.com`／`hub.evenrealities.com/login`）の実際の画面遷移・ボタン名は、このセッションでは実際にログインして確認したわけではなく、公式ドキュメントの記述をそのまま採用している。**初回登録時に画面が説明と違っていたら、実際の画面の方を正としてこの手順を更新すること。**
- `min_app_version` は SDK 0.0.14 の実際の要件に合わせて `2.2.9` に修正済み（旧 `app.json` は `2.0.0` のままになっており、`evenhub pack` 実行時に「SDK floor 2.2.9 の方が高いので差し替える」という警告が出ていた — SDK バージョンを上げる作業のときに追従し忘れていたもの）。
