import { COPY, EDGE_KINDS, NODE_TYPES } from "../config.js";

/**
 * Resolves a node fill color by node type.
 *
 * @param {string} type
 * @returns {string}
 */
function getColorByType(type) {
  if (type === NODE_TYPES.SENTENCE) {
    return "#c96c50";
  }
  if (type === NODE_TYPES.TOKEN) {
    return "#2f6c6d";
  }
  return "#1f1b16";
}

/**
 * Resolves a node radius by node type.
 *
 * @param {string} type
 * @returns {number}
 */
function getRadiusByType(type) {
  if (type === NODE_TYPES.DOCUMENT) {
    return 14;
  }
  if (type === NODE_TYPES.SENTENCE) {
    return 7;
  }
  return 4.5;
}

/**
 * Builds a hierarchy consumable by D3's radial cluster.
 *
 * @param {object} graphModel
 * @returns {object}
 */
function buildHierarchy(graphModel) {
  const root = { name: "Document", id: "doc:root", children: [] };
  const tokenGroup = { name: "Tokens", children: [] };
  const sentenceChildren = [];
  graphModel.nodes.forEach((node) => {
    if (node.type === NODE_TYPES.SENTENCE) {
      sentenceChildren.push({ name: node.label, id: node.id, nodeType: node.type });
    } else if (node.type === NODE_TYPES.TOKEN) {
      tokenGroup.children.push({ name: node.label, id: node.id, nodeType: node.type });
    }
  });
  root.children.push({ name: "Sentences", children: sentenceChildren }, tokenGroup);
  return d3.hierarchy(root).sum((node) => (node.id ? 1 : 0));
}

/**
 * Resolves a stroke style for a graph link.
 *
 * @param {{kind: string}} link
 * @returns {string}
 */
function getLinkStroke(link) {
  if (link.kind === EDGE_KINDS.CONTRADICTION) {
    return "rgba(182, 36, 29, 0.74)";
  }
  if (link.kind === EDGE_KINDS.SENTENCE) {
    return "rgba(178, 76, 47, 0.42)";
  }
  if (link.kind === EDGE_KINDS.TOKEN) {
    return "rgba(47, 108, 109, 0.18)";
  }
  return "rgba(31, 27, 22, 0.12)";
}

/**
 * Renders the empty graph state.
 *
 * @param {HTMLElement} container
 * @returns {void}
 */
function renderEmptyState(container) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = COPY.emptyGraph;
  container.replaceChildren(empty);
}

/**
 * Appends the static graph note.
 *
 * @param {HTMLElement} container
 * @returns {void}
 */
function appendGraphNote(container) {
  const note = document.createElement("div");
  note.className = "graph-note";
  note.textContent = COPY.graphNote;
  container.appendChild(note);
}

/**
 * Creates the base SVG element.
 *
 * @param {number} width
 * @param {number} height
 * @returns {object}
 */
function createSvg(width, height) {
  return d3.create("svg")
    .attr("viewBox", [-width / 2, -height / 2, width, height])
    .attr("role", "img")
    .attr("aria-label", "Document logic radial graph");
}

/**
 * Builds cartesian positions from a clustered radial hierarchy.
 *
 * @param {object} root
 * @returns {Map<string, {x: number, y: number}>}
 */
function buildPositions(root) {
  const descendants = root.descendants().filter((node) => node.data.id);
  return new Map(descendants.map((node) => [
    node.data.id,
    {
      x: Math.cos(node.x - Math.PI / 2) * node.y,
      y: Math.sin(node.x - Math.PI / 2) * node.y
    }
  ]));
}

/**
 * Renders graph links.
 *
 * @param {object} svg
 * @param {object} graphModel
 * @param {Map<string, {x: number, y: number}>} positions
 * @returns {void}
 */
function renderLinkLayer(svg, graphModel, positions) {
  svg.append("g")
    .attr("fill", "none")
    .selectAll("line.graph-link")
    .data(graphModel.links.filter((link) => positions.has(link.source) && positions.has(link.target)))
    .join("line")
    .attr("class", "graph-link")
    .attr("x1", (link) => positions.get(link.source).x)
    .attr("y1", (link) => positions.get(link.source).y)
    .attr("x2", (link) => positions.get(link.target).x)
    .attr("y2", (link) => positions.get(link.target).y)
    .attr("stroke", getLinkStroke)
    .attr("stroke-dasharray", (link) => link.kind === EDGE_KINDS.CONTRADICTION ? "6 4" : null)
    .attr("stroke-width", (link) => Math.max(0.8, link.weight * (link.kind === EDGE_KINDS.CONTRADICTION ? 5 : 3.6)));
}

