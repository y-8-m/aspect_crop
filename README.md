# Aspect Crop

縦横比を固定して、必要な範囲だけを素早く切り抜くためのmacOS向け画像クロップツールです。

日本語 / English のUIに対応しています。

## 開発背景

画像を決まったアスペクト比に整えて保存したいだけなのに、既存の画像編集アプリでは操作が用途に対して大きすぎたり、固定比率での位置調整がしづらかったり、保存時に意図しない画像形式へ変換されることがありました。

そこで、

- 固定アスペクト比で切り抜く
- 枠を動かして構図を調整する
- 必要ならピクセル単位でサイズを指定する
- 結果を確認する
- 指定した形式で保存する

という一連の操作だけを、できるだけ少ない手順で行えるツールとして開発しました。

多機能な画像編集ソフトを目指すのではなく、**固定アスペクト比でのクロップ作業に必要な機能だけを持つ小さなデスクトップユーティリティ**を目標としています。

## 主な機能

- 固定アスペクト比でのクロップ
- 横向き / 縦向きの切り替え
- カスタムアスペクト比の追加・並べ替え・削除
- クロップ枠のドラッグ移動
- アスペクト比を維持したリサイズ
- ピクセル単位でのクロップサイズ指定
- クロップ結果のプレビュー
- 全体表示〜100%の表示倍率変更
- PNG / JPEG / WebP / BMPへの出力
- 元画像形式を維持した保存
- 保存ダイアログの初期フォルダ設定
- 複数画像を別ウィンドウで開くデスクトップ動作
- ウィンドウへのドラッグ＆ドロップ
- Dock / 起動時の画像ファイル受け取り
- 日本語 / English UI

## 基本の使い方

1. **画像を開く**ボタンから画像を選ぶか、ウィンドウへ画像ファイルをドロップします。
2. **アスペクト比**を選び、必要に応じて横向き / 縦向きを切り替えます。
3. クロップ枠をドラッグして位置を調整し、ハンドルをドラッグしてサイズを変更します。
4. 必要であれば、**クロップサイズ**へ幅・高さを入力してピクセル単位で指定します。
5. **プレビュー**で切り抜き後の画像を確認します。
6. **クロップ画像を保存**から保存先とファイル名を指定します。

保存時は元画像のピクセル座標を基準に切り抜きます。

表示倍率は編集画面上の見え方だけに影響し、保存されるクロップ範囲や出力サイズには影響しません。

デスクトップ版で複数画像を選択またはドロップした場合、それぞれを別ウィンドウで開きます。

## クロップ枠の操作

| 操作 | 動作 |
| --- | --- |
| 枠の内側をドラッグ | クロップ枠を移動 |
| ハンドルをドラッグ | 縦横比を維持してサイズ変更 |
| 幅・高さを入力 | 選択中の縦横比を維持してサイズ指定 |
| 矢印キー | 元画像上で1px単位で移動 |
| Shift + 矢印キー | 元画像上で10px単位で移動 |
| 画像上でマウスホイール | クロップ枠を中心から拡大・縮小 |
| + / − キー | クロップ枠を中心から拡大・縮小 |
| Esc | プレビュー / 設定を閉じる |

キーボード操作は、入力欄などを編集中でない場合に使用できます。

マウスホイールや `+` / `−` は**クロップ枠そのもののサイズ**を変更します。画面の表示倍率は別のズームコントロールから変更します。

## 表示倍率

クロップ画面とプレビュー画面には、それぞれ独立した表示倍率コントロールがあります。

表示範囲は**全体表示〜100%**です。

- **全体表示**  
  画像全体が表示領域に収まる倍率です。小さな画像を100%より大きく拡大することはありません。

- **100%**  
  元画像を等倍相当で確認するための表示です。

- 画像が表示領域を超えた場合のみスクロールできます。
- 元画像を100%で全体表示できる場合は、倍率を100%に固定し、スライダーは操作不要な状態になります。

クロップ画面とプレビュー画面の倍率は共有しないため、たとえばクロップ画面では全体を確認しつつ、プレビューでは100%で細部を確認できます。

## アスペクト比

標準のアスペクト比に加えて、任意の比率を登録できます。

カスタム比率は設定画面から追加でき、保存済みの比率は並べ替え・削除できます。

たとえば、

```text
幅 4 : 高さ 5
```

と入力すると `4:5` として登録されます。

比率は画像のピクセル数ではなく、幅と高さの割合として扱います。

## 保存形式

設定画面から、保存時の出力形式を選択できます。

| 選択肢 | 保存方法 |
| --- | --- |
| 元画像と同じ | 元画像と同じ形式で保存 |
| PNG（可逆） | PNGで保存 |
| JPEG（最高品質） | JPEGで保存 |
| WebP（可逆） | 可逆WebPで保存 |
| BMP（可逆） | BMPで保存 |

