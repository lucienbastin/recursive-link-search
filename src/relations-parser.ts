import { App, TFile, parseYaml } from 'obsidian';

export class RelationsParser {
    private app: App;
    public fileProperties: Map<string, Map<string, Array<string>>>;

    constructor(app: App) {
        this.app = app;
        this.fileProperties = new Map();
    }

    async loadProperties() {
        const files = this.app.vault.getMarkdownFiles();

        this.fileProperties.clear();

        for (const file of files) {
            await this.processFile(file);
        }
    }

    async processFile(file: TFile) {
        try {
            const content = await this.app.vault.read(file);
            const frontmatter = this.extractFrontmatter(content);
            
            if (frontmatter) {
                let relations = new Map();
                Object.entries(frontmatter).forEach(([key, value]) => {
                    if (key == "lieu") {
                        let parents = [];

                        for (let i in value) {
                            parents.push(this.convertFrontmatterToNoteName(value[i]))
                        }

                        relations.set(key, parents)
                    }
                });

                this.fileProperties.set(file.path, relations);
            } else {
                this.fileProperties.set(file.path, new Map([]));
            }
        } catch (error) {
            console.error(`Error processing file ${file.path}:`, error);
        }
    }

    private extractFrontmatter(content: string): Record<string, any> | null {
        const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
        const match = content.match(frontmatterRegex);
        
        if (match && match[1]) {
            try {
                return parseYaml(match[1]);
            } catch (error) {
                console.error("Error parsing frontmatter YAML:", error);
                return null;
            }
        }
        
        return null;
    }

    private convertFrontmatterToNoteName(content: string): string {
        return content.substring(2, content.length - 2).concat(".md");
    }
}