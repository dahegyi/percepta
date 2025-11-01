/**
 * Article Extractor Utility
 * Extracts article content from web pages using various heuristics
 * This file is injected as a content script
 */

/**
 * Extract article content from the page
 * Uses multiple strategies to find and extract article text
 */
function extractArticleContent() {
  // Strategy 1: Look for common article selectors
  const articleSelectors = [
    "article",
    '[role="article"]',
    '[itemtype*="Article"]',
    ".article-content",
    ".post-content",
    ".entry-content",
    ".content",
    "main article",
    "main",
  ];

  let articleElement = null;
  for (const selector of articleSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      articleElement = element;
      break;
    }
  }

  // Strategy 2: If no article found, look for largest text block
  if (!articleElement) {
    const candidates = document.querySelectorAll("div, section");
    let maxTextLength = 0;
    let bestCandidate = null;

    candidates.forEach((element) => {
      // Skip elements that are likely not articles
      if (
        element.matches(
          "header, footer, nav, aside, .sidebar, .menu, .navigation, .comments",
        )
      ) {
        return;
      }

      const textLength = element.innerText?.length || 0;
      if (textLength > maxTextLength && textLength > 500) {
        maxTextLength = textLength;
        bestCandidate = element;
      }
    });

    articleElement = bestCandidate;
  }

  if (!articleElement) {
    return null;
  }

  // Extract structured article data
  const article = {
    title: extractArticleTitle(),
    author: extractAuthor(),
    publishDate: extractPublishDate(),
    content: extractCleanText(articleElement),
    summary: extractSummary(),
  };

  return article;
}

/**
 * Extract article title
 */
function extractArticleTitle() {
  // Try various title selectors
  const titleSelectors = [
    "h1",
    "article h1",
    '[itemprop="headline"]',
    ".article-title",
    ".post-title",
    ".entry-title",
  ];

  for (const selector of titleSelectors) {
    const element = document.querySelector(selector);
    if (element?.innerText?.trim()) {
      return element.innerText.trim();
    }
  }

  // Fallback to document title
  return document.title;
}

/**
 * Extract author information
 */
function extractAuthor() {
  const authorSelectors = [
    '[rel="author"]',
    '[itemprop="author"]',
    ".author",
    ".byline",
    '[class*="author"]',
  ];

  for (const selector of authorSelectors) {
    const element = document.querySelector(selector);
    if (element?.innerText?.trim()) {
      return element.innerText.trim();
    }
  }

  // Try meta tags
  const authorMeta =
    document.querySelector('meta[name="author"]')?.content ||
    document.querySelector('meta[property="article:author"]')?.content;

  return authorMeta || null;
}

/**
 * Extract publish date
 */
function extractPublishDate() {
  const dateSelectors = [
    "time",
    '[itemprop="datePublished"]',
    ".publish-date",
    ".post-date",
    '[class*="date"]',
  ];

  for (const selector of dateSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      const datetime = element.getAttribute("datetime") || element.innerText;
      if (datetime?.trim()) {
        return datetime.trim();
      }
    }
  }

  // Try meta tags
  const dateMeta =
    document.querySelector('meta[property="article:published_time"]')
      ?.content || document.querySelector('meta[name="publish_date"]')?.content;

  return dateMeta || null;
}

/**
 * Extract summary/description
 */
function extractSummary() {
  const summarySelectors = [
    '[itemprop="description"]',
    ".article-summary",
    ".post-excerpt",
    ".excerpt",
  ];

  for (const selector of summarySelectors) {
    const element = document.querySelector(selector);
    if (element?.innerText?.trim()) {
      return element.innerText.trim();
    }
  }

  // Try meta tags
  const summaryMeta =
    document.querySelector('meta[property="og:description"]')?.content ||
    document.querySelector('meta[name="description"]')?.content;

  return summaryMeta || null;
}

/**
 * Extract clean text from an element
 * Removes scripts, styles, and other non-content elements
 */
function extractCleanText(element) {
  // Clone the element to avoid modifying the original
  const clone = element.cloneNode(true);

  // Remove unwanted elements
  const unwantedSelectors = [
    "script",
    "style",
    "noscript",
    "iframe",
    "nav",
    "aside",
    "footer",
    "header",
    ".advertisement",
    ".ad",
    ".social-share",
    ".comments",
    ".related-posts",
    '[class*="sidebar"]',
    '[class*="menu"]',
    '[class*="navigation"]',
  ];

  unwantedSelectors.forEach((selector) => {
    clone.querySelectorAll(selector).forEach((el) => el.remove());
  });

  // Get text content
  let text = clone.innerText || clone.textContent || "";

  // Clean up whitespace
  text = text
    .replace(/\n\s*\n\s*\n/g, "\n\n") // Remove excessive line breaks
    .replace(/[ \t]+/g, " ") // Normalize spaces
    .trim();

  return text;
}

/**
 * Check if the current page is likely an article
 */
function isArticlePage() {
  // Check for article indicators
  const hasArticleElement = !!document.querySelector("article");
  const hasArticleRole = !!document.querySelector('[role="article"]');
  const hasArticleSchema = !!document.querySelector('[itemtype*="Article"]');

  // Check URL patterns
  const url = location.pathname.toLowerCase();
  const articleUrlPatterns = [
    /\/article\//,
    /\/post\//,
    /\/blog\//,
    /\/news\//,
    /\/story\//,
    /\/\d{4}\/\d{2}\//,
  ];
  const hasArticleUrl = articleUrlPatterns.some((pattern) => pattern.test(url));

  // Check for article metadata
  const hasArticleMeta =
    !!document.querySelector('meta[property="article:published_time"]') ||
    !!document.querySelector('meta[property="og:type"][content="article"]');

  // Check for significant text content
  const bodyText = document.body.innerText || "";
  const hasSignificantContent = bodyText.length > 1000;

  // Return true if multiple indicators are present
  const indicators = [
    hasArticleElement,
    hasArticleRole,
    hasArticleSchema,
    hasArticleUrl,
    hasArticleMeta,
    hasSignificantContent,
  ].filter(Boolean).length;

  return indicators >= 2;
}

/**
 * Format article data for AI context
 */
function formatArticleForContext(article) {
  if (!article) return "";

  let context = "";

  if (article.title) {
    context += `ARTICLE TITLE: ${article.title}\n\n`;
  }

  if (article.author) {
    context += `AUTHOR: ${article.author}\n`;
  }

  if (article.publishDate) {
    context += `PUBLISHED: ${article.publishDate}\n`;
  }

  if (article.author || article.publishDate) {
    context += "\n";
  }

  if (article.summary) {
    context += `SUMMARY: ${article.summary}\n\n`;
  }

  if (article.content) {
    context += `ARTICLE CONTENT:\n${article.content}`;
  }

  return context;
}
