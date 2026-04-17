const CONFIG_KEY = 'serverConfig';
const DEFAULT_URL = 'http://localhost:44380';

export async function getConfig() {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  return result[CONFIG_KEY] || { serverUrl: DEFAULT_URL, apiToken: '', database: '' };
}

export async function setConfig(config) {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}

export function authHeaders(apiToken, database) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;
  if (database) headers['X-Atomic-Database'] = database;
  return headers;
}
