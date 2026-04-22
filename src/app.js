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
const graphSearchInput = document.querySelector("#graph-search");
const clearSearchButton = document.querySelector("#clear-search-button");
const contradictionsOnlyInput = document.querySelector("#contradictions-only");
const graphSummary = document.querySelector("#graph-summary");
const navBackButton = document.querySelector("#nav-back-button");
const navForwardButton = document.querySelector("#nav-forward-button");

let currentState = null;
let pendingSource = { label: "Manual text" };
let analysisWorker = null;
let activeRequestId = 0;
let workerTimeoutId = null;
let selectedNodeId = "";
let graphSearchTerm = "";
let contradictionsOnly = false;
let selectionHistory = [];
let selectionIndex = -1;

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
  selectedNodeId = nextState.defaultContext?.title === "S1" ? "sentence:0" : nextState.parsed.sentenceNodes[0]?.id || nextState.parsed.documentNode.id;
  selectionHistory = [];
  selectionIndex = -1;
  renderStats(currentState.graphModel.stats);
  setContextForNode(selectedNodeId, true);
  renderIssuePanel(issuesPanel, currentState.analysis);
  renderGraph();
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
 * Finds a node by id.
 *
 * @param {string} nodeId
 * @returns {object | undefined}
 */
function getNodeById(nodeId) {
  return currentState?.graphModel.nodes.find((node) => node.id === nodeId);
}

/**
 * Resolves one-hop related nodes for search and focus highlighting.
 *
 * @param {string[]} seedIds
 * @param {object} graphModel
 * @returns {Set<string>}
 */
function expandRelatedNodeIds(seedIds, graphModel) {
  const visibleNodeIds = new Set(seedIds);
  graphModel.links.forEach((link) => {
    if (visibleNodeIds.has(link.source) || visibleNodeIds.has(link.target)) {
      visibleNodeIds.add(link.source);
      visibleNodeIds.add(link.target);
    }
  });
  return visibleNodeIds;
}

/**
 * Builds a display graph model based on current filters.
 *
 * @returns {{graphModel: object, highlightedNodeIds: Set<string>, summary: string}}
 */
function buildDisplayGraphState() {
  if (!currentState) {
    return { graphModel: null, highlightedNodeIds: new Set(), summary: "" };
  }
  const baseGraph = currentState.graphModel;
  let visibleNodeIds = new Set(baseGraph.nodes.map((node) => node.id));
  let summaryParts = ["전체 그래프를 표시 중입니다."];

  if (contradictionsOnly) {
    const contradictionSentenceIds = new Set();
    currentState.analysis.contradictionLinks.forEach((link) => {
      contradictionSentenceIds.add(link.source);
      contradictionSentenceIds.add(link.target);
    });
    visibleNodeIds = expandRelatedNodeIds([...contradictionSentenceIds], baseGraph);
    summaryParts = [`충돌 후보 관련 노드 ${visibleNodeIds.size}개를 표시 중입니다.`];
  }

  let highlightedNodeIds = new Set();
  if (graphSearchTerm) {
    const term = graphSearchTerm.toLowerCase();
    const matchedNodeIds = baseGraph.nodes
      .filter((node) => {
        const haystacks = [node.label, node.text, node.token, node.type].filter(Boolean).map((value) => String(value).toLowerCase());
        return haystacks.some((value) => value.includes(term));
      })
      .map((node) => node.id);
    highlightedNodeIds = expandRelatedNodeIds(matchedNodeIds, baseGraph);
    if (matchedNodeIds.length > 0) {
      visibleNodeIds = new Set([...visibleNodeIds].filter((nodeId) => highlightedNodeIds.has(nodeId)));
      summaryParts.push(`검색어 "${graphSearchTerm}"와 연결된 노드 ${visibleNodeIds.size}개를 보여줍니다.`);
    } else {
      visibleNodeIds = new Set();
      summaryParts.push(`검색어 "${graphSearchTerm}"에 맞는 노드를 찾지 못했습니다.`);
    }
  }

  if (selectedNodeId && baseGraph.nodes.some((node) => node.id === selectedNodeId)) {
    highlightedNodeIds.add(selectedNodeId);
  }

  const nodes = baseGraph.nodes.filter((node) => visibleNodeIds.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = baseGraph.links.filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target));
  return {
    graphModel: { ...baseGraph, nodes, links },
    highlightedNodeIds,
    summary: summaryParts.join(" ")
  };
}

