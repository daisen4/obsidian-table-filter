import { Plugin } from "obsidian";
import { EditorView } from "@codemirror/view";

interface ColumnFilter {
    selected: Set<string>; // 空 = フィルターなし（全行表示）
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
                        if (table.closest(".table-filter-wrapper")) {
                            // CodeMirror が tbody を再描画するとフィルターが消えるので再適用
                            if (update.docChanged) {
                                const f = (table as any).__tfFilters as ColumnFilter[] | undefined;
                                if (f && f.some((fi) => fi.selected.size > 0)) {
                                    this.applyFilters(table, f);
                                }
                            }
                            return;
                        }
                        this.addFilterToTableEditor(table);
                    });
            })
        );
    }

    onunload(): void {
        document.querySelectorAll(".table-filter-header-overlay")
            .forEach((el) => el.remove());
        document.querySelectorAll(".tf-panel")
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
            const filters: ColumnFilter[] = ths.map(() => ({ selected: new Set<string>() }));

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
            const filters: ColumnFilter[] = ths.map(() => ({ selected: new Set<string>() }));
            // docChanged 時に再適用できるようテーブル要素に紐づける
            (table as any).__tfFilters = filters;

            // position:fixed overlay を body に追加
            const overlay = document.createElement("div");
            overlay.addClass("table-filter-header-overlay");
            overlay.style.position      = "fixed";
            overlay.style.zIndex        = "9999";
            overlay.style.overflow      = "hidden";
            overlay.style.pointerEvents = "auto";
            overlay.style.display       = "none";
            overlay.style.setProperty("background", bg, "important");
            document.body.appendChild(overlay);

            // overlay 内のパネルを追跡して再構築時に削除
            let overlayPanels: HTMLElement[] = [];

            const buildOverlay = () => {
                overlayPanels.forEach((p) => p.remove());
                overlayPanels = [];

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
                    const cloneTh = cloneThs[i];
                    cloneTh.style.setProperty("background", bg, "important");
                    cloneTh.style.width     = `${th.offsetWidth}px`;
                    cloneTh.style.boxSizing = "border-box";
                    cloneTh.style.boxShadow = "0 2px 0 var(--background-modifier-border)";
                    // クローン内の既存 tf-btn を除去してから再付与
                    cloneTh.querySelector(".tf-btn")?.remove();
                    cloneTh.removeAttribute("data-tf-attached");
                    const panel = this.attachColumnFilter(cloneTh, i, table, filters, bg);
                    if (panel) overlayPanels.push(panel);
                });
                miniTable.appendChild(clonedThead);
                overlay.appendChild(miniTable);
            };

            // 元の th にフィルターを付ける
            ths.forEach((th, i) => {
                th.style.setProperty("background", bg, "important");
                this.attachColumnFilter(th, i, table, filters, bg);
            });

            buildOverlay();

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
                    overlayPanels.forEach((p) => p.remove());
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

    /**
     * th に ▼ボタンとドロップダウンパネルを付与する。
     * パネル要素を返す（overlay 管理用）。
     */
    private attachColumnFilter(
        th: HTMLElement,
        colIndex: number,
        table: HTMLTableElement,
        filters: ColumnFilter[],
        bg: string
    ): HTMLElement | null {
        if (th.dataset.tfAttached === "true") return null;
        th.dataset.tfAttached = "true";

        th.style.position    = "relative";
        th.style.paddingRight = "22px";

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

        this.buildCheckboxPanel(panel, colIndex, table, filters, btn);

        // パネル内のクリックは document に伝播させない（パネルが即閉じる問題を防ぐ）
        panel.addEventListener("click", (e) => e.stopPropagation());

        // ボタンクリックで開閉
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = panel.style.display !== "none";
            document.querySelectorAll<HTMLElement>(".tf-panel").forEach((p) => {
                p.style.display = "none";
            });
            if (!isOpen) {
                const rect = btn.getBoundingClientRect();
                panel.style.display = "block";
                // 画面下端を超える場合は上に開く
                const panelH = panel.offsetHeight || 260;
                const spaceBelow = window.innerHeight - rect.bottom;
                if (spaceBelow < panelH && rect.top > panelH) {
                    panel.style.top  = `${rect.top - panelH - 4}px`;
                } else {
                    panel.style.top  = `${rect.bottom + 4}px`;
                }
                panel.style.left = `${rect.left}px`;
            }
        });

        // パネル外クリックで閉じる
        document.addEventListener("click", () => {
            panel.style.display = "none";
        });

        return panel;
    }

    private buildCheckboxPanel(
        panel: HTMLElement,
        colIndex: number,
        table: HTMLTableElement,
        filters: ColumnFilter[],
        btn: HTMLElement
    ): void {
        const values = this.getUniqueValues(table, colIndex);

        // 検索入力
        const search = document.createElement("input");
        search.type = "text";
        search.placeholder = "検索...";
        search.addClass("tf-search-input");
        panel.appendChild(search);

        // 全選択 / 全解除
        const btnRow = document.createElement("div");
        btnRow.addClass("tf-action-row");

        const selectAll = document.createElement("button");
        selectAll.textContent = "全選択";
        selectAll.addClass("tf-action-btn");

        const clearAll = document.createElement("button");
        clearAll.textContent = "全解除";
        clearAll.addClass("tf-action-btn");

        btnRow.appendChild(selectAll);
        btnRow.appendChild(clearAll);
        panel.appendChild(btnRow);

        // チェックボックスリスト
        const list = document.createElement("div");
        list.addClass("tf-checkbox-list");
        panel.appendChild(list);

        const items: { value: string; checkbox: HTMLInputElement; item: HTMLElement }[] = [];

        values.forEach((value) => {
            const item = document.createElement("label");
            item.addClass("tf-checkbox-item");

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = value;
            // 現在のフィルター状態を反映（overlay 再構築時）
            checkbox.checked = filters[colIndex].selected.has(value);

            const label = document.createElement("span");
            label.textContent = value !== "" ? value : "(空)";

            item.appendChild(checkbox);
            item.appendChild(label);
            list.appendChild(item);
            items.push({ value, checkbox, item });

            checkbox.addEventListener("change", () => {
                if (checkbox.checked) {
                    filters[colIndex].selected.add(value);
                } else {
                    filters[colIndex].selected.delete(value);
                }
                this.updateBtnIndicator(btn, filters[colIndex]);
                this.applyFilters(table, filters);
            });
        });

        // 検索で候補を絞り込む
        search.addEventListener("click", (e) => e.stopPropagation());
        search.addEventListener("input", () => {
            const q = search.value.toLowerCase();
            items.forEach(({ value, item }) => {
                item.style.display = value.toLowerCase().includes(q) ? "" : "none";
            });
        });

        // 全選択（検索で絞り込まれた候補のみ）
        selectAll.addEventListener("click", (e) => {
            e.stopPropagation();
            items.forEach(({ value, checkbox, item }) => {
                if (item.style.display !== "none") {
                    checkbox.checked = true;
                    filters[colIndex].selected.add(value);
                }
            });
            this.updateBtnIndicator(btn, filters[colIndex]);
            this.applyFilters(table, filters);
        });

        // 全解除
        clearAll.addEventListener("click", (e) => {
            e.stopPropagation();
            items.forEach(({ checkbox }) => {
                checkbox.checked = false;
            });
            filters[colIndex].selected.clear();
            this.updateBtnIndicator(btn, filters[colIndex]);
            this.applyFilters(table, filters);
        });
    }

    // ── フィルター適用 ──────────────────────────────────────

    private applyFilters(table: HTMLTableElement, filters: ColumnFilter[]): void {
        const tbody = table.querySelector("tbody");
        if (!tbody) return;

        tbody.querySelectorAll<HTMLTableRowElement>("tr").forEach((row) => {
            const cells = Array.from(row.querySelectorAll("td"));
            const visible = filters.every((filter, colIndex) => {
                if (filter.selected.size === 0) return true; // フィルターなし
                const cell = cells[colIndex];
                if (!cell) return true;
                const cellText = (cell.textContent ?? "").trim();
                return filter.selected.has(cellText);
            });
            row.style.display = visible ? "" : "none";
        });
    }

    // ── ユーティリティ ──────────────────────────────────────

    private getUniqueValues(table: HTMLTableElement, colIndex: number): string[] {
        const tbody = table.querySelector("tbody");
        if (!tbody) return [];
        const seen = new Set<string>();
        tbody.querySelectorAll<HTMLTableRowElement>("tr").forEach((row) => {
            const cell = row.querySelectorAll("td")[colIndex];
            seen.add((cell?.textContent ?? "").trim());
        });
        return Array.from(seen).sort((a, b) => {
            // 数値として解釈できる場合は数値順
            const na = parseFloat(a), nb = parseFloat(b);
            if (!isNaN(na) && !isNaN(nb)) return na - nb;
            return a.localeCompare(b, "ja");
        });
    }

    private updateBtnIndicator(btn: HTMLElement, filter: ColumnFilter): void {
        if (filter.selected.size > 0) {
            btn.addClass("tf-btn--active");
        } else {
            btn.removeClass("tf-btn--active");
        }
    }

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