/**
 * Renders graph nodes and returns the D3 selection.
 *
 * @param {object} svg
 * @param {object} graphModel
 * @param {Map<string, {x: number, y: number}>} positions
 * @param {(nodeId: string) => void} onNodeSelect
 * @returns {object}
 */
function renderNodeLayer(svg, graphModel, positions, onNodeSelect) {
  return svg.append("g")
    .selectAll("circle.graph-node")
    .data(graphModel.nodes.filter((node) => positions.has(node.id)))
    .join("circle")
    .attr("class", "graph-node")
    .attr("cx", (node) => positions.get(node.id).x)
    .attr("cy", (node) => positions.get(node.id).y)
    .attr("r", (node) => getRadiusByType(node.type))
    .attr("fill", (node) => getColorByType(node.type))
    .attr("stroke", "#fff9ef")
    .attr("stroke-width", 1.3)
    .style("cursor", "pointer")
    .on("click", (_, node) => onNodeSelect(node.id))
    .on("mouseenter", function onEnter(_, node) {
      d3.select(this).transition().duration(120).attr("r", getRadiusByType(node.type) + 2);
    })
    .on("mouseleave", function onLeave(_, node) {
      d3.select(this).transition().duration(120).attr("r", getRadiusByType(node.type));
    });
}

/**
 * Renders graph labels for non-root nodes.
 *
 * @param {object} svg
 * @param {object} graphModel
 * @param {Map<string, {x: number, y: number}>} positions
 * @returns {void}
 */
function renderLabelLayer(svg, graphModel, positions) {
  svg.append("g")
    .selectAll("text.graph-label")
    .data(graphModel.nodes.filter((node) => positions.has(node.id) && node.type !== NODE_TYPES.DOCUMENT))
    .join("text")
    .attr("class", "graph-label")
    .attr("x", (node) => positions.get(node.id).x)
    .attr("y", (node) => positions.get(node.id).y)
    .attr("dx", (node) => positions.get(node.id).x >= 0 ? 8 : -8)
    .attr("dy", "0.31em")
    .attr("text-anchor", (node) => positions.get(node.id).x >= 0 ? "start" : "end")
    .style("font-size", (node) => node.type === NODE_TYPES.SENTENCE ? "11px" : "10px")
    .style("fill", "#594730")
    .style("pointer-events", "none")
    .text((node) => node.label);
}

/**
 * Highlights and selects the default node.
 *
 * @param {object} nodeSelection
 * @param {object} graphModel
 * @param {(nodeId: string) => void} onNodeSelect
 * @returns {void}
 */
function selectDefaultNode(nodeSelection, graphModel, onNodeSelect) {
  const defaultNode = graphModel.nodes.find((node) => node.type === NODE_TYPES.SENTENCE) || graphModel.nodes[0];
  if (!defaultNode) {
    return;
  }
  onNodeSelect(defaultNode.id);
  nodeSelection.filter((node) => node.id === defaultNode.id).attr("stroke", "#1f1b16").attr("stroke-width", 2.4);
}

/**
 * Renders the radial graph.
 *
 * @param {HTMLElement} container
 * @param {object} graphModel
 * @param {(nodeId: string) => void} onNodeSelect
 * @returns {void}
 */
export function renderRadialGraph(container, graphModel, onNodeSelect) {
  container.replaceChildren();
  if (!graphModel || graphModel.nodes.length === 0) {
    renderEmptyState(container);
    return;
  }
  appendGraphNote(container);
  const width = container.clientWidth || 900;
  const height = container.clientHeight || 680;
  const root = buildHierarchy(graphModel);
  d3.cluster().size([2 * Math.PI, Math.min(width, height) / 2 - 58])(root);
  const svg = createSvg(width, height);
  const positions = buildPositions(root);
  renderLinkLayer(svg, graphModel, positions);
  const nodeSelection = renderNodeLayer(svg, graphModel, positions, onNodeSelect);
  renderLabelLayer(svg, graphModel, positions);
  container.appendChild(svg.node());
  selectDefaultNode(nodeSelection, graphModel, onNodeSelect);
}
