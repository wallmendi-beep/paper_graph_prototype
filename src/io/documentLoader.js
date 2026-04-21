/**
 * Extracts a Google Docs document id from a share URL.
 *
 * @param {string} url
 * @returns {string | null}
 */
function extractGoogleDocId(url) {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

/**
 * Decodes binary document text using UTF-8 with a latin1 fallback.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function decodeBinaryText(bytes) {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const cleanedUtf8 = utf8.replace(/\u0000/g, " ").trim();
  if (cleanedUtf8.length > 40) {
    return cleanedUtf8;
  }
  return new TextDecoder("latin1").decode(bytes).replace(/\u0000/g, " ").trim();
}

/**
 * Normalizes extracted text blocks.
 *
 * @param {string} text
 * @returns {string}
 */
function cleanExtractedText(text) {
  return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

/**
 * Extracts text from a PDF file.
 *
 * @param {File} file
 * @returns {Promise<string>}
 */
async function extractFromPdf(file) {
  if (!window.pdfjsLib) {
    throw new Error("PDF parser is not available.");
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await window.pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return cleanExtractedText(pages.join("\n\n"));
}

/**
 * Extracts text from a DOCX file.
 *
 * @param {File} file
 * @returns {Promise<string>}
 */
async function extractFromDocx(file) {
  if (!window.mammoth?.extractRawText) {
    throw new Error("Word parser is not available.");
  }
  const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return cleanExtractedText(result.value || "");
}

/**
 * Best-effort extraction for legacy DOC files.
 *
 * @param {File} file
 * @returns {Promise<string>}
 */
async function extractFromLegacyWord(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const candidate = decodeBinaryText(data).replace(/[^\p{L}\p{N}\p{P}\p{Zs}\n]/gu, " ").replace(/\s{2,}/g, " ").trim();
  if (candidate.length < 40) {
    throw new Error("Legacy .doc parsing produced too little text. Please convert the file to .docx.");
  }
  return cleanExtractedText(candidate);
}

/**
 * Extracts text from a supported local document.
 *
 * @param {File} file
 * @returns {Promise<{text: string, sourceLabel: string}>}
 */
export async function extractTextFromFile(file) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".pdf")) {
    return { text: await extractFromPdf(file), sourceLabel: `PDF - ${file.name}` };
  }
  if (lowerName.endsWith(".docx")) {
    return { text: await extractFromDocx(file), sourceLabel: `Word - ${file.name}` };
  }
  if (lowerName.endsWith(".doc")) {
    return { text: await extractFromLegacyWord(file), sourceLabel: `Word (.doc) - ${file.name}` };
  }
  if (lowerName.endsWith(".txt") || lowerName.endsWith(".md")) {
    return { text: cleanExtractedText(await file.text()), sourceLabel: `Text - ${file.name}` };
  }
  throw new Error("Unsupported file type. Use .pdf, .docx, .doc, .txt, or .md.");
}

/**
 * Loads plain text from a public Google Docs URL.
 *
 * @param {string} url
 * @returns {Promise<{text: string, sourceLabel: string}>}
 */
export async function loadGoogleDocText(url) {
  const docId = extractGoogleDocId(url);
  if (!docId) {
    throw new Error("Invalid Google Docs URL.");
  }
  const response = await fetch(`https://docs.google.com/document/d/${docId}/export?format=txt`);
  if (!response.ok) {
    throw new Error("Failed to fetch Google Docs text. Ensure the document is accessible.");
  }
  const text = cleanExtractedText(await response.text());
  if (!text) {
    throw new Error("Google Docs export returned no text.");
  }
  return { text, sourceLabel: `Google Docs - ${docId}` };
}
