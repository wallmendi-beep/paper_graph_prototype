import { parsePaperText } from "../parsing/paperParser.js";
import { analyzeLogicalLinks } from "../analysis/linkAnalyzer.js";
import { buildGraphModel, buildNodeContext } from "../analysis/graphBuilder.js";

/**
 * Builds the worker response payload.
 *
 * @param {string} text
 * @param {{label?: string}} source
 * @param {number} requestId
 * @returns {object}
 */
function buildWorkerResponse(text, source, requestId) {
  const parsed = parsePaperText(text, source);
  const analysis = analyzeLogicalLinks(parsed);
  const graphModel = buildGraphModel(parsed, analysis);
  return {
    requestId,
    parsed,
    analysis,
    graphModel,
    defaultContext: buildNodeContext(graphModel, parsed, analysis, parsed.sentenceNodes[0]?.id || parsed.documentNode.id)
  };
}

/**
 * Handles requests sent to the analysis worker.
 *
 * @param {{data: {text: string, source: {label?: string}, requestId?: number}}} event
 * @returns {void}
 */
function handleWorkerRequest(event) {
  const { text, source, requestId = 0 } = event.data;
  self.postMessage(buildWorkerResponse(text, source, requestId));
}

self.onmessage = handleWorkerRequest;
