# 設計書: obsidian-table-filter

**バージョン**: 1.0.0
**作成日**: 2026年2月

---

## 1. アーキテクチャ概要

```
main.ts
├── onload()
│   ├── registerMarkdownPostProcessor   → 閲覧モード処理
│   └── registerEditorExtension         → 編集モード処理
│
├── addFilterToTable()                  → 閲覧モード: DOM構築
├── addFilterToTableEditor()            → 編集モード: DOM構築 + fixed overlay
│
├── attachColumnFilter()                → 列ヘッダーに▼ボタン＋パネルを付与
├── buildTextPanel()                    → テキスト列用フィルターUI
├── buildNumericPanel()                 → 数値列用フィルターUI
│
├── applyFilters()                      → フィルター適用ロジック
├── isNumericColumn()                   → 列型自動判定
│
├── getEffectiveBg()                    → 実効背景色の取得（DOM走査）
└── resolveCssColor()                   → CSSカスタムプロパティの解決
```

---

## 2. モード別実装

### 2.1 閲覧モード（Reading View）

```
wrapper（.table-filter-wrapper）
└── scroll（.table-filter-scroll）  ← overflow-y: auto; max-height: 70vh
    └── table
        └── thead
            └── th × n  ← ▼ボタン付き。CSS sticky で固定
```

**ヘッダー固定の仕組み**:
- `.table-filter-scroll`（`overflow-y: auto`）の中に table を入れ、`thead th` に `position: sticky; top: 0` を適用
- `border-collapse: separate !important` が必須（`collapse` だと sticky が動かない）
- 背景色は `getEffectiveBg()` で取得した実際の色を inline style で `!important` 付きで設定

### 2.2 編集モード（Live Preview）

```
wrapper（.table-filter-wrapper）
└── table
    └── thead
        └── th × n  ← ▼ボタン付き

document.body
└── overlay（.table-filter-header-overlay）  ← position: fixed
    └── miniTable
        └── cloned thead  ← ▼ボタン付き（overlayが見えるときのフィルター操作用）
```

**ヘッダー固定の仕組み**:
CodeMirrorの `.cm-scroller` 等の祖先要素に `overflow: hidden` が重なっており、CSS stickyも`position: absolute`も機能しない。そのため以下の方式を採用：

1. `position: fixed` の overlay を `document.body` に直接追加（overflow制約の外）
2. `scroll` イベントで table と `.cm-scroller` の位置関係を計算
3. `tableRect.top < scrollerRect.top`（theadがスクロールアウト）かつ `tableRect.bottom > scrollerRect.top + theadH`（テーブルがまだ見えている）の場合のみ overlay を表示
4. overlay 内の列幅を元の th の `offsetWidth` から同期

**同期の仕組み**:
| Observer | 役割 |
|----------|------|
| `scroller.addEventListener("scroll")` | スクロール時に overlay の位置を更新 |
| `ResizeObserver` on table | テーブルサイズ変更時に overlay を再構築 |
| `MutationObserver` on thead | CodeMirrorが thead を再描画したときに内容を同期 |
| `MutationObserver` on wrapper.parentElement | table が DOM から外れたときに overlay を削除 |

---

## 3. 列フィルター UI

### 3.1 ▼ボタン（`.tf-btn`）

- `position: absolute; right: 4px; top: 50%; transform: translateY(-50%)`
- th に `position: relative; padding-right: 22px` を付与して配置スペースを確保
- 二重付け防止: `if (th.querySelector(".tf-btn")) return`

### 3.2 ドロップダウンパネル（`.tf-panel`）

- `position: fixed` で `document.body` に追加
- ▼ボタンクリック時に `getBoundingClientRect()` でボタン位置を取得し `top/left` を設定
- 複数パネルの排他制御: 開く前に全パネルを `display: none` にする
- `document.addEventListener("click")` でパネル外クリック時に閉じる

### 3.3 列型の自動判定（`isNumericColumn`）

```typescript
// tbody の対象列の全セルが数値として解析できる場合に numeric と判定
const nonEmpty = rows.map(row => cells[colIndex].textContent.trim()).filter(v => v !== "");
return nonEmpty.every(v => !isNaN(parseFloat(v)) && isFinite(Number(v)));
```

---

## 4. フィルターデータ構造

```typescript
type NumericOp = ">=" | "<=" | "=" | ">" | "<";

interface ColumnFilter {
    type: "text" | "numeric";
    text?: string;        // テキスト列: 検索文字列
    op?: NumericOp;       // 数値列: 演算子
    num?: number | null;  // 数値列: 比較値
}

// filters[colIndex] で各列のフィルター状態を管理
const filters: ColumnFilter[] = ths.map(() => ({ type: "text" }));
```

**AND フィルター適用**:
```typescript
const visible = filters.every((filter, colIndex) => {
    // 各列のフィルター条件をチェック → 全て true の行のみ表示
});
```

---

## 5. 背景色の解決

ObsidianはCSSカスタムプロパティ（`var(--background-primary)`）を多用するが、DOM未接続の要素ではこれを解決できない。

```typescript
// getEffectiveBg: DOMツリーを上に辿り最初の不透明な背景色を返す
private getEffectiveBg(el: Element): string {
    let node = el;
    while (node) {
        const bg = window.getComputedStyle(node).backgroundColor;
        if (bg !== "rgba(0, 0, 0, 0)") return bg;
        node = node.parentElement;
    }
    return this.resolveCssColor("var(--background-primary)"); // フォールバック
}

// resolveCssColor: probeをbodyに一時挿入してCSSカスタムプロパティをRGBに解決
private resolveCssColor(cssValue: string): string {
    const probe = document.createElement("div");
    probe.style.cssText = `position:absolute;visibility:hidden;background:${cssValue}`;
    document.body.appendChild(probe);
    const resolved = window.getComputedStyle(probe).backgroundColor;
    document.body.removeChild(probe);
    return resolved !== "rgba(0, 0, 0, 0)" ? resolved : "#1a1a1a";
}
```

---

## 6. ファイル構成

| ファイル | 役割 |
|----------|------|
| `main.ts` | プラグイン本体。全ロジックを実装 |
| `styles.css` | ▼ボタン・パネル・テーブルのスタイル。Obsidianテーマ変数を使用 |
| `manifest.json` | プラグインメタデータ（id, name, version, minAppVersion） |
| `versions.json` | バージョン互換性マップ |
| `package.json` | npm設定・ビルドスクリプト（dev/build） |
| `tsconfig.json` | TypeScript設定（strictNullChecks, moduleResolution: bundler） |
| `esbuild.config.mjs` | バンドラー設定（format: cjs, external: obsidian等） |

### ビルド設定の重要ポイント

- `format: "cjs"` — Obsidianはプラグインをrequireで読み込むため必須
- `external: ["obsidian", "@codemirror/view", ...]` — Obsidianがランタイムで提供するため外部化
- `target: "es2018"` — Electronのバージョン互換性のため

---

## 7. 既知の課題・今後の改善候補

| 課題 | 内容 | 改善案 |
|------|------|--------|
| クリックリスナーの多重登録 | 列数分だけ `document.addEventListener("click")` が登録される | `AbortController` で一元管理 |
| overlay再構築時のUI状態リセット | CodeMirrorがtheadを再描画するとフィルター入力欄の表示がリセットされる | フィルター値をUIに再適用する処理を追加 |
| フィルターリセット手段がない | 入力欄を手動でクリアするしかない | 「クリア」ボタンをパネルに追加 |
| モバイル未対応 | タッチ操作での▼ボタン・パネル操作が未検証 | タッチイベントの考慮 |
