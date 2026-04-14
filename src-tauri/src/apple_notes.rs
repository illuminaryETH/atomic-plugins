//! Apple Notes importer — backend half.
//!
//! Exposes a single Tauri command, `read_apple_notes`, that takes the path to
//! the user's `group.com.apple.notes` folder, clones `NoteStore.sqlite` into a
//! temp directory (so we don't fight with Apple Notes for the write-ahead log),
//! and returns structured accounts / folders / notes. Note bodies are the raw
//! gunzipped protobuf bytes — the frontend handles protobuf decoding and
//! markdown conversion.
//!
//! The frontend is responsible for providing the folder path; this module
//! doesn't touch the filesystem beyond the provided path + the system temp dir.

use base64::Engine;
use flate2::read::GzDecoder;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};

/// Seconds between 1970-01-01 and 2001-01-01 (Apple's CoreTime epoch).
const CORETIME_OFFSET: f64 = 978_307_200.0;

const NOTE_DB: &str = "NoteStore.sqlite";
const APPLE_NOTES_RELATIVE_PATH: &str = "Library/Group Containers/group.com.apple.notes";

#[derive(Debug, Serialize, Deserialize)]
pub struct Account {
    pub pk: i64,
    pub name: String,
    pub uuid: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Folder {
    pub pk: i64,
    pub title: String,
    #[serde(rename = "parentPk")]
    pub parent_pk: Option<i64>,
    #[serde(rename = "accountPk")]
    pub account_pk: Option<i64>,
    pub identifier: String,
    /// Apple Notes folder type: 0 = default, 1 = trash, 3 = smart.
    #[serde(rename = "folderType")]
    pub folder_type: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Note {
    pub pk: i64,
    /// Stable UUID (Apple Notes `zidentifier`). Used for the source URL and
    /// `applenotes:note/<UUID>` deeplinks so the link survives across
    /// re-imports even if row PKs shift.
    pub identifier: String,
    pub title: String,
    #[serde(rename = "folderPk")]
    pub folder_pk: Option<i64>,
    /// Unix epoch milliseconds; None when the DB column was NULL.
    #[serde(rename = "creationDate")]
    pub creation_date: Option<i64>,
    #[serde(rename = "modificationDate")]
    pub modification_date: Option<i64>,
    #[serde(rename = "isPasswordProtected")]
    pub is_password_protected: bool,
    /// Gunzipped protobuf body, base64-encoded for transport over Tauri IPC.
    /// None when decompression failed — the frontend logs and skips.
    #[serde(rename = "protobufBase64")]
    pub protobuf_base64: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppleNotesData {
    pub accounts: Vec<Account>,
    pub folders: Vec<Folder>,
    pub notes: Vec<Note>,
}

/// Stable error categories the frontend matches on. `PermissionDenied` in
/// particular is load-bearing — the UI shows a "grant Full Disk Access"
/// affordance when it sees this kind.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleNotesError {
    pub kind: AppleNotesErrorKind,
    pub message: String,
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum AppleNotesErrorKind {
    /// `~/Library/Group Containers/group.com.apple.notes` isn't readable —
    /// almost always means the user hasn't granted Full Disk Access yet.
    PermissionDenied,
    /// Folder / DB file is missing (FDA granted but Apple Notes has never
    /// been opened on this Mac).
    NotFound,
    /// Couldn't determine $HOME.
    NoHomeDir,
    /// Everything else — SQLite errors, corrupt files, etc.
    Other,
}

impl AppleNotesError {
    fn permission_denied(msg: impl Into<String>) -> Self {
        Self { kind: AppleNotesErrorKind::PermissionDenied, message: msg.into() }
    }
    fn not_found(msg: impl Into<String>) -> Self {
        Self { kind: AppleNotesErrorKind::NotFound, message: msg.into() }
    }
    fn no_home_dir() -> Self {
        Self {
            kind: AppleNotesErrorKind::NoHomeDir,
            message: "Could not determine your home directory.".into(),
        }
    }
    fn other(msg: impl Into<String>) -> Self {
        Self { kind: AppleNotesErrorKind::Other, message: msg.into() }
    }
}

impl From<std::io::Error> for AppleNotesError {
    fn from(err: std::io::Error) -> Self {
        match err.kind() {
            std::io::ErrorKind::PermissionDenied => {
                AppleNotesError::permission_denied(err.to_string())
            }
            std::io::ErrorKind::NotFound => AppleNotesError::not_found(err.to_string()),
            _ => AppleNotesError::other(err.to_string()),
        }
    }
}

impl From<rusqlite::Error> for AppleNotesError {
    fn from(err: rusqlite::Error) -> Self {
        AppleNotesError::other(format!("SQLite: {err}"))
    }
}

/// Resolve the default Apple Notes folder path from $HOME.
fn default_notes_folder() -> Result<PathBuf, AppleNotesError> {
    let home = home_dir().ok_or_else(AppleNotesError::no_home_dir)?;
    Ok(home.join(APPLE_NOTES_RELATIVE_PATH))
}

fn home_dir() -> Option<PathBuf> {
    // std::env::home_dir was un-deprecated in 1.86 and returns the right value
    // on macOS for our purposes (respects $HOME, falls back to getpwuid).
    #[allow(deprecated)]
    std::env::home_dir()
}

/// Top-level Tauri command. `folder_path` is optional — when omitted we fall
/// back to `~/Library/Group Containers/group.com.apple.notes`, which is the
/// only path any real caller cares about.
#[tauri::command]
pub fn read_apple_notes(folder_path: Option<String>) -> Result<AppleNotesData, AppleNotesError> {
    let path = match folder_path {
        Some(p) if !p.is_empty() => PathBuf::from(p),
        _ => default_notes_folder()?,
    };
    read_apple_notes_inner(&path)
}

fn read_apple_notes_inner(folder_path: &Path) -> Result<AppleNotesData, AppleNotesError> {
    let source_db = folder_path.join(NOTE_DB);

    // `exists()` can't distinguish "not there" from "not allowed to look";
    // try to open the file and let the OS error speak for itself.
    match std::fs::File::open(&source_db) {
        Ok(_) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppleNotesError::not_found(format!(
                "NoteStore.sqlite not found at {}",
                source_db.display()
            )));
        }
        Err(err) => return Err(err.into()),
    }

    let cloned_db = clone_db_to_temp(&source_db)?;
    read_notes_from_db(&cloned_db)
}

/// Copy the SQLite DB (plus -shm and -wal sidecars if present) to the system
/// temp directory so we can open it read-only without interfering with the live
/// DB that Apple Notes may hold open.
fn clone_db_to_temp(source_db: &Path) -> Result<PathBuf, AppleNotesError> {
    let tmp_dir = std::env::temp_dir();
    let cloned_db = tmp_dir.join(NOTE_DB);

    std::fs::copy(source_db, &cloned_db)?;

    for sidecar in ["-shm", "-wal"] {
        let mut src = source_db.as_os_str().to_owned();
        src.push(sidecar);
        let src_path = PathBuf::from(src);
        if src_path.exists() {
            let mut dst = cloned_db.as_os_str().to_owned();
            dst.push(sidecar);
            std::fs::copy(&src_path, PathBuf::from(dst))?;
        }
    }

    Ok(cloned_db)
}

fn read_notes_from_db(db_path: &Path) -> Result<AppleNotesData, AppleNotesError> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;

