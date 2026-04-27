#!/usr/bin/env node

import { createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, renameSync, statSync, unlinkSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { once } from 'events';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const DEFAULT_REPO = 'xiaowu0162/longmemeval-cleaned';
const DEFAULT_REVISION = 'main';
const VARIANTS = {
  s: {
    file: 'longmemeval_s_cleaned.json',
    minBytes: 100 * 1024 * 1024,
  },
  m: {
    file: 'longmemeval_m_cleaned.json',
    minBytes: 1024 * 1024 * 1024,
  },
  oracle: {
    file: 'longmemeval_oracle.json',
    minBytes: 1024 * 1024,
  },
};

function printHelp() {
  console.log(`Download cleaned LongMemEval JSON files from Hugging Face.

Usage:
  node scripts/download-longmemeval.js [options]

Options:
  --variant <s|m|oracle>  Dataset file to download. Default: s
  --output <path>         Output path. Default: data/<variant filename>
  --repo <repo>           Hugging Face dataset repo. Default: ${DEFAULT_REPO}
  --revision <rev>        Hugging Face revision. Default: ${DEFAULT_REVISION}
  --force                 Replace an existing output file
  --no-validate           Skip lightweight schema validation after download
  --dry-run               Print the resolved URL and output path without downloading
  -h, --help              Show this help

Example:
  node scripts/download-longmemeval.js
`);
}

function parseArgs(argv) {
  const options = {
    variant: 's',
    output: null,
    repo: DEFAULT_REPO,
    revision: DEFAULT_REVISION,
    force: false,
    validate: true,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--variant':
        options.variant = readValue(argv, ++i, arg);
        break;
      case '--output':
        options.output = readValue(argv, ++i, arg);
        break;
      case '--repo':
        options.repo = readValue(argv, ++i, arg);
        break;
      case '--revision':
        options.revision = readValue(argv, ++i, arg);
        break;
      case '--force':
        options.force = true;
        break;
      case '--no-validate':
        options.validate = false;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!VARIANTS[options.variant]) {
    throw new Error(`Unknown variant "${options.variant}". Expected one of: ${Object.keys(VARIANTS).join(', ')}`);
  }

  const variant = VARIANTS[options.variant];
  options.output = resolve(projectRoot, options.output ?? join('data', variant.file));
  options.url = `https://huggingface.co/datasets/${options.repo}/resolve/${options.revision}/${variant.file}?download=true`;
  options.minBytes = variant.minBytes;
  return options;
}

function readValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function download(options) {
  if (existsSync(options.output) && !options.force) {
    throw new Error(`Output already exists: ${options.output}. Use --force to replace it.`);
  }

  mkdirSync(dirname(options.output), { recursive: true });
  const tmpPath = `${options.output}.tmp-${process.pid}`;
  if (existsSync(tmpPath)) {
    unlinkSync(tmpPath);
  }

  console.log(`Downloading ${options.url}`);
  console.log(`Writing ${options.output}`);

  const response = await fetch(options.url, {
    headers: {
      'User-Agent': 'atomic-bench/longmemeval-downloader',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}${body ? `\n${body.slice(0, 500)}` : ''}`);
  }

  if (!response.body) {
    throw new Error('Download failed: response body is empty');
  }

  const total = Number(response.headers.get('content-length') ?? 0);
  let received = 0;
  let lastProgress = 0;
  const out = createWriteStream(tmpPath, { flags: 'wx' });
  const reader = response.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received += value.byteLength;
      if (!out.write(Buffer.from(value))) {
        await once(out, 'drain');
      }

      const now = Date.now();
      if (now - lastProgress > 1000) {
        lastProgress = now;
        if (total > 0) {
          const pct = ((received / total) * 100).toFixed(1);
          process.stderr.write(`\r${formatBytes(received)} / ${formatBytes(total)} (${pct}%)`);
        } else {
          process.stderr.write(`\r${formatBytes(received)}`);
        }
      }
    }
  } catch (error) {
    out.destroy();
    cleanupTmp(tmpPath);
    throw error;
  }

  await new Promise((resolveDone, rejectDone) => {
    out.end((error) => (error ? rejectDone(error) : resolveDone()));
  });
  process.stderr.write('\n');

  const size = statSync(tmpPath).size;
  if (size < options.minBytes) {
    cleanupTmp(tmpPath);
    throw new Error(`Downloaded file is unexpectedly small: ${formatBytes(size)}`);
  }

  if (existsSync(options.output) && options.force) {
    unlinkSync(options.output);
  }
  renameSync(tmpPath, options.output);
  console.log(`Downloaded ${formatBytes(size)} to ${options.output}`);
}

function cleanupTmp(tmpPath) {
  try {
    if (existsSync(tmpPath)) {
      unlinkSync(tmpPath);
    }
  } catch {
    // Best effort cleanup.
  }
}

function validateLongMemEvalJson(path) {
  const stat = statSync(path);
  const prefixSize = Math.min(stat.size, 8 * 1024 * 1024);
  const fd = openSync(path, 'r');
  const buffer = Buffer.alloc(prefixSize);
  try {
    readSync(fd, buffer, 0, prefixSize, 0);
  } finally {
    closeSync(fd);
  }

  const prefix = buffer.toString('utf8');
  const first = prefix.search(/\S/);
  if (first === -1 || prefix[first] !== '[') {
    throw new Error('Downloaded file does not look like a JSON array');
  }

  const objectStart = prefix.indexOf('{', first);
  if (objectStart === -1) {
    throw new Error('Downloaded JSON array does not contain an object in the prefix');
  }

  const objectEnd = findJsonObjectEnd(prefix, objectStart);
  if (objectEnd === -1) {
    throw new Error('Could not validate first JSON object from file prefix');
  }

  const firstObject = JSON.parse(prefix.slice(objectStart, objectEnd + 1));
  const required = ['question_id', 'question', 'haystack_sessions', 'answer_session_ids'];
  const missing = required.filter((key) => !(key in firstObject));
  if (missing.length > 0) {
    throw new Error(`Downloaded JSON does not match LongMemEval shape; missing keys: ${missing.join(', ')}`);
  }

  if (!Array.isArray(firstObject.haystack_sessions)) {
    throw new Error('Downloaded JSON does not match LongMemEval shape; haystack_sessions is not an array');
  }

  console.log(`Validated LongMemEval JSON shape from first record (${firstObject.question_id}).`);
}

function findJsonObjectEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.dryRun) {
    console.log(`URL: ${options.url}`);
    console.log(`Output: ${options.output}`);
    return;
  }

  await download(options);
  if (options.validate) {
    validateLongMemEvalJson(options.output);
  }

  console.log('\nRun the benchmark with:');
  console.log(`cargo run -p atomic-bench -- run \\
  --suite memory-longitudinal \\
  --dataset ${relativeToProject(options.output)} \\
  --provider openrouter \\
  --embedding-model openai/text-embedding-3-small \\
  --tagging-model openai/gpt-4o-mini \\
  --enable-auto-tagging \\
  --limit 10 \\
  --top-k 10 \\
  --output bench/runs/longmemeval-${options.variant}-openrouter.jsonl`);
}

function relativeToProject(path) {
  const relative = path.startsWith(`${projectRoot}/`) ? path.slice(projectRoot.length + 1) : path;
  return relative.includes(' ') ? `"${relative}"` : relative;
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
