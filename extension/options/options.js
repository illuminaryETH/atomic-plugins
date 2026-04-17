import { getConfig, authHeaders } from '../lib/config.js';

const CONFIG_KEY = 'serverConfig';

const urlInput = document.getElementById('server-url');
const tokenInput = document.getElementById('api-token');
const databaseSelect = document.getElementById('database');
const refreshDbsBtn = document.getElementById('refresh-dbs');
const dbHint = document.getElementById('db-hint');
const saveBtn = document.getElementById('save');
const testBtn = document.getElementById('test');
const messageEl = document.getElementById('message');

let lastLoadedDatabases = [];

// Load saved config
async function loadConfig() {
  const config = await getConfig();
  urlInput.value = config.serverUrl;
  tokenInput.value = config.apiToken;

  // Seed the select with the saved value so it persists even before refresh
  if (config.database) {
    const opt = document.createElement('option');
    opt.value = config.database;
    opt.textContent = `${config.database} (saved)`;
    opt.selected = true;
    databaseSelect.appendChild(opt);
  }

  // Attempt to load databases list on open
  refreshDatabases({ silent: true });
}

// Populate the select with databases fetched from the server
function renderDatabases(databases, selectedId) {
  lastLoadedDatabases = databases;
  databaseSelect.innerHTML = '';

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '(server default)';
  databaseSelect.appendChild(defaultOpt);

  for (const db of databases) {
    const opt = document.createElement('option');
    opt.value = db.id;
    opt.textContent = `${db.name} — ${db.id}${db.is_default ? ' [default]' : ''}`;
    if (db.id === selectedId) opt.selected = true;
    databaseSelect.appendChild(opt);
  }

  // If the saved id isn't in the list, preserve it as an extra option
  if (selectedId && !databases.some((d) => d.id === selectedId)) {
    const opt = document.createElement('option');
    opt.value = selectedId;
    opt.textContent = `${selectedId} (not found on server)`;
    opt.selected = true;
    databaseSelect.appendChild(opt);
  }
}

async function refreshDatabases({ silent = false } = {}) {
  const serverUrl = urlInput.value.trim().replace(/\/+$/, '');
  const apiToken = tokenInput.value.trim();

  if (!serverUrl) {
    if (!silent) showMessage('Server URL is required', 'error');
    return;
  }

  refreshDbsBtn.disabled = true;
  const prev = refreshDbsBtn.textContent;
  refreshDbsBtn.textContent = '…';

  try {
    const res = await fetch(`${serverUrl}/api/databases`, {
      headers: authHeaders(apiToken)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const databases = data.databases || [];
    const config = await getConfig();
    renderDatabases(databases, config.database || '');
    dbHint.textContent = `Loaded ${databases.length} database(s).`;
  } catch (err) {
    if (!silent) showMessage(`Could not load databases: ${err.message}`, 'error');
    dbHint.textContent = `Could not reach server (${err.message}). Save to persist current selection anyway.`;
  } finally {
    refreshDbsBtn.disabled = false;
    refreshDbsBtn.textContent = prev;
  }
}

// Show status message
function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
  messageEl.style.display = 'block';
  setTimeout(() => { messageEl.style.display = 'none'; }, 3000);
}

// Save config
saveBtn.addEventListener('click', async () => {
  const serverUrl = urlInput.value.trim().replace(/\/+$/, '');
  const apiToken = tokenInput.value.trim();
  const database = databaseSelect.value.trim();

  if (!serverUrl) {
    showMessage('Server URL is required', 'error');
    return;
  }

  await chrome.storage.local.set({
    [CONFIG_KEY]: { serverUrl, apiToken, database }
  });

  showMessage('Settings saved', 'success');
});

// Test connection
testBtn.addEventListener('click', async () => {
  const serverUrl = urlInput.value.trim().replace(/\/+$/, '');
  const apiToken = tokenInput.value.trim();
  const database = databaseSelect.value.trim();

  if (!serverUrl) {
    showMessage('Server URL is required', 'error');
    return;
  }

  testBtn.disabled = true;
  testBtn.textContent = 'Testing...';

  try {
    // Hit an authenticated endpoint to verify connectivity, token, and DB routing
    const response = await fetch(`${serverUrl}/api/atoms?limit=1`, {
      headers: authHeaders(apiToken, database)
    });

    if (response.ok) {
      const dbLabel = database || '(server default)';
      showMessage(`Connection successful — using database: ${dbLabel}`, 'success');
    } else if (response.status === 401) {
      showMessage('Connected but token is invalid — check your API token', 'error');
    } else if (response.status === 400) {
      showMessage('Connected but database not found — pick one from the list', 'error');
    } else {
      showMessage(`Connection failed: HTTP ${response.status}`, 'error');
    }
  } catch (error) {
    showMessage(`Connection failed: ${error.message}`, 'error');
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test Connection';
  }
});

refreshDbsBtn.addEventListener('click', () => refreshDatabases());

loadConfig();