    let keys = load_primary_keys(&conn)?;
    let accounts = load_accounts(&conn, keys.ic_account)?;
    let folders = load_folders(&conn, keys.ic_folder)?;
    let notes = load_notes(&conn, keys.ic_note)?;

    Ok(AppleNotesData { accounts, folders, notes })
}

struct PrimaryKeys {
    ic_account: i64,
    ic_folder: i64,
    ic_note: i64,
}

fn load_primary_keys(conn: &Connection) -> Result<PrimaryKeys, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT z_name, z_ent FROM z_primarykey")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;

    let mut ic_account = 0;
    let mut ic_folder = 0;
    let mut ic_note = 0;
    for row in rows {
        let (name, ent) = row?;
        match name.as_str() {
            "ICAccount" => ic_account = ent,
            "ICFolder" => ic_folder = ent,
            "ICNote" => ic_note = ent,
            _ => {}
        }
    }
    Ok(PrimaryKeys { ic_account, ic_folder, ic_note })
}

fn load_accounts(conn: &Connection, ic_account: i64) -> Result<Vec<Account>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT z_pk, zname, zidentifier FROM ziccloudsyncingobject WHERE z_ent = ?1",
    )?;
    let rows = stmt.query_map([ic_account], |r| {
        Ok(Account {
            pk: r.get(0)?,
            name: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
            uuid: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
        })
    })?;
    rows.collect()
}

