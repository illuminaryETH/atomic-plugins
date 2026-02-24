//! RSS/Atom/JSON Feed parsing via feed-rs.

use feed_rs::parser;

/// A parsed feed with metadata and items.
pub struct ParsedFeed {
    pub title: Option<String>,
    pub site_url: Option<String>,
    pub items: Vec<ParsedFeedItem>,
}

/// A single item from a parsed feed.
pub struct ParsedFeedItem {
    /// Unique identifier — uses `id` field, falls back to link URL.
    pub guid: String,
    pub title: Option<String>,
    pub link: Option<String>,
    pub published_at: Option<String>,
}

/// Parse raw XML/JSON into a structured feed.
pub fn parse_feed(data: &[u8]) -> Result<ParsedFeed, String> {
    let feed = parser::parse(data).map_err(|e| format!("Feed parse error: {}", e))?;

    let title = feed.title.map(|t| t.content);
    let site_url = feed.links.first().map(|l| l.href.clone());

    let items = feed
        .entries
        .into_iter()
        .filter_map(|entry| {
            let link = entry.links.first().map(|l| l.href.clone());
            // GUID: prefer entry.id, fall back to link
            let guid = if entry.id.is_empty() {
                link.clone()?
            } else {
                entry.id
            };

            Some(ParsedFeedItem {
                guid,
                title: entry.title.map(|t| t.content),
                link,
                published_at: entry
                    .published
                    .or(entry.updated)
                    .map(|dt| dt.to_rfc3339()),
            })
        })
        .collect();

    Ok(ParsedFeed {
        title,
        site_url,
        items,
    })
}
