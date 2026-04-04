import type { NormalizedMessage } from "../types/index.js";

function formatTimestamp(date: Date): string {
  return date.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function formatTime(date: Date): string {
  return date.toISOString().replace(/.*T/, "").replace(/\.\d+Z$/, "");
}

function formatAttachments(
  attachments: NormalizedMessage["attachments"],
): string {
  if (attachments.length === 0) return "";
  const lines = attachments.map(
    (a) => `- [${a.filename}](${a.url}) (${a.content_type})`,
  );
  return `\n\n**Attachments:**\n${lines.join("\n")}`;
}

function formatEmbeds(embeds: NormalizedMessage["embeds"]): string {
  if (!embeds || embeds.length === 0) return "";
  const lines = embeds
    .filter((e) => e.title || e.description)
    .map((e) => {
      const parts: string[] = [];
      if (e.title) parts.push(e.url ? `[${e.title}](${e.url})` : e.title);
      if (e.description) parts.push(e.description);
      return `> ${parts.join("\n> ")}`;
    });
  if (lines.length === 0) return "";
  return `\n\n${lines.join("\n\n")}`;
}

/** Generate a title from message content (first line, truncated) */
export function generateTitle(content: string, maxLen = 80): string {
  const firstLine = content.split("\n")[0].replace(/^#+\s*/, "").trim();
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen - 3) + "...";
}

/** Format a single standalone message as an atom body */
export function formatSingleMessage(msg: NormalizedMessage): string {
  let body = `**From:** @${msg.author.display_name}  \n`;
  body += `**Server:** ${msg.guild_name}  \n`;
  body += `**Channel:** #${msg.channel_name}  \n`;
  body += `**Date:** ${formatTimestamp(msg.timestamp)}  \n`;
  body += `**Discord link:** ${msg.permalink}`;
  body += `\n\n---\n\n`;
  body += msg.content;
  body += formatAttachments(msg.attachments);
  body += formatEmbeds(msg.embeds);

  return body;
}

/** Format a thread (with replies) as an atom body */
export function formatThread(msg: NormalizedMessage): string {
  const replies = msg.replies ?? [];

  let body = `**Thread in #${msg.channel_name}**  \n`;
  body += `**Started by:** @${msg.author.display_name}  \n`;
  body += `**Date:** ${formatTimestamp(msg.timestamp)}  \n`;
  body += `**Replies:** ${replies.length}  \n`;
  body += `**Discord link:** ${msg.permalink}`;
  body += `\n\n---\n\n`;

  // Original message
  body += `**@${msg.author.display_name}** (${formatTime(msg.timestamp)}): ${msg.content}`;
  body += formatAttachments(msg.attachments);
  body += formatEmbeds(msg.embeds);

  // Replies
  for (const reply of replies) {
    body += `\n\n**@${reply.author.display_name}** (${formatTime(reply.timestamp)}): ${reply.content}`;
    body += formatAttachments(reply.attachments);
    body += formatEmbeds(reply.embeds);
  }

  return body;
}

/** Format a forum post as an atom body */
export function formatForumPost(msg: NormalizedMessage): string {
  const replies = msg.replies ?? [];
  const tags = msg.tags ?? [];
  const solved = tags.some(
    (t) => t.toLowerCase() === "solved" || t.toLowerCase() === "resolved",
  );

  let body = `**Forum Post: ${msg.thread_name ?? generateTitle(msg.content)}**  \n`;
  body += `**Author:** @${msg.author.display_name}  \n`;
  body += `**Server:** ${msg.guild_name}  \n`;
  body += `**Forum:** #${msg.channel_name}  \n`;
  if (tags.length > 0) {
    body += `**Tags:** ${tags.join(", ")}  \n`;
  }
  if (solved) {
    body += `**Status:** Solved ✅  \n`;
  }
  body += `**Date:** ${formatTimestamp(msg.timestamp)}  \n`;
  body += `**Discord link:** ${msg.permalink}`;
  body += `\n\n---\n\n`;

  // Original post
  body += `## Original Post\n\n`;
  body += msg.content;
  body += formatAttachments(msg.attachments);
  body += formatEmbeds(msg.embeds);

  // Discussion
  if (replies.length > 0) {
    body += `\n\n## Discussion (${replies.length} ${replies.length === 1 ? "reply" : "replies"})\n\n`;
    for (const reply of replies) {
      body += `**@${reply.author.display_name}** (${formatTime(reply.timestamp)}): ${reply.content}`;
      body += formatAttachments(reply.attachments);
      body += formatEmbeds(reply.embeds);
      body += "\n\n";
    }
  }

  body += `---\n*Captured from Discord forum post.*`;

  return body;
}

/** Pick the right template based on message shape */
export function formatAtomBody(msg: NormalizedMessage): string {
  if (msg.channel_type === "forum") {
    return formatForumPost(msg);
  }
  if (msg.replies && msg.replies.length > 0) {
    return formatThread(msg);
  }
  return formatSingleMessage(msg);
}
