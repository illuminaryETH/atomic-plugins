use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DatasetManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub atoms: String,
    #[serde(default)]
    pub queries: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BenchAtom {
    pub id: String,
    pub content: String,
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BenchQuery {
    pub id: String,
    pub query: String,
    #[serde(default)]
    pub relevant_atom_ids: Vec<String>,
    #[serde(default)]
    pub suite: Option<String>,
}

#[derive(Debug, Clone)]
pub struct BenchDataset {
    pub root: PathBuf,
    pub manifest: DatasetManifest,
    pub atoms: Vec<BenchAtom>,
    pub queries: Vec<BenchQuery>,
    pub fingerprint: String,
}

impl BenchDataset {
    pub fn load(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        let manifest_path = root.join("manifest.json");
        let manifest: DatasetManifest = serde_json::from_reader(
            File::open(&manifest_path)
                .with_context(|| format!("open {}", manifest_path.display()))?,
        )
        .with_context(|| format!("parse {}", manifest_path.display()))?;

        let atoms_path = root.join(&manifest.atoms);
        let atoms = read_jsonl::<BenchAtom>(&atoms_path)?;

        let queries = match &manifest.queries {
            Some(path) => read_jsonl::<BenchQuery>(&root.join(path))?,
            None => Vec::new(),
        };

        let mut fingerprint_paths = vec![manifest_path, atoms_path];
        if let Some(path) = &manifest.queries {
            fingerprint_paths.push(root.join(path));
        }
        let fingerprint = fingerprint_files(&fingerprint_paths)?;

        Ok(Self {
            root,
            manifest,
            atoms,
            queries,
            fingerprint,
        })
    }
}

fn read_jsonl<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Vec<T>> {
    let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mut rows = Vec::new();
    for (idx, line) in BufReader::new(file).lines().enumerate() {
        let line = line.with_context(|| format!("read {} line {}", path.display(), idx + 1))?;
        if line.trim().is_empty() {
            continue;
        }
        rows.push(
            serde_json::from_str(&line)
                .with_context(|| format!("parse {} line {}", path.display(), idx + 1))?,
        );
    }
    Ok(rows)
}

fn fingerprint_files(paths: &[PathBuf]) -> Result<String> {
    let mut hasher = Sha256::new();
    for path in paths {
        hasher.update(path.to_string_lossy().as_bytes());
        hasher.update(b"\0");
        let bytes = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
        hasher.update(bytes);
        hasher.update(b"\0");
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn fingerprint_path(path: impl AsRef<Path>) -> Result<String> {
    let path = path.as_ref();
    let bytes = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(b"\0");
    hasher.update(bytes);
    Ok(format!("{:x}", hasher.finalize()))
}
