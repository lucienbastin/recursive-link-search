import {
	Editor,
	MarkdownView,
	MarkdownFileInfo,
	Modal,
	Notice,
	Plugin,
} from 'obsidian';
import {
	DEFAULT_SETTINGS,
	RecursiveLinksSearchSettings,
	SampleSettingTab,
} from './settings';
import { RelationsParser } from './relations-parser';
import { DiGraph } from "digraph-js";

// Remember to rename these classes and interfaces!

export default class RecursiveLinksSearch extends Plugin {
	private relationsParser: RelationsParser;

	settings!: RecursiveLinksSearchSettings;

	async onload() {
		console.clear()

		await this.loadSettings();

		this.relationsParser = new RelationsParser(this.app);
		await this.relationsParser.loadProperties();

		// Setup the relationships graph

		const graph = new DiGraph()

		let fileRelations = this.relationsParser.fileProperties;
		let vertices = new Map<string, Vertex>();

		for (const [file, relations] of fileRelations) {
			let vertex = {id: file, adjacentTo: [], body: {}};
			graph.addVertices(vertex);
			vertices.set(file, vertex);
		}

		for (const [file, relations] of fileRelations) {
			for (const [key, values] of relations) {
				for (let parent of values) {
					graph.addEdge({from: file, to: parent});
				}
			}
		}

		for (const [name, vertex] of vertices) {
			const children = [...graph.getDeepParents(vertex.id)];

			console.log(
				`${vertex.id} → ${children.map(child => child).join(", ")}`
			);
		}
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<RecursiveLinksSearchSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
