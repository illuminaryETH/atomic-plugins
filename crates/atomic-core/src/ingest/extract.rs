//! Article detection and extraction via dom_smoothie (Readability.js port).
//!
//! Two-step process:
//! 1. Gate: `is_probably_readable()` — fast structural check
//! 2. Extract: `Readability::parse()` with markdown output

use dom_smoothie::{Config, Readability, TextMode};

/// Minimum extracted article length (characters) to be considered valid.
const MIN_ARTICLE_LENGTH: usize = 200;

/// Result of a successful article extraction.
pub struct ExtractedArticle {
    pub title: String,
    pub content: String,
    pub byline: Option<String>,
    pub excerpt: Option<String>,
    pub site_name: Option<String>,
}

/// Extract article content as markdown from HTML.
/// Returns `Err` if the page isn't article-shaped or content is too short.
pub fn extract_article(html: &str, url: &str) -> Result<ExtractedArticle, String> {
    let config = Config {
        text_mode: TextMode::Markdown,
        ..Default::default()
    };

    let mut readability = Readability::new(html, Some(url), Some(config))
        .map_err(|e| format!("Failed to parse HTML: {}", e))?;

    // Fast structural check — is this page article-shaped?
    if !readability.is_probably_readable() {
        return Err("Page is not article-shaped (failed readability check)".to_string());
    }

    let article = readability
        .parse()
        .map_err(|e| format!("Readability extraction failed: {}", e))?;

    let content: String = article.text_content.to_string();
    if content.len() < MIN_ARTICLE_LENGTH {
        return Err(format!(
            "Extracted content too short ({} chars, minimum {})",
            content.len(),
            MIN_ARTICLE_LENGTH
        ));
    }

    let title = article.title.clone();
    let markdown = if title.is_empty() {
        content
    } else {
        format!("# {}\n\n{}", title, content)
    };

    Ok(ExtractedArticle {
        title,
        content: markdown,
        byline: article.byline,
        excerpt: article.excerpt,
        site_name: article.site_name,
    })
}
