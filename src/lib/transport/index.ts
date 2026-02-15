import type { Transport, HttpTransportConfig } from './types';
import { HttpTransport } from './http';
export type { Transport, HttpTransportConfig };

let activeTransport: Transport | null = null;
let localServerConfig: HttpTransportConfig | null = null;

export function getTransport(): Transport {
  if (!activeTransport) throw new Error('Transport not initialized. Call initTransport() first.');
  return activeTransport;
}

export async function initTransport(): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
    // Desktop app: get sidecar config via single Tauri IPC command
    const { invoke } = await import('@tauri-apps/api/core');
    localServerConfig = await invoke<HttpTransportConfig>('get_local_server_config');

    // Check if user has saved a remote server config
    const saved = localStorage.getItem('atomic-server-config');
    const config = saved ? JSON.parse(saved) as HttpTransportConfig : localServerConfig;

    activeTransport = new HttpTransport(config);
    await activeTransport.connect();
  } else {
    // Web SPA — require explicit config from localStorage or prompt user
    const saved = localStorage.getItem('atomic-server-config');
    if (saved) {
      const config: HttpTransportConfig = JSON.parse(saved);
      activeTransport = new HttpTransport(config);
      await activeTransport.connect();
    } else {
      // Create a disconnected HttpTransport — user must configure via settings
      activeTransport = new HttpTransport({ baseUrl: '', authToken: '' });
    }
  }
}

/// Switch to a remote server (saves config to localStorage)
export async function switchTransport(config: HttpTransportConfig): Promise<void> {
  if (activeTransport) activeTransport.disconnect();
  activeTransport = new HttpTransport(config);
  await activeTransport.connect();
  localStorage.setItem('atomic-server-config', JSON.stringify(config));
}

/// Switch back to the local sidecar server (desktop only)
export async function switchToLocal(): Promise<void> {
  if (!localServerConfig) {
    throw new Error('No local server config available — not running in desktop app');
  }
  if (activeTransport) activeTransport.disconnect();
  activeTransport = new HttpTransport(localServerConfig);
  await activeTransport.connect();
  localStorage.removeItem('atomic-server-config');
}

/// True when running inside the Tauri desktop app (sidecar available)
export function isDesktopApp(): boolean {
  return localServerConfig !== null;
}

/// True when connected to the embedded local sidecar (not a remote server)
export function isLocalServer(): boolean {
  if (!localServerConfig || !activeTransport) return false;
  const currentConfig = (activeTransport as HttpTransport).getConfig();
  return currentConfig.baseUrl === localServerConfig.baseUrl;
}

/// Get the local server config (for MCP setup display, etc.)
export function getLocalServerConfig(): HttpTransportConfig | null {
  return localServerConfig;
}
