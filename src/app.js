import { samplePaperText } from "./samplePaper.js";
import { COPY } from "./config.js";
import { analyzeLogicalLinks } from "./analysis/linkAnalyzer.js";
import { buildGraphModel, buildNodeContext } from "./analysis/graphBuilder.js";
import { parsePaperText } from "./parsing/paperParser.js";
import { renderRadialGraph } from "./ui/radialGraph.js";
import { renderContextPanel, renderIssuePanel } from "./ui/contextPanel.js";
import { extractTextFromFile, loadGoogleDocText } from "./io/documentLoader.js";

const input = document.querySelector("#paper-input");
const fileInput = document.querySelector("#document-file");
const docsUrlInput = document.querySelector("#google-docs-url");
const analyzeButton = document.querySelector("#analyze-button");
const loadSampleButton = document.querySelector("#load-sample-button");
const loadDocsButton = document.querySelector("#load-docs-button");
const graphRoot = document.querySelector("#graph-root");
const contextPanel = document.querySelector("#context-panel");
const issuesPanel = document.querySelector("#issues-panel");
const statsPanel = document.querySelector("#stats-panel");
const statusBar = document.querySelector("#status-bar");
const sourceMeta = document.querySelector("#source-meta");

let currentState = null;
let pendingSource = { label: "Manual text" };
let analysisWorker = null;
let activeRequestId = 0;
let workerTimeoutId = null;

/**
 * Creates a serializable analysis state from raw text.
 *
 * @param {string} text
 * @param {{label?: string}} source
 * @returns {object}
 */
function buildAnalysisState(text, source) {
  const parsed = parsePaperText(text, source);
  const analysis = analyzeLogicalLinks(parsed);
  const graphModel = buildGraphModel(parsed, analysis);
  return {
    parsed,
    analysis,
    graphModel,
    defaultContext: buildNodeContext(graphModel, parsed, analysis, parsed.sentenceNodes[0]?.id || parsed.documentNode.id)
  };
}

/**
 * Clears any pending worker timeout.
 *
 * @returns {void}
 */
function clearWorkerTimeout() {
  if (workerTimeoutId) {
    window.clearTimeout(workerTimeoutId);
    workerTimeoutId = null;
  }
}

/**
 * Attempts to create the background analysis worker.
 *
 * @returns {Worker | null}
 */
function createAnalysisWorker() {
  try {
    return new Worker(new URL("./workers/analysisWorker.js", import.meta.url), { type: "module" });
  } catch (error) {
    console.warn("Falling back to main-thread analysis because the worker could not be created.", error);
    return null;
  }
}

/**
 * Applies an analysis result to the UI.
 *
 * @param {object} nextState
 * @returns {void}
 */
function applyAnalysisState(nextState) {
  currentState = nextState;
  renderStats(currentState.graphModel.stats);
  renderRadialGraph(graphRoot, currentState.graphModel, setContextForNode);
  renderContextPanel(contextPanel, currentState.defaultContext);
  renderIssuePanel(issuesPanel, currentState.analysis);
  setStatus(`Analysis complete: ${currentState.graphModel.stats.sentences} sentences, ${currentState.graphModel.stats.contradictions} contradiction signals.`, "success");
}

/**
 * Runs analysis on the main thread as a compatibility fallback.
 *
 * @param {string} text
 * @param {{label?: string}} source
 * @returns {void}
 */
function runAnalysisFallback(text, source) {
  try {
    applyAnalysisState(buildAnalysisState(text, source));
  } catch (error) {
    setStatus(`Analysis failed: ${error.message}`, "error");
  }
}

/**
 * Updates the status bar.
 *
 * @param {string} message
 * @param {string} [tone]
 * @returns {void}
 */
function setStatus(message, tone = "muted") {
  statusBar.textContent = message;
  statusBar.dataset.tone = tone;
}

/**
 * Renders statistics from the current graph model.
 *
 * @param {Record<string, string | number>} stats
 * @returns {void}
 */
function renderStats(stats) {
  statsPanel.replaceChildren();
  Object.entries(stats).forEach(([label, value]) => {
    const wrapper = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = String(value);
    wrapper.append(term, description);
    statsPanel.appendChild(wrapper);
  });
}

/**
 * Updates the context panel for a selected node.
 *
 * @param {string} nodeId
 * @returns {void}
 */
function setContextForNode(nodeId) {
  if (!currentState) {
    return;
  }
  const context = buildNodeContext(currentState.graphModel, currentState.parsed, currentState.analysis, nodeId);
  renderContextPanel(contextPanel, context);
}

