export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export async function pickDirectory(
  title?: string,
  options?: { defaultPath?: string },
): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    return (await open({
      directory: true,
      multiple: false,
      title,
      defaultPath: options?.defaultPath,
    })) as string | null;
  }
  return null; // Not available in web/remote mode
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
}

/**
 * Rough client-side macOS detection. We don't load `@tauri-apps/plugin-os`
 * because the UI call sites can tolerate a false negative (the button just
 * won't render) and we'd rather not pull in another plugin for a single check.
 */
export function isMacOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform;
  if (platform) return /mac/i.test(platform);
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