fn load_folders(conn: &Connection, ic_folder: i64) -> Result<Vec<Folder>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT z_pk, ztitle2, zparent, zowner, zidentifier, zfoldertype \
         FROM ziccloudsyncingobject WHERE z_ent = ?1",
    )?;
    let rows = stmt.query_map([ic_folder], |r| {
        Ok(Folder {
            pk: r.get(0)?,
            title: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
            parent_pk: r.get(2)?,
            account_pk: r.get(3)?,
            identifier: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
            folder_type: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
        })
    })?;
    rows.collect()
}

fn load_notes(conn: &Connection, ic_note: i64) -> Result<Vec<Note>, rusqlite::Error> {
    // Matches the obsidian-importer query — the NULL-as-column trick means the
    // SELECT keeps working against older schemas that don't have
    // `zcreationdate3`, `zcreationdate2`, or `zispasswordprotected` yet.
    let sql = "\
        SELECT nd.znote, zcso.zidentifier, zcso.ztitle1, zcso.zfolder, nd.zdata, \
               zcso.zcreationdate1, zcso.zcreationdate2, zcso.zcreationdate3, \
               zcso.zmodificationdate1, zcso.zispasswordprotected \
        FROM zicnotedata AS nd, \
             (SELECT *, NULL AS zcreationdate3, NULL AS zcreationdate2, \
                     NULL AS zispasswordprotected FROM ziccloudsyncingobject) AS zcso \
        WHERE zcso.z_pk = nd.znote AND zcso.z_ent = ?1 AND zcso.ztitle1 IS NOT NULL";

    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([ic_note], |r| {
        let pk: i64 = r.get(0)?;
        let identifier: Option<String> = r.get(1)?;
        let title: Option<String> = r.get(2)?;
        let folder_pk: Option<i64> = r.get(3)?;
        let zdata: Option<Vec<u8>> = r.get(4)?;
        let cd1: Option<f64> = r.get(5)?;
        let cd2: Option<f64> = r.get(6)?;
        let cd3: Option<f64> = r.get(7)?;
        let md1: Option<f64> = r.get(8)?;
        let password: Option<i64> = r.get(9)?;

        // Prefer the most specific creation date column available.
        let creation = cd3.or(cd2).or(cd1);

        Ok(Note {
            pk,
            identifier: identifier.unwrap_or_default(),
            title: title.unwrap_or_default(),
            folder_pk,
            creation_date: creation.map(coretime_to_unix_ms),
            modification_date: md1.map(coretime_to_unix_ms),
            is_password_protected: matches!(password, Some(v) if v != 0),
            protobuf_base64: zdata.as_deref().and_then(gunzip_to_base64),
        })
    })?;
    rows.collect()
}

fn coretime_to_unix_ms(ct: f64) -> i64 {
    if ct < 1.0 {
        0
    } else {
        ((ct + CORETIME_OFFSET) * 1000.0) as i64
    }
}