静止GIFをGIFのまま保存する場合は、**元画像と同じ**を選択します。

クロップ処理は元画像座標を使用し、表示倍率に応じた画像の再縮小・再拡大は行いません。

## 保存ダイアログの初期フォルダ

保存ダイアログを開いた際の初期フォルダを設定できます。

- **元画像と同じフォルダ**  
  元画像の保存されているフォルダから開始します。

- **前回保存したフォルダ**  
  最後に正常保存したファイルのフォルダから開始します。

- **指定したフォルダ**  
  任意の固定フォルダから開始します。

この設定は保存先を自動決定するものではありません。

保存ダイアログを最初に開く位置だけを決めるため、保存時には自由に別のフォルダへ移動できます。

前回保存先が未記録または利用できない場合は、

```text
指定フォルダ
↓
元画像と同じフォルダ
↓
OS側の既定位置
```

の順でフォールバックします。

指定フォルダが利用できない場合は、元画像と同じフォルダへフォールバックします。

## 対応画像

入力：

- PNG
- JPEG
- WebP
- GIF
- BMP

静止画像のみを対象としています。

以下のアニメーション画像には対応していません。

- GIFアニメーション
- Animated WebP
- APNG

## 言語

UIは以下に対応しています。

- 日本語
- English

初回起動時はOS / ブラウザの言語を参照し、日本語環境では日本語、それ以外ではEnglishを使用します。

設定画面で言語を変更した場合は、その設定を保存し、次回起動時にも使用します。

## 実装上の方針

### 元画像座標と表示座標を分離

クロップ範囲は元画像のピクセル座標として保持しています。

表示倍率は画面上の描画にのみ適用し、

```text
元画像座標
↓
表示倍率を適用
↓
画面上の座標
```

として扱います。

そのため、表示倍率を変更してもクロップ位置や出力サイズは変化しません。

### クロップ値の検証

保存処理では、Rust側でもクロップ範囲を検証しています。

画像範囲外の座標を受け取った場合に値を自動補正して保存するのではなく、不正なクロップ値として処理を中断します。

これにより、フロントエンド側の座標計算に不整合が発生した場合でも、別の範囲を意図せず保存してしまうことを防いでいます。

### デスクトップ / ブラウザ処理の分離

デスクトップ版ではTauriを通して、

- ファイル選択
- ファイル読み込み
- 保存ダイアログ
- ネイティブ画像保存
- 複数ウィンドウ

などを扱います。

ブラウザ実行時にもUIを確認できるようにしており、ブラウザ版では1画像ずつの読み込みとPNG / JPEGのダウンロード保存に対応しています。

## 技術構成

- TypeScript
- Vite
- Tauri
- Rust
- `image` crate
- HTML / CSS

UIとクロップ操作はTypeScript側で管理し、デスクトップ環境でのファイル処理や画像の保存処理はTauri / Rust側と連携しています。

## 開発環境

macOSでの開発には以下が必要です。

- Node.js / npm
- Rust / Cargo
- Xcode Command Line Tools

依存関係をインストールします。

```bash
npm install
```

デスクトップ版を開発起動します。

```bash
npm run tauri -- dev
```

開発起動時は、利用可能なViteポートを自動選択します。

ブラウザ上でUIを確認する場合：

```bash
npm run dev
```

## テスト

TypeScript側：

```bash
npm test
```

Rust側：

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

現在、表示倍率・元画像座標との変換、保存先フォルダの選択・フォールバック、保存結果の記録、Rust側のクロップ値検証などをテストしています。

## ビルド

フロントエンドの型チェックとビルド：

```bash
npm run build
```

macOS向けデスクトップアプリのビルド：

```bash
npm run tauri -- build
```

Tauriのbundle設定を有効にしているため、macOSでは `.app` bundleを生成できます。

アプリ名は **Aspect Crop**、bundle identifierは以下です。

```text
com.y8m.aspectcrop
```

## アプリアイコン

アプリアイコンの元データは以下に保存しています。

```text
src-tauri/icons/Aspect_Crop.icon
```

Tauriで使用するPNG・ICNS・ICOも `src-tauri/icons/` に配置しています。

macOS向けアプリでは `icon.icns` をbundleアイコンとして使用します。

## 現在の状態

現在は個人利用を前提としたmacOS向けツールとして開発しています。

主要機能の実装、テスト、アプリアイコン、bundle設定、macOS向け `.app` の生成および実機での起動確認まで完了しています。
## Batch crop

Switch **Single | Batch** in the toolbar. Single keeps its own image, crop and aspect selection when switching modes.

Batch is available in the Tauri desktop app. Select multiple files or select a folder (only supported files directly inside it are scanned). Validation runs sequentially; the first successfully decoded, non-animated image establishes the reference dimensions. Matching images start included. Different-size and unreadable images remain inspectable in the batch metadata but cannot be included.

