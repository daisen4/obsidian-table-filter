import { Plugin } from "obsidian";
import { EditorView } from "@codemirror/view";

type NumericOp = ">=" | "<=" | "=" | ">" | "<";

interface ColumnFilter {
    type: "text" | "numeric";
    text?: string;
    op?: NumericOp;
    num?: number | null;
}

export default class TableFilterPlugin extends Plugin {
    onload(): void {
        // 閲覧モード
        this.registerMarkdownPostProcessor((el, _ctx) => {
            el.querySelectorAll<HTMLTableElement>("table")
                .forEach((table) => this.addFilterToTable(table));
        });

        // 編集モード (Live Preview)
        this.registerEditorExtension(
            EditorView.updateListener.of((update) => {
                if (!update.docChanged && !update.viewportChanged) return;
                update.view.dom
                    .querySelectorAll<HTMLTableElement>("table")
                    .forEach((table) => {
                        if (table.closest(".table-filter-wrapper")) return;
                        this.addFilterToTableEditor(table);
                    });
            })
        );
    }

    onunload(): void {
        document.querySelectorAll(".table-filter-header-overlay")
            .forEach((el) => el.remove());
    }

    // ── 閲覧モード ─────────────────────────────────────────

    private addFilterToTable(table: HTMLTableElement): void {
        const wrapper = document.createElement("div");
        wrapper.addClass("table-filter-wrapper");

        const scroll = document.createElement("div");
        scroll.addClass("table-filter-scroll");

        table.parentElement?.insertBefore(wrapper, table);
        scroll.appendChild(table);
        wrapper.appendChild(scroll);

        requestAnimationFrame(() => {
            const thead = table.querySelector<HTMLElement>("thead");
            if (!thead) return;
            const bg = this.getEffectiveBg(scroll);
            const ths = Array.from(thead.querySelectorAll<HTMLElement>("th"));
            const filters: ColumnFilter[] = ths.map(() => ({ type: "text" }));

            ths.forEach((th, colIndex) => {
                th.style.setProperty("background", bg, "important");
                this.attachColumnFilter(th, colIndex, table, filters, bg);
            });
        });
    }

    // ── 編集モード ─────────────────────────────────────────

    private addFilterToTableEditor(table: HTMLTableElement): void {
        const wrapper = document.createElement("div");
        wrapper.addClass("table-filter-wrapper");

        table.parentElement?.insertBefore(wrapper, table);
        wrapper.appendChild(table);

        requestAnimationFrame(() => {
            const thead = table.querySelector<HTMLElement>("thead");
            if (!thead) return;
            const scroller = table.closest<HTMLElement>(".cm-scroller");
            if (!scroller) return;

            const bg = this.getEffectiveBg(wrapper);
            const ths = Array.from(thead.querySelectorAll<HTMLElement>("th"));
            const filters: ColumnFilter[] = ths.map(() => ({ type: "text" }));

            // position:fixed overlay を body に追加
            const overlay = document.createElement("div");
            overlay.addClass("table-filter-header-overlay");
            overlay.style.position    = "fixed";
            overlay.style.zIndex      = "9999";
            overlay.style.overflow    = "hidden";
            overlay.style.pointerEvents = "auto";
            overlay.style.display     = "none";
            overlay.style.setProperty("background", bg, "important");
            document.body.appendChild(overlay);

            // overlay 内容を構築
            const buildOverlay = () => {
                overlay.empty();
                const miniTable = document.createElement("table");
                miniTable.style.borderCollapse = "separate";
                miniTable.style.borderSpacing  = "0";
                miniTable.style.width          = "100%";

                const clonedThead = thead.cloneNode(true) as HTMLElement;
                const origThs  = Array.from(thead.querySelectorAll<HTMLElement>("th"));
                const cloneThs = Array.from(clonedThead.querySelectorAll<HTMLElement>("th"));
                origThs.forEach((th, i) => {
                    if (!cloneThs[i]) return;
                    cloneThs[i].style.setProperty("background", bg, "important");
                    cloneThs[i].style.width     = `${th.offsetWidth}px`;
                    cloneThs[i].style.boxSizing = "border-box";
                    cloneThs[i].style.boxShadow = "0 2px 0 var(--background-modifier-border)";
                    // 列フィルターを overlay の th にも付ける
                    this.attachColumnFilter(cloneThs[i], i, table, filters, bg);
                });
                miniTable.appendChild(clonedThead);
                overlay.appendChild(miniTable);
            };

            // 元の th にも列フィルターを付ける（スクロールしていないとき見える）
            ths.forEach((th, i) => {
                th.style.setProperty("background", bg, "important");
                this.attachColumnFilter(th, i, table, filters, bg);
            });

            buildOverlay();

            // スクロールに応じて overlay の表示・位置を更新
            const updateOverlay = () => {
                if (!table.isConnected) {
                    overlay.style.display = "none";
                    return;
                }
                const tableRect    = table.getBoundingClientRect();
                const scrollerRect = scroller.getBoundingClientRect();
                const theadH       = thead.offsetHeight;

                const headerOut  = tableRect.top  < scrollerRect.top;
                const tableAlive = tableRect.bottom > scrollerRect.top + theadH;

                if (headerOut && tableAlive) {
                    overlay.style.display = "block";
                    overlay.style.top     = `${scrollerRect.top}px`;
                    overlay.style.left    = `${tableRect.left}px`;
                    overlay.style.width   = `${tableRect.width}px`;
                    overlay.style.height  = `${theadH}px`;
                } else {
                    overlay.style.display = "none";
                }
            };

            scroller.addEventListener("scroll", updateOverlay, { passive: true });

            new ResizeObserver(() => { buildOverlay(); updateOverlay(); })
                .observe(table);

            new MutationObserver(buildOverlay)
                .observe(thead, { childList: true, subtree: true });

            const cleanupObs = new MutationObserver(() => {
                if (!table.isConnected) {
                    overlay.remove();
                    cleanupObs.disconnect();
                }
            });
            if (wrapper.parentElement) {
                cleanupObs.observe(wrapper.parentElement, { childList: true });
            }

            updateOverlay();
        });
    }