fn gunzip_to_base64(data: &[u8]) -> Option<String> {
    let mut decoder = GzDecoder::new(data);
    let mut out = Vec::new();
    decoder.read_to_end(&mut out).ok()?;
    Some(base64::engine::general_purpose::STANDARD.encode(&out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;

    fn gzip(bytes: &[u8]) -> Vec<u8> {
        let mut enc = GzEncoder::new(Vec::new(), Compression::default());
        enc.write_all(bytes).unwrap();
        enc.finish().unwrap()
    }

    /// Build a minimal NoteStore-shaped DB with just the columns we read.
    fn build_fixture(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE z_primarykey (z_name TEXT, z_ent INTEGER);\n\
             INSERT INTO z_primarykey VALUES ('ICAccount', 1), ('ICFolder', 2), ('ICNote', 3);\n\
             CREATE TABLE ziccloudsyncingobject (\n\
                z_pk INTEGER PRIMARY KEY, z_ent INTEGER, zname TEXT, zidentifier TEXT,\n\
                ztitle1 TEXT, ztitle2 TEXT, zparent INTEGER, zowner INTEGER, zfolder INTEGER,\n\
                zfoldertype INTEGER,\n\
                zcreationdate1 REAL, zcreationdate2 REAL, zcreationdate3 REAL,\n\
                zmodificationdate1 REAL, zispasswordprotected INTEGER\n\
             );\n\
             CREATE TABLE zicnotedata (z_pk INTEGER PRIMARY KEY, znote INTEGER, zdata BLOB);",
        )
        .unwrap();

        // Account
        conn.execute(
            "INSERT INTO ziccloudsyncingobject (z_pk, z_ent, zname, zidentifier) \
             VALUES (100, 1, 'iCloud', 'acct-uuid')",
            [],
        )
        .unwrap();

        // Folder + Trash + Smart
        conn.execute(
            "INSERT INTO ziccloudsyncingobject \
             (z_pk, z_ent, ztitle2, zparent, zowner, zidentifier, zfoldertype) \
             VALUES (200, 2, 'Notes', NULL, 100, 'DefaultFolder', 0), \
                    (201, 2, 'Recently Deleted', NULL, 100, 'TrashFolder', 1), \
                    (202, 2, 'Locked', NULL, 100, 'Smart', 3)",
            [],
        )
        .unwrap();

        // Notes: one normal, one password-protected, one with bad gzip
        let blob = gzip(b"hello-protobuf");
        conn.execute(
            "INSERT INTO ziccloudsyncingobject \
             (z_pk, z_ent, ztitle1, zidentifier, zfolder, zcreationdate1, zmodificationdate1) \
             VALUES (300, 3, 'Good Note', 'UUID-GOOD', 200, 700000000, 700000100)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO zicnotedata (z_pk, znote, zdata) VALUES (1, 300, ?1)",
            [&blob],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO ziccloudsyncingobject \
             (z_pk, z_ent, ztitle1, zidentifier, zfolder, zispasswordprotected, zcreationdate1) \
             VALUES (301, 3, 'Locked Note', 'UUID-LOCKED', 200, 1, 700000200)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO zicnotedata (z_pk, znote, zdata) VALUES (2, 301, ?1)",
            [&blob],
        )
        .unwrap();

        // Garbled zdata — must not panic, protobuf_base64 = None
        conn.execute(
            "INSERT INTO ziccloudsyncingobject \
             (z_pk, z_ent, ztitle1, zidentifier, zfolder, zcreationdate1) \
             VALUES (302, 3, 'Corrupt', 'UUID-CORRUPT', 200, 700000300)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO zicnotedata (z_pk, znote, zdata) VALUES (3, 302, ?1)",
            [&b"not-gzip".to_vec()],
        )
        .unwrap();

        // Note with no title — must be filtered out by the WHERE clause
        conn.execute(
            "INSERT INTO ziccloudsyncingobject \
             (z_pk, z_ent, ztitle1, zidentifier, zfolder) \
             VALUES (303, 3, NULL, 'UUID-NOTITLE', 200)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO zicnotedata (z_pk, znote, zdata) VALUES (4, 303, ?1)",
            [&blob],
        )
        .unwrap();
    }

    #[test]
    fn missing_db_reports_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let err = read_apple_notes_inner(tmp.path()).unwrap_err();
        assert!(matches!(err.kind, AppleNotesErrorKind::NotFound));
    }

    #[test]
    fn permission_denied_is_propagated() {
        // Open a path that fs::File::open will reject with PermissionDenied.
        // `/private/var/root` exists but isn't readable as a regular user on
        // macOS. On other platforms / CI setups the exact error can be
        // ErrorKind::NotFound or similar, so we gate the assertion on what
        // the OS actually returned.
        let path = Path::new("/private/var/root");
        let direct = std::fs::File::open(path.join(NOTE_DB));
        if matches!(direct.as_ref().err().map(|e| e.kind()), Some(std::io::ErrorKind::PermissionDenied))
        {
            let err = read_apple_notes_inner(path).unwrap_err();
            assert!(matches!(err.kind, AppleNotesErrorKind::PermissionDenied));
        }
    }

    #[test]
    fn loads_accounts_folders_and_notes() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join(NOTE_DB);
        build_fixture(&db_path);

        let data = read_notes_from_db(&db_path).unwrap();

        assert_eq!(data.accounts.len(), 1);
        assert_eq!(data.accounts[0].name, "iCloud");
        assert_eq!(data.accounts[0].uuid, "acct-uuid");

        assert_eq!(data.folders.len(), 3);
        let folder_types: Vec<_> = data.folders.iter().map(|f| f.folder_type).collect();
        assert!(folder_types.contains(&0));
        assert!(folder_types.contains(&1));
        assert!(folder_types.contains(&3));

        // Only notes with a title get returned — the NULL-title row is filtered.
        let titles: Vec<_> = data.notes.iter().map(|n| n.title.as_str()).collect();
        assert!(titles.contains(&"Good Note"));
        assert!(titles.contains(&"Locked Note"));
        assert!(titles.contains(&"Corrupt"));
        assert!(!titles.contains(&""));

        let good = data.notes.iter().find(|n| n.title == "Good Note").unwrap();
        assert!(!good.is_password_protected);
        assert_eq!(good.identifier, "UUID-GOOD");
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(good.protobuf_base64.as_ref().unwrap())
            .unwrap();
        assert_eq!(decoded, b"hello-protobuf");

        let locked = data.notes.iter().find(|n| n.title == "Locked Note").unwrap();
        assert!(locked.is_password_protected);

        let corrupt = data.notes.iter().find(|n| n.title == "Corrupt").unwrap();
        assert!(corrupt.protobuf_base64.is_none());
    }

    #[test]
    fn coretime_matches_unix_epoch() {
        // 2001-01-01T00:00:00Z CoreTime = 978307200 Unix, i.e. CoreTime 0.
        assert_eq!(coretime_to_unix_ms(0.0), 0); // falls through the <1 branch
        assert_eq!(coretime_to_unix_ms(1.0), 978_307_201_000);
        assert_eq!(coretime_to_unix_ms(700_000_000.0), 1_678_307_200_000);
    }

    #[test]
    fn gunzip_round_trip() {
        let encoded = gunzip_to_base64(&gzip(b"payload")).unwrap();
        let decoded = base64::engine::general_purpose::STANDARD.decode(encoded).unwrap();
        assert_eq!(decoded, b"payload");
    }

    #[test]
    fn gunzip_returns_none_for_garbage() {
        assert!(gunzip_to_base64(b"not-gzip").is_none());
    }

    #[test]
    fn end_to_end_via_clone_path() {
        let tmp = tempfile::tempdir().unwrap();
        let source_db = tmp.path().join(NOTE_DB);
        build_fixture(&source_db);

        let data = read_apple_notes_inner(tmp.path()).unwrap();
        assert_eq!(data.accounts.len(), 1);
        assert!(data.notes.iter().any(|n| n.title == "Good Note"));
    }
}
