/**
 * Context Chunker
 * Utilities to chunk text content to stay within API limits
 */

// Maximum context size in bytes (~10KB for reliable results with images)
// Chrome Prompt API has limits on total input size, especially with images
const MAX_CONTEXT_SIZE = 10 * 1024; // 10 KB

// Footer message that will be added at the end
const FOOTER_MESSAGE = `END OF CONTEXT — use only this data. Do not invent or guess links.`;

/**
 * Calculate the size of text in bytes (UTF-8)
 */
function getTextSizeInBytes(text) {
  return new Blob([text]).size;
}

/**
 * Chunk text content intelligently to stay under size limit
 * Prioritizes: Article Content > Title > Meta > Headings > Links > Snippet
 */
export function chunkContext(contextData) {
  const {
    title = "",
    meta = [],
    headings = [],
    links = [],
    snippet = "",
    url = "",
    articleContent = null,
    isArticle = false,
  } = contextData;

  // Start with essential information
  let context = `URL: ${url}\n\n`;

  // Always include title
  if (title) {
    context += `TITLE: ${title}\n\n`;
  }

  // Reserve space for the footer message
  const footerSize = getTextSizeInBytes(FOOTER_MESSAGE);

  // Track remaining space (accounting for footer)
  let remainingBytes =
    MAX_CONTEXT_SIZE - getTextSizeInBytes(context) - footerSize;

  // If this is an article page with extracted content, prioritize it
  if (isArticle && articleContent && remainingBytes > 0) {
    const articleSize = getTextSizeInBytes(articleContent);

    if (articleSize <= remainingBytes) {
      // Full article fits
      context += `${articleContent}\n\n`;
      remainingBytes -= articleSize;
    } else {
      // Truncate article to fit, but give it most of the space
      const truncatedArticle = truncateText(
        articleContent,
        remainingBytes - 100,
      );
      if (truncatedArticle) {
        context += `${truncatedArticle}...\n\n`;
        remainingBytes =
          MAX_CONTEXT_SIZE - getTextSizeInBytes(context) - footerSize;
      }
    }

    // For articles, skip meta/headings/links since article content is comprehensive
    context += FOOTER_MESSAGE;
    return context;
  }

  // For non-article pages, use the standard approach
  // Add meta tags (high priority)
  if (meta.length > 0 && remainingBytes > 0) {
    const metaSection = `META TAGS:\n${meta.join("\n")}\n\n`;
    const metaSize = getTextSizeInBytes(metaSection);

    if (metaSize <= remainingBytes) {
      context += metaSection;
      remainingBytes -= metaSize;
    } else {
      // Truncate meta tags to fit
      const truncatedMeta = truncateArray(meta, remainingBytes - 50); // Reserve space for header
      if (truncatedMeta.length > 0) {
        context += `META TAGS:\n${truncatedMeta.join("\n")}\n\n`;
        remainingBytes =
          MAX_CONTEXT_SIZE - getTextSizeInBytes(context) - footerSize;
      }
    }
  }

  // Add headings (medium-high priority)
  if (headings.length > 0 && remainingBytes > 0) {
    const headingsSection = `HEADINGS:\n${headings
      .map((h) => `- ${h}`)
      .join("\n")}\n\n`;
    const headingsSize = getTextSizeInBytes(headingsSection);

    if (headingsSize <= remainingBytes) {
      context += headingsSection;
      remainingBytes -= headingsSize;
    } else {
      // Truncate headings to fit
      const truncatedHeadings = truncateArray(
        headings.map((h) => `- ${h}`),
        remainingBytes - 50,
      );
      if (truncatedHeadings.length > 0) {
        context += `HEADINGS:\n${truncatedHeadings.join("\n")}\n\n`;
        remainingBytes =
          MAX_CONTEXT_SIZE - getTextSizeInBytes(context) - footerSize;
      }
    }
  }

  // Add links (medium priority)
  if (links.length > 0 && remainingBytes > 0) {
    const linksSection = `LINKS:\n${links.join("\n")}\n\n`;
    const linksSize = getTextSizeInBytes(linksSection);

    if (linksSize <= remainingBytes) {
      context += linksSection;
      remainingBytes -= linksSize;
    } else {
      // Truncate links to fit
      const truncatedLinks = truncateArray(links, remainingBytes - 50);
      if (truncatedLinks.length > 0) {
        context += `LINKS:\n${truncatedLinks.join("\n")}\n\n`;
        remainingBytes =
          MAX_CONTEXT_SIZE - getTextSizeInBytes(context) - footerSize;
      }
    }
  }

  // Add page snippet (lower priority, can be truncated aggressively)
  if (snippet && remainingBytes > 0) {
    const snippetSection = `PAGE TEXT (SNAPSHOT):\n${snippet}\n\n`;
    const snippetSize = getTextSizeInBytes(snippetSection);

    if (snippetSize <= remainingBytes) {
      context += snippetSection;
    } else {
      // Truncate snippet to fit
      const truncatedSnippet = truncateText(snippet, remainingBytes - 100); // Reserve space for header
      if (truncatedSnippet) {
        context += `PAGE TEXT (SNAPSHOT):\n${truncatedSnippet}...\n\n`;
      }
    }
  }

  context += FOOTER_MESSAGE;

  // Final size check
  const finalSize = getTextSizeInBytes(context);

  // Safety check - if somehow still over limit, log warning
  if (finalSize > MAX_CONTEXT_SIZE) {
    console.warn(
      `⚠️ Context exceeded max size by ${finalSize - MAX_CONTEXT_SIZE} bytes!`,
    );
  }

  return context;
}

/**
 * Truncate an array of strings to fit within byte limit
 */
function truncateArray(items, maxBytes) {
  const result = [];
  let currentSize = 0;

  for (const item of items) {
    const itemSize = getTextSizeInBytes(item + "\n");
    if (currentSize + itemSize > maxBytes) {
      break;
    }
    result.push(item);
    currentSize += itemSize;
  }

  return result;
}

/**
 * Truncate text to fit within byte limit
 * Tries to break at word boundaries
 */
function truncateText(text, maxBytes) {
  if (!text) return "";

  // Quick check if no truncation needed
  if (getTextSizeInBytes(text) <= maxBytes) {
    return text;
  }

  // Binary search for the right length
  let low = 0;
  let high = text.length;
  let result = "";

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const substring = text.substring(0, mid);
    const size = getTextSizeInBytes(substring);

    if (size <= maxBytes) {
      result = substring;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  // Try to break at last word boundary
  const lastSpace = result.lastIndexOf(" ");
  if (lastSpace > result.length * 0.8) {
    // Only break at word if we're not losing too much
    result = result.substring(0, lastSpace);
  }

  return result.trim();
}

/**
 * Get statistics about context size
 */
export function getContextStats(contextData) {
  const {
    title = "",
    meta = [],
    headings = [],
    links = [],
    snippet = "",
    url = "",
  } = contextData;

  return {
    url: getTextSizeInBytes(url),
    title: getTextSizeInBytes(title),
    meta: getTextSizeInBytes(meta.join("\n")),
    headings: getTextSizeInBytes(headings.join("\n")),
    links: getTextSizeInBytes(links.join("\n")),
    snippet: getTextSizeInBytes(snippet),
    total:
      getTextSizeInBytes(url) +
      getTextSizeInBytes(title) +
      getTextSizeInBytes(meta.join("\n")) +
      getTextSizeInBytes(headings.join("\n")) +
      getTextSizeInBytes(links.join("\n")) +
      getTextSizeInBytes(snippet),
  };
}
