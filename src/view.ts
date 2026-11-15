import { ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import MyPlugin from './main'

export const VIEW_TYPE = 'my-search-results';

export class ResultsView extends ItemView {
    private searchInput!: HTMLInputElement;
    private resultsEl!: HTMLDivElement;
    private suggestionsEl!: HTMLDivElement;

    constructor(leaf: WorkspaceLeaf, private plugin: MyPlugin) {
        super(leaf);
    }

    getViewType() { return VIEW_TYPE; }
    getDisplayText() { return 'Search Results'; }

    async onOpen() {
        const container = this.contentEl;
        container.empty();
        container.addClass('my-search-view');

        // The search bar
        const inputContainer = container.createDiv({ cls: 'search-input-container' });
        this.searchInput = inputContainer.createEl('input', {
            cls: 'input-type-text',          // reuses Obsidian's input styling
            type: 'search',
            placeholder: 'Search...',
        });

        this.suggestionsEl = container.createDiv({ cls: 'my-suggestions' });
        this.resultsEl = container.createDiv({ cls: 'my-results' });

        // React on every keystroke
        this.registerDomEvent(this.searchInput, 'input', () => {
            // const query = this.searchInput.value.trim();
            // this.renderResults(query);
            this.updateSuggestions();
            this.renderResults(this.searchInput.value.trim());
        });

        this.registerDomEvent(this.searchInput, 'keydown', (evt: KeyboardEvent) => {
            this.handleKeydown(evt);
        });

        // Hide suggestions when clicking elsewhere in the view
        this.registerDomEvent(this.contentEl, 'click', () => {
            this.suggestionsEl.empty();
        });

        this.searchInput.focus();
    }

    /** All property names in the vault */
    private getAllPropertyNames(): string[] {
        const names = new Set<string>();
        for (const file of this.app.vault.getMarkdownFiles()) {
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
            if (!fm) continue;
            for (const key of Object.keys(fm)) {
                if (key !== 'position') names.add(key);
            }
        }
        return [...names];
    }

    /** All values that exist for a given property in the vault */
    private getAllValuesFor(key: string): string[] {
        const values = new Set<string>();
        for (const file of this.app.vault.getMarkdownFiles()) {
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
            if (!fm || !(key in fm)) continue;
            const v = fm[key];
            const list = Array.isArray(v) ? v.map(String) : [String(v)];
            for (const item of list) values.add(item.substring(2, item.length - 2)); // Remove double brackets
        }
        return [...values];
    }

    private updateSuggestions() {
        this.suggestionsEl.empty();
        const query = this.searchInput.value;

        // Split on operators, keeping the text: "place: Earth and moo" -> ["place: Earth ", "moo"]
        const parts = query.split(/\s+(?:and|or)\s+/i);
        console.log(parts)
        const lastClause = parts[parts.length - 1] ?? '';
        console.log(lastClause)
        // Everything before the last clause, including the operator that separates it
        const beforeLast = query.slice(0, query.length - lastClause.length);
        console.log("beforeLast : ", beforeLast, query.length, lastClause.length)

        const colonIndex = lastClause.indexOf(':');
        const beforeColon = colonIndex !== -1 ? lastClause.slice(0, colonIndex).trim() : lastClause.trim();
        const afterColon = colonIndex !== -1 ? lastClause.slice(colonIndex + 1).trim() : '';

        if (!beforeColon) return; // nothing typed in the current clause yet

        let candidates: string[];

        if (colonIndex === -1) {
            // Phase 1: suggest property names for the current clause
            candidates = this.getAllPropertyNames()
                .filter((name) => name.toLowerCase().includes(beforeColon.toLowerCase()))
                .sort()
                .slice(0, 8);
        } else {
            // Phase 2: suggest values valid for the property of the current clause
            candidates = this.getAllValuesFor(beforeColon)
                .filter((val) => val.toLowerCase().includes(afterColon.toLowerCase()))
                .sort()
                .slice(0, 8);
        }

        for (const candidate of candidates) {
            const item = this.suggestionsEl.createDiv({ cls: 'my-suggestion-item' });
            item.setText(candidate);
            item.onClickEvent(() => {
                let completed: string;
                if (colonIndex === -1) {
                    // Completing a property name: property + colon, ready for the value
                    completed = `${candidate}: `;
                } else {
                    // Completing a value: rebuild the whole clause "property: value"
                    completed = `${beforeColon}: ${candidate} `;
                }
                this.searchInput.value = `${beforeLast}${completed}`;
                this.suggestionsEl.empty();
                this.renderResults(this.searchInput.value.trim());
                this.searchInput.focus();
            });
        }
    }

    private handleKeydown(evt: KeyboardEvent) {
        if (evt.key !== 'Escape') return;
        this.suggestionsEl.empty();
    }

    private renderResults(query: string) {
        this.resultsEl.empty();
        if (!query) {
            this.resultsEl.setText('propertyname: Note');
            return;
        }

        const resultNotes = this.plugin.search(query);

        if (!resultNotes || resultNotes.length === 0) {
            this.resultsEl.setText('No matching notes');
            return;
        }

        const list = this.resultsEl.createEl('ul');
        for (const file of resultNotes) {
            const li = list.createEl('li');

            if (file) {
                li.createEl('strong', { text: file.basename });
                li.onClickEvent(() => {
                    this.app.workspace.getLeaf('tab').openFile(file);
                });
            } else {
                // Show it anyway, but not clickable, so you notice resolution failures
                li.createEl('span', { text: `${name} (not found)` });
                li.addClass('my-result-missing');
            }
        }
    }

    async onClose() { this.contentEl.empty(); }
}