/**
 * Updates history buttons.
 *
 * @returns {void}
 */
function renderNavigationState() {
  if (navBackButton) {
    navBackButton.disabled = selectionIndex <= 0;
  }
  if (navForwardButton) {
    navForwardButton.disabled = selectionIndex < 0 || selectionIndex >= selectionHistory.length - 1;
  }
}

/**
 * Renders the graph with current filters.
 *
 * @returns {void}
 */
function renderGraph() {
  const { graphModel, highlightedNodeIds, summary } = buildDisplayGraphState();
  if (graphSummary) {
    graphSummary.textContent = summary;
  }
  renderRadialGraph(graphRoot, graphModel, setContextForNode, { selectedNodeId, highlightedNodeIds });
  renderNavigationState();
}

/**
 * Updates the context panel for a selected node.
 *
 * @param {string} nodeId
 * @returns {void}
 */
function setContextForNode(nodeId, skipHistory = false) {
  if (!currentState) {
    return;
  }
  const node = getNodeById(nodeId);
  if (!node) {
    return;
  }
  selectedNodeId = nodeId;
  if (!skipHistory) {
    selectionHistory = selectionHistory.slice(0, selectionIndex + 1);
    selectionHistory.push(nodeId);
    selectionIndex = selectionHistory.length - 1;
  } else if (selectionIndex === -1) {
    selectionHistory = [nodeId];
    selectionIndex = 0;
  }
  const context = buildNodeContext(currentState.graphModel, currentState.parsed, currentState.analysis, nodeId);
  renderContextPanel(contextPanel, context);
  renderGraph();
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
    renderGraph();
  }
}

/**
 * Navigates backward or forward through selected nodes.
 *
 * @param {number} direction
 * @returns {void}
 */
function moveSelection(direction) {
  const nextIndex = selectionIndex + direction;
  if (nextIndex < 0 || nextIndex >= selectionHistory.length) {
    return;
  }
  selectionIndex = nextIndex;
  const nextNodeId = selectionHistory[selectionIndex];
  const context = buildNodeContext(currentState.graphModel, currentState.parsed, currentState.analysis, nextNodeId);
  selectedNodeId = nextNodeId;
  renderContextPanel(contextPanel, context);
  renderGraph();
}

/**
 * Handles delegated panel navigation clicks.
 *
 * @param {MouseEvent} event
 * @returns {void}
 */
function handlePanelNavigation(event) {
  const button = event.target.closest("[data-node-id]");
  if (!button) {
    return;
  }
  const nodeId = button.dataset.secondaryNodeId && selectedNodeId === button.dataset.nodeId
    ? button.dataset.secondaryNodeId
    : button.dataset.nodeId;
  if (nodeId) {
    setContextForNode(nodeId);
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
if (graphSearchInput) {
  graphSearchInput.addEventListener("input", (event) => {
    graphSearchTerm = event.target.value.trim();
    renderGraph();
  });
}
if (clearSearchButton) {
  clearSearchButton.addEventListener("click", () => {
    graphSearchTerm = "";
    if (graphSearchInput) {
      graphSearchInput.value = "";
    }
    renderGraph();
  });
}
if (contradictionsOnlyInput) {
  contradictionsOnlyInput.addEventListener("change", (event) => {
    contradictionsOnly = event.target.checked;
    renderGraph();
  });
}
if (navBackButton) {
  navBackButton.addEventListener("click", () => moveSelection(-1));
}
if (navForwardButton) {
  navForwardButton.addEventListener("click", () => moveSelection(1));
}
if (contextPanel) {
  contextPanel.addEventListener("click", handlePanelNavigation);
}
if (issuesPanel) {
  issuesPanel.addEventListener("click", handlePanelNavigation);
}
window.addEventListener("resize", rerenderGraph);

document.querySelector("#app-title").textContent = COPY.appTitle;
document.querySelector("#app-intro").textContent = COPY.intro;
renderContextPanel(contextPanel, null);
setStatus("Provide a document or paste text to start the analysis.");
loadSample();
