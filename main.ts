import { Plugin } from "obsidian";
import { EditorView } from "@codemirror/view";

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
        // プラグイン無効化時に body に追加した overlay を全て削除
        document.querySelectorAll(".table-filter-header-overlay")
            .forEach((el) => el.remove());
    }

    // ── 閲覧モード ─────────────────────────────────────────

    private addFilterToTable(table: HTMLTableElement): void {
        const wrapper = document.createElement("div");
        wrapper.addClass("table-filter-wrapper");

        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Filter table...";
        input.addClass("table-filter-input");

        const scroll = document.createElement("div");
        scroll.addClass("table-filter-scroll");

        table.parentElement?.insertBefore(wrapper, table);
        wrapper.appendChild(input);
        scroll.appendChild(table);
        wrapper.appendChild(scroll);

        requestAnimationFrame(() => {
            const thead = table.querySelector<HTMLElement>("thead");
            if (!thead) return;
            const bg = this.getEffectiveBg(scroll);
            thead.querySelectorAll<HTMLElement>("th").forEach((th) => {
                th.style.setProperty("background", bg, "important");
            });
        });

        input.addEventListener("input", () =>
            this.filterTable(table, input.value)
        );
    }

    // ── 編集モード ─────────────────────────────────────────

    /**
     * CodeMirror 内は overflow:hidden により CSS sticky / 絶対配置が機能しない。
     * thead を document.body に position:fixed でオーバーレイし、
     * スクロール時のみ表示することでヘッダー固定を実現する。
     */
    private addFilterToTableEditor(table: HTMLTableElement): void {
        const wrapper = document.createElement("div");
        wrapper.addClass("table-filter-wrapper");

        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Filter table...";
        input.addClass("table-filter-input");

        table.parentElement?.insertBefore(wrapper, table);
        wrapper.appendChild(input);
        wrapper.appendChild(table);

        requestAnimationFrame(() => {
            const thead = table.querySelector<HTMLElement>("thead");
            if (!thead) return;
            const scroller = table.closest<HTMLElement>(".cm-scroller");
            if (!scroller) return;

            const bg = this.getEffectiveBg(wrapper);

            // position:fixed overlay を body に追加（overflow の影響を受けない）
            const overlay = document.createElement("div");
            overlay.addClass("table-filter-header-overlay");
            overlay.style.position    = "fixed";
            overlay.style.zIndex      = "9999";
            overlay.style.overflow    = "hidden";
            overlay.style.pointerEvents = "none"; // エディタ操作を邪魔しない
            overlay.style.display     = "none";
            overlay.style.setProperty("background", bg, "important");
            document.body.appendChild(overlay);

            // overlay 内容を构築
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
                });
                miniTable.appendChild(clonedThead);
                overlay.appendChild(miniTable);
            };
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

            // table リサイズ時に再構築
            new ResizeObserver(() => { buildOverlay(); updateOverlay(); })
                .observe(table);

            // CodeMirror が thead を再描画したとき内容を同期
            new MutationObserver(buildOverlay)
                .observe(thead, { childList: true, subtree: true });

            // table が DOM から外れたら overlay を削除
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

        input.addEventListener("input", () =>
            this.filterTable(table, input.value)
        );
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

    private filterTable(table: HTMLTableElement, query: string): void {
        const q = query.trim().toLowerCase();
        table
            .querySelector("tbody")
            ?.querySelectorAll<HTMLTableRowElement>("tr")
            .forEach((row) => {
                if (!q) { row.style.display = ""; return; }
                const text = Array.from(row.querySelectorAll("td"))
                    .map((c) => c.textContent ?? "")
                    .join(" ")
                    .toLowerCase();
                row.style.display = text.includes(q) ? "" : "none";
            });
    }
}
