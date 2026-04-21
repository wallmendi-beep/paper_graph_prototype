import assert from "node:assert/strict";
import { parsePaperText } from "../src/parsing/paperParser.js";
import { analyzeLogicalLinks } from "../src/analysis/linkAnalyzer.js";
import { buildGraphModel, buildNodeContext } from "../src/analysis/graphBuilder.js";

const sample = `
The model improves answer quality when evidence is present.
The model does not improve answer quality when evidence is present.
Graph analysis links evidence, model, and answer nodes across the report.
`;

const parsed = parsePaperText(sample, { label: "Test document" });
assert.equal(parsed.sentenceNodes.length, 3);
assert.ok(parsed.tokenNodes.length > 0);

const analysis = analyzeLogicalLinks(parsed);
assert.ok(analysis.sentenceLinks.length > 0);
assert.ok(analysis.contradictionLinks.length >= 1);
assert.equal(analysis.connectivity.contradictionCount, analysis.contradictionLinks.length);

const graph = buildGraphModel(parsed, analysis);
assert.equal(graph.stats.sentences, 3);
assert.ok(graph.links.some((link) => link.kind === "contradiction"));

const context = buildNodeContext(graph, parsed, analysis, "sentence:0");
assert.equal(context.title, "S1");
assert.ok(context.connectivity.length > 0 || context.contradictions.length > 0);

console.log("pipeline.test.mjs passed");
