# レトロゲーム集

ブラウザですぐ遊べる、レトロゲーム風の小さなゲームを集めたリポジトリです。どのゲームも HTML5 Canvas と素の JavaScript だけで動きます（ビルド不要）。パソコンでもスマホでも遊べます。

- 公開版（トップページ）：https://mo-kazuya.github.io/MyGame/

## ゲーム一覧

| フォルダ | ゲーム | ジャンル |
| --- | --- | --- |
| [`underground-dragon/`](underground-dragon/) | [地底の竜](underground-dragon/README.md) | アクションRPG（ザナドゥ風） |
| [`airport-controller/`](airport-controller/) | [エアポート管制官](airport-controller/README.md) | 管制官ゲーム（ライン描画） |

## 構成

```
index.html           トップページ（ゲーム一覧。games.js からカードを作る）
portal.css           トップページの見た目
games.js             トップページに並べるゲームの一覧
underground-dragon/  地底の竜
airport-controller/  エアポート管制官
```

各ゲームはフォルダの中だけで完結していて、ほかのフォルダのファイルは使いません。

## 手元で遊ぶ

リポジトリのルートでローカルサーバーを立ち上げます。

```sh
python3 -m http.server 8000
# → http://localhost:8000/ を開く
```

各ゲームの `index.html` を直接ブラウザで開いても遊べます。

## 新しいゲームを追加する

1. ルートに新しいフォルダを作り、その中に `index.html` を置く（例：`shooter/index.html`）。CSS や JavaScript もそのフォルダの中に置き、パスは相対パスで書く
2. タイトル画面などに、トップページへ戻るリンク `<a href="../index.html">← ゲーム一覧へ</a>` を置く
3. トップページ用のサムネイル `thumb.png`（480×312 くらい）をフォルダに置く
4. ルートの `games.js` の `GAMES` に 1 件追加する
5. フォルダに `README.md`（遊び方・構成）を置き、このファイルの「ゲーム一覧」の表に 1 行足す

### 注意

- **ブラウザの保存領域（`localStorage`）は全ゲームで共有**です（同じサイトのため）。キー名には `xanaduLike.save.v2` や `airportline.stage` のように、ゲームごとの接頭辞を付けてください
- **スマホのキャッシュ対策**：`index.html` から読み込む CSS・JavaScript に `?v=1.0` のような版番号を付け、ファイルを変えたら番号を上げてください。上げないと、スマホで古いファイルが使われ続けることがあります
- テストで撮ったスクリーンショットをリポジトリのルートに置かないよう、`.gitignore` でルートの `*.png` を除外しています
