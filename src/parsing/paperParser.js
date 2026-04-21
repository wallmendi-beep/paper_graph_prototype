import { ANALYSIS_LIMITS, NODE_TYPES } from "../config.js";
import { splitIntoSentences, tokenizeSentence } from "./textNormalizer.js";

const STOP_WORDS = new Set([
  "about", "after", "also", "among", "and", "are", "because", "been", "between",
  "both", "but", "can", "does", "each", "for", "from", "have", "into", "its",
  "local", "more", "only", "over", "paper", "remain", "such", "than", "that",
  "the", "their", "them", "there", "these", "they", "this", "those", "through",
  "under", "using", "where", "which", "with", "within", "while", "yet", "allow",
  "support", "system", "engine", "document", "sentence", "analysis", "logic"
]);
const NEGATION_MARKERS = new Set(["no", "not", "never", "without", "lack", "lacks", "lacking", "fail", "fails", "failed", "cannot", "can't", "won't"]);
const CERTAINTY_MARKERS = new Set(["always", "clearly", "definitely", "must", "prove", "proves", "confirmed"]);

/**
 * Counts token occurrences.
 *
 * @param {string[]} tokens
 * @returns {Map<string, number>}
 */
function countTokens(tokens) {
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return counts;
}

/**
 * Filters and ranks meaningful token candidates.
 *
 * @param {string[]} tokens
 * @returns {Array<[string, number]>}
 */
function extractTokenCandidates(tokens) {
  return [...countTokens(tokens).entries()]
    .filter(([token]) => token.length >= ANALYSIS_LIMITS.tokenMinLength && !STOP_WORDS.has(token))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

/**
 * Extracts marker tokens from a token list.
 *
 * @param {string[]} tokens
 * @param {Set<string>} dictionary
 * @returns {string[]}
 */
function detectMarkers(tokens, dictionary) {
  return tokens.filter((token) => dictionary.has(token));
}

/**
 * Creates the root document node.
 *
 * @param {{label?: string}} source
 * @returns {object}
 */
function createDocumentNode(source) {
  return {
    id: "doc:root",
    type: NODE_TYPES.DOCUMENT,
    label: source.label || "Document",
    level: 0
  };
}

/**
 * Registers ranked sentence tokens and updates the global token registry.
 *
 * @param {Array<[string, number]>} rankedTokens
 * @param {number} sentenceIndex
 * @param {Map<string, object>} tokenRegistry
 * @param {Map<string, number>} tokenFrequency
 * @returns {Array<{token: string, count: number}>}
 */
function registerTokenRefs(rankedTokens, sentenceIndex, tokenRegistry, tokenFrequency) {
  return rankedTokens.map(([token, count]) => {
    tokenFrequency.set(token, (tokenFrequency.get(token) || 0) + count);
    if (!tokenRegistry.has(token)) {
      tokenRegistry.set(token, {
        id: `token:${token}`,
        type: NODE_TYPES.TOKEN,
        label: token,
        token,
        occurrences: 0,
        sentenceIndexes: new Set(),
        level: 2
      });
    }
    const tokenNode = tokenRegistry.get(token);
    tokenNode.occurrences += count;
    tokenNode.sentenceIndexes.add(sentenceIndex);
    return { token, count };
  });
}

/**
 * Builds sentence-level parsing artifacts.
 *
 * @param {string[]} sentences
 * @returns {object}
 */
function buildSentenceArtifacts(sentences) {
  const sentenceNodes = [];
  const tokenRegistry = new Map();
  const tokenFrequency = new Map();
  const sentenceTokens = [];
  const sentenceTokenSets = [];

  sentences.forEach((sentence, index) => {
    const rawTokens = tokenizeSentence(sentence);
    const rankedTokens = extractTokenCandidates(rawTokens).slice(0, ANALYSIS_LIMITS.maxTokensPerSentence);
    const negationTokens = detectMarkers(rawTokens, NEGATION_MARKERS);
    const certaintyTokens = detectMarkers(rawTokens, CERTAINTY_MARKERS);
    sentenceNodes.push({
      id: `sentence:${index}`,
      type: NODE_TYPES.SENTENCE,
      label: `S${index + 1}`,
      sentenceIndex: index,
      text: sentence,
      level: 1,
      polarity: negationTokens.length > 0 ? "negative" : "positive",
      negationTokens,
      certaintyTokens
    });
    const tokenRefs = registerTokenRefs(rankedTokens, index, tokenRegistry, tokenFrequency);
    sentenceTokens.push(tokenRefs);
    sentenceTokenSets.push(new Set(tokenRefs.map(({ token }) => token)));
  });

  return { sentenceNodes, tokenRegistry, tokenFrequency, sentenceTokens, sentenceTokenSets };
}

/**
 * Selects the highest-signal token nodes for rendering.
 *
 * @param {Map<string, object>} tokenRegistry
 * @returns {object[]}
 */
function selectTokenNodes(tokenRegistry) {
  return [...tokenRegistry.values()]
    .sort((left, right) => right.occurrences - left.occurrences || left.label.localeCompare(right.label))
    .slice(0, ANALYSIS_LIMITS.maxGlobalTokenNodes)
    .map((tokenNode) => ({
      ...tokenNode,
      sentenceIndexes: [...tokenNode.sentenceIndexes].sort((left, right) => left - right)
    }));
}

/**
 * Filters sentence token references down to the selected token nodes.
 *
 * @param {Array<Array<{token: string, count: number}>>} sentenceTokens
 * @param {Set<string>} selectedTokenIds
 * @returns {{filteredSentenceTokens: Array<Array<object>>, filteredSentenceTokenSets: Array<Set<string>>}}
 */
function filterSentenceTokens(sentenceTokens, selectedTokenIds) {
  const filteredSentenceTokens = sentenceTokens.map((refs) => refs.filter(({ token }) => selectedTokenIds.has(`token:${token}`)));
  const filteredSentenceTokenSets = filteredSentenceTokens.map((refs) => new Set(refs.map(({ token }) => token)));
  return { filteredSentenceTokens, filteredSentenceTokenSets };
}

/**
 * Parses free-form text into graph-ready document metadata.
 *
 * @param {string} text
 * @param {{label?: string}} source
 * @returns {object}
 */
export function parsePaperText(text, source = {}) {
  const allSentences = splitIntoSentences(text);
  const sentences = allSentences.slice(0, ANALYSIS_LIMITS.maxSentences);
  const artifacts = buildSentenceArtifacts(sentences);
  const tokenNodes = selectTokenNodes(artifacts.tokenRegistry);
  const selectedTokenIds = new Set(tokenNodes.map((node) => node.id));
  const { filteredSentenceTokens, filteredSentenceTokenSets } = filterSentenceTokens(artifacts.sentenceTokens, selectedTokenIds);

  return {
    documentNode: createDocumentNode(source),
    sentenceNodes: artifacts.sentenceNodes,
    tokenNodes,
    sentenceTokens: filteredSentenceTokens,
    sentenceTokenSets: filteredSentenceTokenSets,
    tokenLookup: new Map(tokenNodes.map((node) => [node.token, node])),
    tokenFrequency: artifacts.tokenFrequency,
    meta: {
      sentenceCount: artifacts.sentenceNodes.length,
      tokenNodeCount: tokenNodes.length,
      truncated: allSentences.length > ANALYSIS_LIMITS.maxSentences,
      sourceLabel: source.label || "Manual text"
    }
  };
}
