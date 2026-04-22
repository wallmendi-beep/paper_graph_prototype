import { ANALYSIS_LIMITS, EDGE_KINDS, NODE_TYPES } from "../config.js";

/**
 * Builds the rendered link list for the graph model.
 *
 * @param {object} parsed
 * @param {object} analysis
 * @returns {Array<object>}
 */
function collectLinks(parsed, analysis) {
  const hierarchyLinks = parsed.sentenceNodes.map((sentenceNode) => ({
    id: `doc-link:${sentenceNode.id}`,
    source: parsed.documentNode.id,
    target: sentenceNode.id,
    weight: 0.6,
    kind: EDGE_KINDS.HIERARCHY
  }));
  const tokenLinks = analysis.tokenLinks.map((link) => ({ ...link, kind: EDGE_KINDS.TOKEN }));
  const sentenceLinks = analysis.sentenceLinks
    .filter((link) => link.weight >= ANALYSIS_LIMITS.strongLinkThreshold)
    .map((link) => ({ ...link, kind: EDGE_KINDS.SENTENCE }));
  const contradictionLinks = analysis.contradictionLinks.map((link) => ({ ...link, kind: EDGE_KINDS.CONTRADICTION }));
  return [...hierarchyLinks, ...tokenLinks, ...sentenceLinks, ...contradictionLinks];
}

/**
 * Builds summary statistics for the graph model.
 *
 * @param {object} parsed
 * @param {object} analysis
 * @param {Array<object>} links
 * @returns {object}
 */
function buildGraphStats(parsed, analysis, links) {
  return {
    source: parsed.meta.sourceLabel,
    sentences: parsed.meta.sentenceCount,
    tokenNodes: parsed.meta.tokenNodeCount,
    renderedLinks: links.length,
    strongSentenceLinks: analysis.sentenceLinks.filter((link) => link.weight >= ANALYSIS_LIMITS.strongLinkThreshold).length,
    contradictions: analysis.contradictionLinks.length,
    isolatedSentences: analysis.connectivity.isolatedSentences.length,
    truncated: parsed.meta.truncated ? "Yes" : "No"
  };
}

/**
 * Builds a graph model consumable by the radial graph renderer.
 *
 * @param {object} parsed
 * @param {object} analysis
 * @returns {{nodes: Array<object>, links: Array<object>, stats: object}}
 */
export function buildGraphModel(parsed, analysis) {
  const nodes = [parsed.documentNode, ...parsed.sentenceNodes, ...parsed.tokenNodes];
  const links = collectLinks(parsed, analysis);
  return { nodes, links, stats: buildGraphStats(parsed, analysis, links) };
}

/**
 * Builds the document-level context payload.
 *
 * @param {object} parsed
 * @param {object} analysis
 * @returns {object}
 */
function buildDocumentContext(parsed, analysis) {
  return {
    title: parsed.meta.sourceLabel,
    subtitle: "Document root",
    body: "The root summarizes the full document and exposes sentence, concept, and contradiction totals for the current analysis.",
    tags: [
      `Sentences ${parsed.sentenceNodes.length}`,
      `Tokens ${parsed.tokenNodes.length}`,
      `Contradictions ${analysis.contradictionLinks.length}`
    ],
    connectivity: analysis.connectivity.bridgeSentences.slice(0, 5).map((item) => ({
      nodeId: item.nodeId,
      label: `${item.label} ties together ${item.linkCount} strong links.`,
      tone: "neutral"
    })),
    contradictions: analysis.contradictionLinks.slice(0, 4).map((link) => ({
      nodeId: link.source,
      secondaryNodeId: link.target,
      label: `${link.source.replace("sentence:", "S")} vs ${link.target.replace("sentence:", "S")} [${link.reasons.join(", ")}]`,
      tone: "danger"
    }))
  };
}

/**
 * Formats sentence-linked items for the context panel.
 *
 * @param {Array<object>} links
 * @param {string} nodeId
 * @param {number} limit
 * @param {(link: object) => string} formatter
 * @returns {string[]}
 */
function getSentenceDetailList(links, nodeId, limit, formatter) {
  return links
    .filter((link) => link.source === nodeId || link.target === nodeId)
    .sort((left, right) => right.weight - left.weight)
    .slice(0, limit)
    .map(formatter);
}

/**
 * Resolves the opposite sentence id in a pairwise link.
 *
 * @param {object} link
 * @param {string} nodeId
 * @returns {string}
 */
function getRelatedSentenceId(link, nodeId) {
  return link.source === nodeId ? link.target : link.source;
}

/**
 * Builds context for a sentence node.
 *
 * @param {object} node
 * @param {object} analysis
 * @returns {object}
 */
function buildSentenceContext(node, analysis) {
  const tags = analysis.tokenLinks
    .filter((link) => link.source === node.id)
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 6)
    .map((link) => `${link.token} (${link.weight})`);
  const connectivity = getSentenceDetailList(analysis.sentenceLinks, node.id, 4, (link) => {
    const relatedId = getRelatedSentenceId(link, node.id);
    return {
      nodeId: relatedId,
      label: `${relatedId.replace("sentence:", "S")} shared concepts ${link.sharedTokens.slice(0, 3).join(", ") || "n/a"} (${link.weight})`,
      tone: "neutral"
    };
  });
  const contradictions = getSentenceDetailList(analysis.contradictionLinks, node.id, 4, (link) => {
    const relatedId = getRelatedSentenceId(link, node.id);
    return {
      nodeId: relatedId,
      label: `Conflict ${relatedId.replace("sentence:", "S")} [${link.reasons.join(", ")}]`,
      tone: "danger"
    };
  });
  return {
    title: node.label,
    subtitle: `Sentence ${node.sentenceIndex + 1} with ${node.polarity} polarity`,
    body: node.text,
    tags,
    connectivity,
    contradictions
  };
}

/**
 * Builds context for a token node.
 *
 * @param {object} node
 * @param {object} analysis
 * @returns {object}
 */
function buildTokenContext(node, analysis) {
  const linkedSentences = analysis.tokenLinks
    .filter((link) => link.target === node.id)
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 6)
    .map((link) => ({
      nodeId: link.source,
      label: `${link.source.replace("sentence:", "S")} mentions this concept ${link.occurrencesInSentence} time(s).`,
      tone: "neutral"
    }));
  return {
    title: node.label,
    subtitle: "Shared concept",
    body: `This concept appears in ${node.sentenceIndexes.length} sentence(s) and highlights recurring evidence in the document.`,
    tags: linkedSentences.map((item) => item.label.replace(" mentions this concept ", " ")),
    connectivity: linkedSentences,
    contradictions: []
  };
}

/**
 * Builds the context payload for a selected graph node.
 *
 * @param {object} graphModel
 * @param {object} parsed
 * @param {object} analysis
 * @param {string} selectedNodeId
 * @returns {object | null}
 */
export function buildNodeContext(graphModel, parsed, analysis, selectedNodeId) {
  const node = graphModel.nodes.find((item) => item.id === selectedNodeId);
  if (!node) {
    return null;
  }
  if (node.type === NODE_TYPES.DOCUMENT) {
    return buildDocumentContext(parsed, analysis);
  }
  if (node.type === NODE_TYPES.SENTENCE) {
    return buildSentenceContext(node, analysis);
  }
  return buildTokenContext(node, analysis);
}
