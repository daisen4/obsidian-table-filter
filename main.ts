import { Plugin } from "obsidian";

export default class TableFilterPlugin extends Plugin {
    onload(): void {
        this.registerMarkdownPostProcessor((el, _ctx) => {
            el.querySelectorAll<HTMLTableElement>("table")
                .forEach((table) => this.addFilterToTable(table));
        });
    }

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

        // DOMへの挿入・スタイル計算が完了してから背景色を取得して適用
        requestAnimationFrame(() => {
            const thead = table.querySelector<HTMLElement>("thead");
            if (!thead) return;

            // 透明でない最初の祖先要素の背景色を取得
            const bg = this.getEffectiveBg(scroll);
            thead.querySelectorAll<HTMLElement>("th").forEach((th) => {
                // inline style + important でテーマCSSのどんな指定にも勝つ
                th.style.setProperty("background-color", bg, "important");
            });
        });

        input.addEventListener("input", () =>
            this.filterTable(table, input.value)
        );
    }

    /** DOM ツリーを上に辿り、最初の不透明な背景色を返す */
    private getEffectiveBg(el: Element): string {
        let node: Element | null = el;
        while (node) {
            const bg = window.getComputedStyle(node).backgroundColor;
            if (bg && bg !== "rgba(0, 0, 0, 0)") {
                return bg;
            }
            node = node.parentElement;
        }
        return "var(--background-primary)";
    }

    private filterTable(table: HTMLTableElement, query: string): void {
        const q = query.trim().toLowerCase();
        table
            .querySelector("tbody")
            ?.querySelectorAll<HTMLTableRowElement>("tr")
            .forEach((row) => {
                if (!q) {
                    row.style.display = "";
                    return;
                }
                const text = Array.from(row.querySelectorAll("td"))
                    .map((c) => c.textContent ?? "")
                    .join(" ")
                    .toLowerCase();
                row.style.display = text.includes(q) ? "" : "none";
            });
    }
}
