import type { Message } from "discord.js";
import type { PipelineResult } from "../types/index.js";

/** Confirm a successful capture by reacting with ✅ on the original message.
 *  Falls back to a brief reply (auto-deleted) if the bot lacks ADD_REACTIONS. */
export async function confirmCapture(
  message: Message,
  result: PipelineResult,
): Promise<void> {
  if (result.action === "skipped") return;

  try {
    await message.react("✅");
  } catch {
    // Fallback: send a brief reply and delete it after 10 seconds
    try {
      const reply = await message.reply({
        content: result.action === "created"
          ? "📝 Captured to Atomic!"
          : "📝 Updated in Atomic!",
      });
      setTimeout(() => {
        reply.delete().catch(() => {});
      }, 10_000);
    } catch {
      // Can't react or reply — silently ignore
    }
  }
}
