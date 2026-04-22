import { COPY } from "../config.js";

/**
 * Removes all child nodes from a container.
 *
 * @param {HTMLElement} container
 * @returns {void}
 */
function clearContainer(container) {
  container.replaceChildren();
}

/**
 * Appends a text-only list section to a container.
 *
 * @param {HTMLElement} container
 * @param {string} title
 * @param {string[] | undefined} items
 * @param {string} [className]
 * @returns {void}
 */
function appendListSection(container, title, items, className = "") {
  if (!items?.length) {
    return;
  }
  const section = document.createElement("section");
  const heading = document.createElement("h4");
  const list = document.createElement("ul");
  section.className = className;
  heading.textContent = title;
  items.forEach((item) => {
    const listItem = document.createElement("li");
    if (typeof item === "string") {
      listItem.textContent = item;
    } else {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `context-action ${item.tone === "danger" ? "danger" : ""}`;
      button.textContent = item.label;
      if (item.nodeId) {
        button.dataset.nodeId = item.nodeId;
      }
      if (item.secondaryNodeId) {
        button.dataset.secondaryNodeId = item.secondaryNodeId;
      }
      listItem.appendChild(button);
    }
    list.appendChild(listItem);
  });
  section.append(heading, list);
  container.appendChild(section);
}

/**
 * Appends a tag row with text-only tag nodes.
 *
 * @param {HTMLElement} container
 * @param {string[] | undefined} tags
 * @returns {void}
 */
function appendTagRow(container, tags) {
  if (!tags?.length) {
    return;
  }
  const row = document.createElement("div");
  row.className = "tag-row";
  tags.forEach((tag) => {
    const chip = document.createElement("span");
    chip.className = "tag";
    chip.textContent = tag;
    row.appendChild(chip);
  });
  container.appendChild(row);
}

/**
 * Renders the selected node context without exposing the DOM to injected HTML.
 *
 * @param {HTMLElement} container
 * @param {object | null} context
 * @returns {void}
 */
export function renderContextPanel(container, context) {
  clearContainer(container);
  if (!context) {
    container.textContent = COPY.defaultContext;
    return;
  }
  const title = document.createElement("h3");
  const subtitle = document.createElement("p");
  const body = document.createElement("p");
  title.textContent = context.title;
  subtitle.className = "context-subtitle";
  subtitle.textContent = context.subtitle;
  body.textContent = context.body;
  container.append(title, subtitle, body);
  appendTagRow(container, context.tags);
  appendListSection(container, "Connectivity", context.connectivity);
  appendListSection(container, "Contradictions", context.contradictions, "context-issues");
}

/**
 * Renders connectivity issues in a text-safe way.
 *
 * @param {HTMLElement} container
 * @param {object} analysis
 * @returns {void}
 */
export function renderIssuePanel(container, analysis) {
  const isolated = analysis.connectivity.isolatedSentences.map((label) => ({
    nodeId: `sentence:${Number(label.replace("S", "")) - 1}`,
    label: `${label} has no strong sentence link.`,
    tone: "neutral"
  }));
  const bridges = analysis.connectivity.bridgeSentences.map((item) => ({
    nodeId: item.nodeId,
    label: `${item.label} connects to ${item.linkCount} strong sentence links.`,
    tone: "neutral"
  }));
  const contradictions = analysis.contradictionLinks
    .slice(0, 8)
    .map((link) => ({
      nodeId: link.source,
      secondaryNodeId: link.target,
      label: `${link.source.replace("sentence:", "S")} vs ${link.target.replace("sentence:", "S")} (${link.reasons.join(", ")})`,
      tone: "danger"
    }));
  clearContainer(container);
  appendListSection(container, "Potential contradictions", contradictions, "context-issues");
  appendListSection(container, "Bridge sentences", bridges);
  appendListSection(container, "Isolated sentences", isolated);
}