Use the existing aspect presets, orientation, custom ratios, drag/resize and pixel-size controls to define **one shared source-pixel rectangle**. Browse with the previous/next buttons or left/right keys, and toggle inclusion with the checkbox or Space. Text fields, selects and open settings/preview dialogs retain their normal keyboard behavior. Different-size previews are read-only; they never rescale or change the shared rectangle.

The suggested output directory is `cropped` beneath the input directory. Choose an output directory and a collision policy (rename, skip or overwrite) before running. Format follows the existing output-format setting; “same” preserves filenames including their extension. The confirmation shows the included count, rectangle, aspect, output directory, format and collision policy. Input directories are rejected as output directories. Source images are never overwritten.

The Rust worker validates and processes images one at a time, rechecking dimensions before cropping. Progress is emitted to the initiating window. File errors are recorded and processing continues; output-directory setup failures stop the run. The expandable results show per-file status and errors. Output is encoded to a temporary file before publishing it, protecting existing files from encoder failures. The image list stores metadata only; previews are loaded on demand without a thumbnail cache.

### Verification

- `npm test`: existing save-folder, language and zoom coverage plus batch classification, inclusion, counts, targets and navigation tests.
- `npm run build`: TypeScript and production bundle.
- `cargo test --manifest-path src-tauri/Cargo.toml`: existing crop/save-folder tests plus batch folder scan, exact output pixels, sequential progress, per-file errors, collision policies, format/name preservation and input protection.
- Browser smoke check: Single loading, aspect/pixel size, zoom, crop preview, PNG download, and mode round trip; Batch UI exercised with mocked Tauri IPC for folder input, arrows/Space, mismatch exclusion, editable-field key handling, confirmation payload and results. Actual image I/O is covered by Rust tests. Native OS dialogs and a several-thousand-image workload still need a desktop acceptance run.


### WebP ロスレス圧縮

デスクトップ版の共通出力設定で「高速 / 標準 / サイズ優先」を選べます。すべてロスレスで、画質差はありません。透明部分のRGBを含めて画素を保持し、変わるのは処理時間とファイルサイズのバランスだけです。サイズ優先ほど保存に時間がかかりますが、画像によってサイズの差や大小関係は変わります。

初期値は「標準」。`aspect-crop.webp-compression-preset` に保存され、再起動後も維持されます。Single / Batch共通で、「元画像と同じ」でWebPを保存するときにも適用されます。混在Batchの他形式には影響しません。ブラウザプレビューではこの設定は使用できません。

内部実装は `webp 0.3.1`（default features無効）と `libwebp-sys 0.9.6`。Singleのパス／メモリ保存とBatchは `save_dynamic_image` から同じエンコーダを使用します。全プリセットで `lossless=1`, `near_lossless=100`, `exact=1`。libwebpのlossless時のqualityは探索量であり、画質設定ではありません。

| プリセット | quality（探索量） | method |
| --- | ---: | ---: |
| 高速 / fast | 20 | 0 |
| 標準 / balanced | 75 | 4 |
| サイズ優先 / smallest | 100 | 6 |

追加依存は `webp`, `libwebp-sys`, `jobserver`。libwebpは同梱Cソースから静的ビルドされ、Cコンパイラが必要ですが、別途libwebpのインストールやCMakeは不要です。macOSでビルド・テスト確認済み。bindingのビルド処理はWindows MSVCにも対応していますが、Windows実機ビルドは未確認です。Tauriの依存指定 `1.6` は変更していません（現行lockは1.8.3）。

Rust要件には既存の不一致があります。Cargo.tomlの宣言は1.70ですが、現行lockの `image 0.25.10` は1.88以上が必要です。追加された `jobserver 0.1.35` は1.85以上を要求するため、既存lockの実質要件は上がりません。今回の検証はRust 1.93.1で実施し、1.70互換性は保証しません。

開発用比較（1024×768の決定的な合成UI fixture：パネル、文字風ストローク、イラスト、テクスチャ付きグラデーション）：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features webp_comparison -- --ignored --nocapture
```

macOS / debugビルドでの1回の参考値（実写写真や実際のスクリーンショットではなく合成画像。環境・画像により変動）：

| プリセット | 出力サイズ | エンコード時間 |
| --- | ---: | ---: |
| fast | 197,290 bytes | 38.35 ms |
| balanced | 130,966 bytes | 554.77 ms |
| smallest | 89,562 bytes | 1,763.99 ms |

比較コードは全プリセットのデコード後画素一致も確認します。通常テストには透明／半透明RGBA、設定永続化、モード切替、Singleのパス／メモリ保存、混在形式Batch、WebPエラー後の続行・既存ファイル保護を含みます。サイズの固定比率はテスト条件にしていません。