    // ── 列フィルター UI ─────────────────────────────────────

    private attachColumnFilter(
        th: HTMLElement,
        colIndex: number,
        table: HTMLTableElement,
        filters: ColumnFilter[],
        bg: string
    ): void {
        // 既に付いていたら二重付けしない
        if (th.querySelector(".tf-btn")) return;

        // th のレイアウト調整
        th.style.position = "relative";
        th.style.paddingRight = "22px";
        th.style.whiteSpace = "nowrap";

        const isNumeric = this.isNumericColumn(table, colIndex);
        filters[colIndex] = { type: isNumeric ? "numeric" : "text" };

        // ▼ ボタン
        const btn = document.createElement("span");
        btn.addClass("tf-btn");
        btn.textContent = "▼";
        th.appendChild(btn);

        // ドロップダウンパネル
        const panel = document.createElement("div");
        panel.addClass("tf-panel");
        panel.style.setProperty("background", bg, "important");
        panel.style.display = "none";
        document.body.appendChild(panel);

        if (isNumeric) {
            this.buildNumericPanel(panel, colIndex, table, filters);
        } else {
            this.buildTextPanel(panel, colIndex, table, filters);
        }

        // ボタンクリックでパネル開閉
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = panel.style.display !== "none";
            // 他のパネルを全て閉じる
            document.querySelectorAll<HTMLElement>(".tf-panel").forEach(p => {
                p.style.display = "none";
            });
            if (!isOpen) {
                const rect = btn.getBoundingClientRect();
                panel.style.display = "block";
                panel.style.top  = `${rect.bottom + 4}px`;
                panel.style.left = `${rect.left}px`;
            }
        });

        // パネル外クリックで閉じる（一度だけ登録）
        document.addEventListener("click", () => {
            panel.style.display = "none";
        });
    }

    private buildTextPanel(
        panel: HTMLElement,
        colIndex: number,
        table: HTMLTableElement,
        filters: ColumnFilter[]
    ): void {
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "絞り込み...";
        input.addClass("tf-text-input");
        panel.appendChild(input);

        input.addEventListener("click", (e) => e.stopPropagation());
        input.addEventListener("input", () => {
            filters[colIndex] = { type: "text", text: input.value };
            this.applyFilters(table, filters);
        });
    }

    private buildNumericPanel(
        panel: HTMLElement,
        colIndex: number,
        table: HTMLTableElement,
        filters: ColumnFilter[]
    ): void {
        const row = document.createElement("div");
        row.addClass("tf-numeric-row");

        const select = document.createElement("select");
        select.addClass("tf-op-select");
        const ops: { label: string; value: NumericOp }[] = [
            { label: "≥", value: ">=" },
            { label: "≤", value: "<=" },
            { label: "=", value: "=" },
            { label: ">", value: ">" },
            { label: "<", value: "<" },
        ];
        ops.forEach(({ label, value }) => {
            const opt = document.createElement("option");
            opt.value = value;
            opt.textContent = label;
            select.appendChild(opt);
        });

        const input = document.createElement("input");
        input.type = "number";
        input.placeholder = "数値";
        input.addClass("tf-num-input");

        row.appendChild(select);
        row.appendChild(input);
        panel.appendChild(row);

        const apply = () => {
            const val = input.value.trim();
            filters[colIndex] = {
                type: "numeric",
                op: select.value as NumericOp,
                num: val !== "" ? parseFloat(val) : null,
            };
            this.applyFilters(table, filters);
        };

        select.addEventListener("click", (e) => e.stopPropagation());
        select.addEventListener("change", apply);
        input.addEventListener("click", (e) => e.stopPropagation());
        input.addEventListener("input", apply);
    }

    // ── フィルター適用 ──────────────────────────────────────

    private applyFilters(table: HTMLTableElement, filters: ColumnFilter[]): void {
        const tbody = table.querySelector("tbody");
        if (!tbody) return;

        tbody.querySelectorAll<HTMLTableRowElement>("tr").forEach((row) => {
            const cells = Array.from(row.querySelectorAll("td"));
            const visible = filters.every((filter, colIndex) => {
                const cell = cells[colIndex];
                if (!cell) return true;
                const cellText = (cell.textContent ?? "").trim();

                if (filter.type === "text") {
                    const q = (filter.text ?? "").trim().toLowerCase();
                    if (!q) return true;
                    return cellText.toLowerCase().includes(q);
                } else {
                    // numeric
                    if (filter.num === null || filter.num === undefined) return true;
                    const cellNum = parseFloat(cellText);
                    if (isNaN(cellNum)) return true;
                    switch (filter.op) {
                        case ">=": return cellNum >= filter.num;
                        case "<=": return cellNum <= filter.num;
                        case "=":  return cellNum === filter.num;
                        case ">":  return cellNum >  filter.num;
                        case "<":  return cellNum <  filter.num;
                        default:   return true;
                    }
                }
            });
            row.style.display = visible ? "" : "none";
        });
    }

    // ── 列型判定 ────────────────────────────────────────────

    private isNumericColumn(table: HTMLTableElement, colIndex: number): boolean {
        const tbody = table.querySelector("tbody");
        if (!tbody) return false;
        const rows = Array.from(tbody.querySelectorAll("tr"));
        const nonEmpty = rows
            .map((row) => {
                const cell = row.querySelectorAll("td")[colIndex];
                return (cell?.textContent ?? "").trim();
            })
            .filter((v) => v !== "");
        if (nonEmpty.length === 0) return false;
        return nonEmpty.every((v) => !isNaN(parseFloat(v)) && isFinite(Number(v)));
    }

    // ── 共通ユーティリティ ──────────────────────────────────

    private getEffectiveBg(el: Element): string {
        let node: Element | null = el;
        while (node) {
            const bg = window.getComputedStyle(node).backgroundColor;
            if (bg && bg !== "rgba(0, 0, 0, 0)") return bg;
            node = node.parentElement;
        }
        return this.resolveCssColor("var(--background-primary)");
    }

    private resolveCssColor(cssValue: string): string {
        const probe = document.createElement("div");
        probe.style.cssText = `position:absolute;visibility:hidden;background:${cssValue}`;
        document.body.appendChild(probe);
        const resolved = window.getComputedStyle(probe).backgroundColor;
        document.body.removeChild(probe);
        return resolved !== "rgba(0, 0, 0, 0)" ? resolved : "#1a1a1a";
    }
}
