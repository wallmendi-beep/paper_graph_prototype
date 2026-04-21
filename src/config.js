export const ANALYSIS_LIMITS = {
  maxSentences: 220,
  maxTokensPerSentence: 18,
  maxGlobalTokenNodes: 320,
  tokenMinLength: 2,
  tokenTopLinks: 5,
  sentenceWindow: 3,
  strongLinkThreshold: 0.12,
  contradictionThreshold: 0.18,
  minSharedConceptsForContradiction: 2
};

export const NODE_TYPES = {
  DOCUMENT: "document",
  SENTENCE: "sentence",
  TOKEN: "token"
};

export const EDGE_KINDS = {
  HIERARCHY: "hierarchy",
  TOKEN: "token",
  SENTENCE: "sentence",
  CONTRADICTION: "contradiction"
};

export const COPY = {
  appTitle: "Document Logic Graph",
  intro: "Extract text from Word, PDF, or Google Docs files and inspect how sentences and recurring concepts connect across the document.",
  emptyGraph: "Provide a document or paste text to render the logic graph.",
  graphNote: "Sentences are placed on the inner ring, concepts on the outer ring, and contradiction links are highlighted.",
  defaultContext: "Select a node to inspect the underlying sentence, connections, and contradiction signals."
};