/**
 * Dispatches document text to the analysis worker.
 *
 * @param {string} text
 * @param {{label: string}} [source]
 * @returns {void}
 */
function analyzeText(text, source = { label: "Manual text" }) {
  const trimmed = text.trim();
  if (!trimmed) {
    setStatus("Nothing to analyze. Provide some text first.", "error");
    return;
  }
  pendingSource = source;
  sourceMeta.textContent = source.label;
  setStatus("Analyzing document...", "working");
  activeRequestId += 1;
  clearWorkerTimeout();
  if (!analysisWorker) {
    runAnalysisFallback(trimmed, source);
    return;
  }
  const requestId = activeRequestId;
  workerTimeoutId = window.setTimeout(() => {
    if (requestId !== activeRequestId) {
      return;
    }
    analysisWorker?.terminate();
    analysisWorker = createAnalysisWorker();
    setStatus("Worker did not respond. Retrying analysis on the main thread...", "working");
    runAnalysisFallback(trimmed, source);
  }, 4000);
  analysisWorker.postMessage({ text: trimmed, source, requestId });
}

/**
 * Loads and analyzes a selected local file.
 *
 * @returns {Promise<void>}
 */
async function handleFileSelection() {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }
  setStatus(`Extracting text from ${file.name}...`, "working");
  try {
    const result = await extractTextFromFile(file);
    input.value = result.text;
    sourceMeta.textContent = result.sourceLabel;
    analyzeText(result.text, { label: result.sourceLabel });
  } catch (error) {
    setStatus(error.message, "error");
  }
}

/**
 * Loads and analyzes a Google Docs source.
 *
 * @returns {Promise<void>}
 */
async function handleGoogleDocsLoad() {
  const url = docsUrlInput.value.trim();
  if (!url) {
    setStatus("Enter a Google Docs URL.", "error");
    return;
  }
  setStatus("Loading Google Docs text...", "working");
  try {
    const result = await loadGoogleDocText(url);
    input.value = result.text;
    sourceMeta.textContent = result.sourceLabel;
    analyzeText(result.text, { label: result.sourceLabel });
  } catch (error) {
    setStatus(error.message, "error");
  }
}

/**
 * Loads the bundled sample paper.
 *
 * @returns {void}
 */
function loadSample() {
  input.value = samplePaperText;
  analyzeText(samplePaperText, { label: "Sample document" });
}

/**
 * Handles worker responses after analysis completes.
 *
 * @param {{data: object}} event
 * @returns {void}
 */
function handleWorkerMessage(event) {
  const { requestId, ...nextState } = event.data;
  if (requestId !== activeRequestId) {
    return;
  }
  clearWorkerTimeout();
  applyAnalysisState(nextState);
}

/**
 * Handles worker failures.
 *
 * @param {{message: string}} error
 * @returns {void}
 */
function handleWorkerError(error) {
  console.error("Worker analysis failed.", error);
  clearWorkerTimeout();
  analysisWorker?.terminate();
  analysisWorker = createAnalysisWorker();
  setStatus("Worker failed. Retrying analysis on the main thread...", "working");
  runAnalysisFallback(input.value, pendingSource);
}

/**
 * Submits the current text for analysis.
 *
 * @returns {void}
 */
function handleAnalyzeClick() {
  analyzeText(input.value, pendingSource);
}

/**
 * Resets pending source metadata after manual edits.
 *
 * @returns {void}
 */
function resetPendingSource() {
  pendingSource = { label: "Manual text" };
  sourceMeta.textContent = pendingSource.label;
}

/**
 * Renders the current graph again after a resize.
 *
 * @returns {void}
 */
function rerenderGraph() {
  if (currentState) {
    renderRadialGraph(graphRoot, currentState.graphModel, setContextForNode);
  }
}

analysisWorker = createAnalysisWorker();
if (analysisWorker) {
  analysisWorker.onmessage = handleWorkerMessage;
  analysisWorker.onerror = handleWorkerError;
}

analyzeButton.addEventListener("click", handleAnalyzeClick);
loadSampleButton.addEventListener("click", loadSample);
loadDocsButton.addEventListener("click", handleGoogleDocsLoad);
fileInput.addEventListener("change", handleFileSelection);
input.addEventListener("input", resetPendingSource);
window.addEventListener("resize", rerenderGraph);

document.querySelector("#app-title").textContent = COPY.appTitle;
document.querySelector("#app-intro").textContent = COPY.intro;
renderContextPanel(contextPanel, null);
setStatus("Provide a document or paste text to start the analysis.");
loadSample();
