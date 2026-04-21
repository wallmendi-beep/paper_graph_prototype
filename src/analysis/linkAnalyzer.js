import { ANALYSIS_LIMITS } from "../config.js";

const CONTRAST_MARKERS = new Set(["but", "however", "although", "yet", "whereas", "instead"]);
const ANTONYM_PAIRS = [
  ["increase", "decrease"],
  ["improve", "worsen"],
  ["support", "oppose"],
  ["allow", "block"],
  ["enable", "prevent"],
  ["accept", "reject"]
];

/**
 * Measures lexical overlap between two sentence token lists.
 *
 * @param {Array<{token: string, count: number}>} currentRefs
 * @param {Array<{token: string, count: number}>} neighborRefs
 * @returns {{sharedTokens: string[], score: number}}
 */
function computeSentenceSimilarity(currentRefs, neighborRefs) {
  const currentMap = new Map(currentRefs.map((item) => [item.token, item.count]));
  const neighborMap = new Map(neighborRefs.map((item) => [item.token, item.count]));
  const sharedTokens = [];
  let overlapScore = 0;

  currentMap.forEach((count, token) => {
    if (!neighborMap.has(token)) {
      return;
    }
    overlapScore += Math.min(count, neighborMap.get(token));
    sharedTokens.push(token);
  });

  return {
    sharedTokens,
    score: overlapScore / Math.max(Math.min(currentRefs.length, neighborRefs.length), 1)
  };
}

/**
 * Produces a decay factor for sentence distance.
 *
 * @param {number} leftIndex
 * @param {number} rightIndex
 * @returns {number}
 */
function computeDistanceWeight(leftIndex, rightIndex) {
  return 1 / (Math.abs(leftIndex - rightIndex) + 1);
}

/**
 * Checks whether a sentence contains explicit contrast markers.
 *
 * @param {{text: string}} sentenceNode
 * @returns {boolean}
 */
function sentenceHasContrast(sentenceNode) {
  const lowered = sentenceNode.text.toLowerCase();
  return [...CONTRAST_MARKERS].some((marker) => lowered.includes(marker));
}

/**
 * Detects antonym usage across two token sets.
 *
 * @param {Set<string>} tokensA
 * @param {Set<string>} tokensB
 * @returns {boolean}
 */
function hasAntonymConflict(tokensA, tokensB) {
  return ANTONYM_PAIRS.some(([left, right]) =>
    (tokensA.has(left) && tokensB.has(right)) || (tokensA.has(right) && tokensB.has(left))
  );
}

/**
 * Scores a contradiction candidate between two sentence nodes.
 *
 * @param {object} leftNode
 * @param {object} rightNode
 * @param {{sharedTokens: string[], score: number}} similarity
 * @param {Set<string>} leftTokens
 * @param {Set<string>} rightTokens
 * @returns {object | null}
 */
function computeContradiction(leftNode, rightNode, similarity, leftTokens, rightTokens) {
  const polarityConflict = leftNode.polarity !== rightNode.polarity;
  const antonymConflict = hasAntonymConflict(leftTokens, rightTokens);
  const contrastBoost = sentenceHasContrast(leftNode) || sentenceHasContrast(rightNode) ? 0.08 : 0;
  const certaintyBoost = leftNode.certaintyTokens.length > 0 || rightNode.certaintyTokens.length > 0 ? 0.06 : 0;
  const sharedConcepts = similarity.sharedTokens.slice(0, 5);
  if (sharedConcepts.length < ANALYSIS_LIMITS.minSharedConceptsForContradiction) {
    return null;
  }
  if (!polarityConflict && !antonymConflict) {
    return null;
  }
  const score = Math.min(
    1,
    similarity.score * 0.7 + (polarityConflict ? 0.22 : 0) + (antonymConflict ? 0.2 : 0) + contrastBoost + certaintyBoost
  );
  if (score < ANALYSIS_LIMITS.contradictionThreshold) {
    return null;
  }
  return {
    score: Number(score.toFixed(3)),
    sharedConcepts,
    reasons: [
      polarityConflict ? "polarity-conflict" : null,
      antonymConflict ? "antonym-conflict" : null,
      contrastBoost ? "contrast-marker" : null,
      certaintyBoost ? "certainty-claim" : null
    ].filter(Boolean)
  };
}

/**
 * Appends pairwise sentence and contradiction links for one source sentence.
 *
 * @param {object} parsed
 * @param {number} index
 * @param {Array<object>} sentenceLinks
 * @param {Array<object>} contradictionLinks
 * @returns {void}
 */
