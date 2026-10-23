use std::path::{Path, PathBuf};

pub fn child(root: &Path, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name == "." || name == ".." || name.ends_with(['.', ' '])
        || name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c)) {
        return Err("Geçersiz dışa aktarma dosya adı".into());
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && stem.as_bytes()[3].is_ascii_digit()) {
        return Err("Ayrılmış dosya adı".into());
    }
    let path = root.join(name);
    match std::fs::symlink_metadata(&path) {
        Ok(_) => return Err("Dışa aktarma hedefi zaten var; boş bir klasör seçin".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(e) => return Err(e.to_string()),
    }
    Ok(path)
}

pub fn write(path: impl AsRef<Path>, bytes: impl AsRef<[u8]>) -> std::io::Result<()> {
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn existing_targets_are_never_overwritten() {
        let root = std::env::temp_dir().join(format!("fltr-export-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("keep.txt");
        std::fs::write(&file, b"original").unwrap();
        assert!(child(&root, "keep.txt").is_err());
        assert!(write(&file, b"replacement").is_err());
        assert_eq!(std::fs::read(&file).unwrap(), b"original");
        std::fs::remove_file(&file).unwrap();
        std::fs::remove_dir(&root).unwrap();
    }
    #[test]
    fn rejects_escape_and_device_names() {
        for name in ["../outside", "..\\outside", "C:\\file", "a:b", "..", "NUL.png", "COM1", "file.", "file "] {
            assert!(child(Path::new("."), name).is_err(), "{name}");
        }
        assert!(child(Path::new("."), "fltr-export-test.png").is_ok());
    }
}
