# 手書き数字モデルの作りかた

`../handwriting-model.js`（手書き数字を読み取るニューラルネットの重み）を作り直すための道具です。ゲームを遊ぶだけなら不要です。

使うデータ（どちらも研究用に公開されているもの）

- MNIST（手書き数字の画像 7 万字）
- UCI「Pen-Based Recognition of Handwritten Digits」の `pendigits-orig`（タブレットにペンで書いた線の記録、44 人・約 1 万 1 千字。学習用 30 人・テスト用 14 人に分かれている）

```sh
# data/ に MNIST の *.gz 4 つと、pendigits を展開した data/pd/pendigits-orig.{tra,tes} を置く
node build.js data                 # pendigits の線を、ゲームと同じ前処理（../handwriting.js）で 28×28 の画像にする
pip install numpy torch
python train.py mix 12 model data  # 学習 → model.js（int8 の重み）ができる
cp model.js ../handwriting-model.js
node evaluate.js data              # ゲームと同じ JS で、テスト用 14 人の字の正解率を出す
```

`train.py` の 1 つめの引数を `mnist` にすると MNIST だけで学習します（比較用）。

現在のモデルの成績（学習に使っていない 14 人・3498 字）

| 学習データ | 1 文字の正解率 |
| --- | --- |
| MNIST だけ | 92.4% |
| MNIST ＋ pendigits（いまのモデル） | 99.1% |

まちがえやすいのは 4→6、9→3、9→7 です。
