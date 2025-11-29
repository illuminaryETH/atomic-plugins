// Listen for extraction requests from service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extract') {
    extractContent(request.mode)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true; // Async response
  }
});

// Extract content based on mode
async function extractContent(mode) {
  if (mode === 'selection') {
    return extractSelection();
  } else {
    return extractPage();
  }
}

// Extract selected text
function extractSelection() {
  const selection = window.getSelection().toString();

  if (!selection || selection.length < 10) {
    throw new Error('No text selected');
  }

  return {
    content: selection,
    title: document.title,
    url: window.location.href
  };
}

// Extract full page using Readability
function extractPage() {
  // Clone document for Readability
  const documentClone = document.cloneNode(true);
  const reader = new Readability(documentClone);
  const article = reader.parse();

  if (!article) {
    // Fallback to selection or visible text
    const selection = window.getSelection().toString();
    if (selection && selection.length > 50) {
      return extractSelection();
    }

    // Last resort: body text
    return {
      content: document.body.innerText,
      title: document.title,
      url: window.location.href
    };
  }

  // Convert HTML to Markdown
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined'
  });

  const markdown = turndownService.turndown(article.content);

  // Add title as H1 (article title or page title)
  const title = article.title || document.title;
  const titleHeader = `# ${title}\n\n`;

  return {
    content: titleHeader + markdown,
    title: title,
    url: window.location.href,
    excerpt: article.excerpt
  };
}
