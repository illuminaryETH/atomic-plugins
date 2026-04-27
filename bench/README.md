# Atomic Benchmarks

This directory contains reproducible benchmark fixtures and run outputs for the
`atomic-bench` workspace crate.

## Layout

```text
bench/
  datasets/
    atomic-mini/
      manifest.json
      atoms.jsonl
      queries.jsonl
  runs/
  reports/
```

Datasets are directory-based. Each dataset has a `manifest.json` plus JSONL
files for atoms and, when needed, query/relevance fixtures. The runner computes
a dataset fingerprint from those files and includes it in every emitted metric.

## Run

```bash
cargo run -p atomic-bench -- list
cargo run -p atomic-bench -- run \
  --suite pipeline-smoke \
  --dataset bench/datasets/atomic-mini \
  --output bench/runs/pipeline-smoke.jsonl
```

`pipeline-smoke` uses a local deterministic OpenAI-compatible mock. It creates a
temporary SQLite database, imports fixture atoms, waits for embedding/tagging
completion, runs graph maintenance, computes canvas data, and emits JSONL
metrics.

## Suites

The suite structure mirrors the six benchmark layers Atomic needs:

| Suite | Layer | Status |
| --- | --- | --- |
| `pipeline-smoke` | Core pipeline: chunking, embedding, tagging, graph maintenance, canvas compute | Runnable smoke suite |
| `retrieval-mini` | Keyword, semantic, and hybrid retrieval quality | Scaffolded metric contract |
| `rag-chat` | Chat answer quality, grounding, citations, and tool calls | Scaffolded metric contract |
| `wiki-synthesis` | Wiki synthesis quality, citation coverage, update preservation | Scaffolded metric contract |
| `graph-canvas` | Semantic edges, clustering, global sensemaking, canvas latency | Scaffolded metric contract |
| `memory-longitudinal` | Personal memory recall, temporal reasoning, updates, abstention | Scaffolded metric contract |

Scaffolded suites intentionally emit `suite.scaffold_ready`,
`dataset.atoms_total`, `dataset.queries_total`, and `suite.planned_metric`
records only. They establish the CLI names, report shape, and planned metrics
without pretending to produce quality scores before the evaluator exists.

## LongMemEval

`memory-longitudinal` also accepts the official LongMemEval cleaned JSON files
directly:

```bash
npm run bench:download-longmemeval
```

That downloads the cleaned small split from Hugging Face to
`data/longmemeval_s_cleaned.json`. The source dataset is
`xiaowu0162/longmemeval-cleaned`; it is MIT licensed and the small split is
about 277 MB.

```bash
cargo run -p atomic-bench -- run \
  --suite memory-longitudinal \
  --dataset data/longmemeval_s_cleaned.json \
  --limit 10 \
  --top-k 10 \
  --output bench/runs/longmemeval-s.jsonl
```

By default, the runner uses the local deterministic mock provider. To exercise
real Atomic AI provider calls through OpenRouter:

```bash
export OPENROUTER_API_KEY="..."

cargo run -p atomic-bench -- run \
  --suite memory-longitudinal \
  --dataset data/longmemeval_s_cleaned.json \
  --provider openrouter \
  --embedding-model openai/text-embedding-3-small \
  --tagging-model openai/gpt-4o-mini \
  --enable-auto-tagging \
  --limit 10 \
  --top-k 10 \
  --output bench/runs/longmemeval-s-openrouter.jsonl
```

Omit `--enable-auto-tagging` for an embeddings-only run. The currently
implemented LongMemEval score is evidence retrieval; enabling auto-tagging
also exercises Atomic's LLM tagging path during ingestion.

The first implemented LongMemEval metric is session-level evidence retrieval:
each benchmark instance is loaded into an isolated temporary Atomic database,
history sessions are imported as timestamped atoms, Atomic hybrid search is run
for the benchmark question, and the returned session ids are scored against
`answer_session_ids`.

Emitted metrics include:

- `longmemeval.evidence_session_recall_at_k`
- `longmemeval.evidence_session_mrr`
- `longmemeval.evidence_session_hit_at_k_rate`
- ingest/search/duration timings
- provider request counts

This is the judge-free foundation for the full LongMemEval benchmark. Answer
generation and LLM-judge scoring can be layered on top while preserving the same
dataset adapter and run metadata.

## Metric Format

Each line is a standalone JSON object with:

- run metadata: `run_id`, `suite`, dataset id/version/fingerprint
- metric identity: `metric`, `value`, `unit`
- optional labels for per-atom or per-query detail

This shape is intended to stay stable enough for future compare/report tools.