function collectSentenceNeighborLinks(parsed, index, sentenceLinks, contradictionLinks) {
  const start = Math.max(0, index - ANALYSIS_LIMITS.sentenceWindow);
  const end = Math.min(parsed.sentenceNodes.length - 1, index + ANALYSIS_LIMITS.sentenceWindow);
  for (let neighborIndex = start; neighborIndex <= end; neighborIndex += 1) {
    if (neighborIndex <= index) {
      continue;
    }
    const similarity = computeSentenceSimilarity(parsed.sentenceTokens[index], parsed.sentenceTokens[neighborIndex]);
    const weightedScore = Math.min(1, similarity.score * (0.72 + computeDistanceWeight(index, neighborIndex) * 0.6));
    if (weightedScore > 0) {
      sentenceLinks.push({
        id: `sentence-link:${index}-${neighborIndex}`,
        source: `sentence:${index}`,
        target: `sentence:${neighborIndex}`,
        weight: Number(weightedScore.toFixed(3)),
        sharedTokens: similarity.sharedTokens
      });
    }
    const contradiction = computeContradiction(
      parsed.sentenceNodes[index],
      parsed.sentenceNodes[neighborIndex],
      similarity,
      parsed.sentenceTokenSets[index],
      parsed.sentenceTokenSets[neighborIndex]
    );
    if (contradiction) {
      contradictionLinks.push({
        id: `contradiction-link:${index}-${neighborIndex}`,
        source: `sentence:${index}`,
        target: `sentence:${neighborIndex}`,
        weight: contradiction.score,
        sharedTokens: contradiction.sharedConcepts,
        reasons: contradiction.reasons
      });
    }
  }
}

/**
 * Appends sentence-to-token links for one sentence node.
 *
 * @param {object} parsed
 * @param {number} index
 * @param {Array<object>} tokenLinks
 * @returns {void}
 */
function collectTokenLinks(parsed, index, tokenLinks) {
  const rankedTokens = [...parsed.sentenceTokens[index]]
    .sort((left, right) => right.count - left.count || left.token.localeCompare(right.token))
    .slice(0, ANALYSIS_LIMITS.tokenTopLinks);
  rankedTokens.forEach(({ token, count }) => {
    const tokenNode = parsed.tokenLookup.get(token);
    if (!tokenNode) {
      return;
    }
    const rarityBoost = Math.min(1.45, 1 + 1 / tokenNode.sentenceIndexes.length);
    const weight = Math.min(1, (count / Math.max(rankedTokens[0]?.count || 1, 1)) * 0.72 * rarityBoost);
    tokenLinks.push({
      id: `token-link:${index}:${token}`,
      source: `sentence:${index}`,
      target: tokenNode.id,
      weight: Number(weight.toFixed(3)),
      token,
      occurrencesInSentence: count
    });
  });
}

/**
 * Builds the connectivity summary for sentence nodes.
 *
 * @param {object} parsed
 * @param {Array<object>} sentenceLinks
 * @param {Array<object>} contradictionLinks
 * @returns {object}
 */
function buildConnectivityReport(parsed, sentenceLinks, contradictionLinks) {
  const degree = new Map(parsed.sentenceNodes.map((node) => [node.id, 0]));
  sentenceLinks.forEach((link) => {
    if (link.weight >= ANALYSIS_LIMITS.strongLinkThreshold) {
      degree.set(link.source, degree.get(link.source) + 1);
      degree.set(link.target, degree.get(link.target) + 1);
    }
  });
  const isolatedSentences = parsed.sentenceNodes.filter((node) => degree.get(node.id) === 0).map((node) => node.label);
  const bridgeSentences = [...degree.entries()]
    .filter(([, linkCount]) => linkCount >= 2)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([nodeId, linkCount]) => ({ nodeId, label: nodeId.replace("sentence:", "S"), linkCount }));
  return { isolatedSentences, bridgeSentences, contradictionCount: contradictionLinks.length };
}

/**
 * Analyzes sentence relationships and contradiction signals.
 *
 * @param {object} parsed
 * @returns {{sentenceLinks: Array<object>, tokenLinks: Array<object>, contradictionLinks: Array<object>, connectivity: object}}
 */
export function analyzeLogicalLinks(parsed) {
  const sentenceLinks = [];
  const tokenLinks = [];
  const contradictionLinks = [];
  parsed.sentenceNodes.forEach((_, index) => {
    collectSentenceNeighborLinks(parsed, index, sentenceLinks, contradictionLinks);
    collectTokenLinks(parsed, index, tokenLinks);
  });
  return {
    sentenceLinks,
    tokenLinks,
    contradictionLinks,
    connectivity: buildConnectivityReport(parsed, sentenceLinks, contradictionLinks)
  };
}
