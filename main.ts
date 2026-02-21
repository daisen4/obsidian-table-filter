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

        table.parentElement?.insertBefore(wrapper, table);
        wrapper.appendChild(input);
        wrapper.appendChild(table);

        input.addEventListener("input", () =>
            this.filterTable(table, input.value)
        );
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
