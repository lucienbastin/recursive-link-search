import { Plugin, TFile, prepareFuzzySearch } from 'obsidian';
import { RelationsParser } from './relations-parser';
import { DiGraph } from "digraph-js";
import { ResultsView, VIEW_TYPE } from "./view"

interface Clause {
  key: string;
  value: string;
}

let recursiveProperties = ["lieu", "composition"];

export default class MyPlugin extends Plugin {
    private relationsParser: RelationsParser;
    private index: Map<TFile, string> = new Map();
    public graphs: Map<string, DiGraph<Vertex>> = new Map();
    private data = new Map([["place", "Earth"]]);
    private allPropertyNamesCache: string[] | null = null;
    private valuesByPropertyCache: Map<string, string[]> | null = null;

    async onload() {
        console.clear();

        this.registerView(VIEW_TYPE, (leaf) => new ResultsView(leaf, this));

        this.addRibbonIcon('search', 'Open my search', () => this.activateView());

        this.addCommand({
            id: 'open-my-search',
            name: 'Open my search',
            callback: () => this.activateView(),
        });

        // Invalidate both caches whenever any file's metadata changes
        this.registerEvent(
            this.app.metadataCache.on('changed', () => {
                this.allPropertyNamesCache = null;
                this.valuesByPropertyCache = null;
            })
        );
        // Also when the vault structure changes (file created/deleted/renamed)
        this.registerEvent(this.app.vault.on('delete', () => this.invalidateCaches()));
        this.registerEvent(this.app.vault.on('rename', () => this.invalidateCaches()));

        this.relationsParser = new RelationsParser(this.app, recursiveProperties);

        await this.relationsParser.loadProperties();
        let fileRelations = this.relationsParser.fileProperties;

        // Setup the relationships graphs
        for (let property of recursiveProperties) {
            const graph = new DiGraph();
            let vertices = new Map<string, Vertex>();

            for (const [file, relations] of fileRelations) {
                let vertex = { id: file, adjacentTo: [], body: {} };
                graph.addVertices(vertex);
                vertices.set(file, vertex);
            }

            for (const [file, relations] of fileRelations) {
                for (const [key, values] of relations) {
                    if (key == property) {
                        for (let parent of values) {
                            graph.addEdge({ from: file, to: parent });
                        }
                    } 
                }
            }

            this.graphs.set(property, graph)
        }
    }

    onunload() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    }

    private invalidateCaches() {
        this.allPropertyNamesCache = null;
        this.valuesByPropertyCache = null;
    }

    getAllPropertyNames(): string[] {
        if (this.allPropertyNamesCache) return this.allPropertyNamesCache;

        const names = new Set<string>();
        for (const file of this.app.vault.getMarkdownFiles()) {
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
            if (!fm) continue;
            for (const key of Object.keys(fm)) {
                if (key !== 'position') names.add(key);
            }
        }
        this.allPropertyNamesCache = [...names].sort();
        return this.allPropertyNamesCache;
    }

    getAllValuesFor(key: string): string[] {
        // Build the whole values map on first call, then just look up
        if (!this.valuesByPropertyCache) {
            this.valuesByPropertyCache = new Map();
            for (const file of this.app.vault.getMarkdownFiles()) {
                const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
                if (!fm) continue;
                for (const [propName, propValue] of Object.entries(fm)) {
                    if (propName === 'position') continue;
                    const list = Array.isArray(propValue) ? propValue.map(String) : [String(propValue)];
                    let bucket = this.valuesByPropertyCache.get(propName);
                    if (!bucket) {
                        bucket = new Set<string>();
                        this.valuesByPropertyCache.set(propName, bucket);
                    }
                    for (const item of list) bucket.add(item);
                }
            }
            // Freeze into sorted arrays
            for (const [propName, set] of this.valuesByPropertyCache) {
                this.valuesByPropertyCache.set(propName, [...set].sort());
            }
        }
        return this.valuesByPropertyCache.get(key) ?? [];
    }

    searchGraphs(key: string, value: string): TFile[] {
        const results: TFile[] = [];

        if (this.graphs.has(key)) {
            let linkedChildren = [...this.graphs.get(key).getDeepParents(value.concat(".md"))];

            for (const file of this.app.vault.getMarkdownFiles()) {
                if (linkedChildren.includes(file.name)) {
                    results.push(file)
                }
            }
        }

        return results;
    }

    parseQuery(query: string): Clause[][] {
        const groups: Clause[][] = [];
        let current: Clause[] = [];

        // Split on operators, keeping them as tokens
        const tokens = query.split(/\s+(and|or)\s+/i);

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i].trim();
            if (/^(and|or)$/i.test(token)) continue; // handled implicitly below

            const sep = token.indexOf(':');
            if (sep === -1) continue; // skip malformed clauses

            current.push({
                key: token.slice(0, sep).trim(),
                value: token.slice(sep + 1).trim(),
            });

            // If the NEXT token is "or", close the current AND-group
            const nextOp = tokens[i + 1]?.trim();
            if (nextOp && /^or$/i.test(nextOp)) {
                if (current.length) groups.push(current);
                current = [];
            }
        }
        if (current.length) groups.push(current);
        return groups;
    }

    /** Full search: parse, evaluate each clause, combine with AND/OR */
    search(query: string): TFile[] {
        const groups = this.parseQuery(query);
        if (groups.length === 0) return [];

        // Evaluate each AND-group, then OR the group results together
        const union = new Set<TFile>();
        for (const group of groups) {
            const groupResult = this.evalAndGroup(group);
            for (const name of groupResult) union.add(name);
        }
        return [...union];
    }

    /** Filenames satisfying ALL clauses in the group */
    private evalAndGroup(group: Clause[]): TFile[] {
        if (group.length === 0) return [];

        // Start with the first clause's results, intersect with the rest
        let result = new Set(this.searchGraphs(group[0].key, group[0].value));

        for (let i = 1; i < group.length; i++) {
            const next = new Set(this.searchGraphs(group[i].key, group[i].value));
            result = new Set([...result].filter((name) => next.has(name)));
            if (result.size === 0) break; // early exit
        }
        return [...result];
    }

    private async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (!leaf) {
            leaf = workspace.getRightLeaf(false)!;
            await leaf.setViewState({ type: VIEW_TYPE, active: true });
        }
        workspace.revealLeaf(leaf);
    }
}