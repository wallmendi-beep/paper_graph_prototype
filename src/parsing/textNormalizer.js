/**
 * Applies lightweight stemming to a token.
 *
 * @param {string} token
 * @returns {string}
 */
function stemToken(token) {
  if (token.length <= 4) {
    return token;
  }
  return token.replace(/(ingly|edly)$/g, "").replace(/(ing|ed|es|s)$/g, "");
}

/**
 * Normalizes whitespace while preserving paragraph breaks.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeWhitespace(text) {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Splits normalized text into sentence-like segments.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitIntoSentences(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/(?<=[.!?])\s+|(?<=\n)\s*(?=[^\n])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * Tokenizes a sentence into normalized lexical units.
 *
 * @param {string} sentence
 * @returns {string[]}
 */
export function tokenizeSentence(sentence) {
  const matches = sentence.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{1,}/gu) || [];
  return matches.map((token) => stemToken(token.trim())).filter((token) => token.length >= 2);
}
