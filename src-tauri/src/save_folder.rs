use std::path::Path;

pub fn is_available(path: &Path) -> bool {
    if !path.is_absolute() || !path.is_dir() || std::fs::read_dir(path).is_err() {
        return false;
    }
    has_save_access(path)
}

#[cfg(unix)]
fn has_save_access(path: &Path) -> bool {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    extern "C" {
        fn access(
            path: *const std::os::raw::c_char,
            mode: std::os::raw::c_int,
        ) -> std::os::raw::c_int;
    }
    let Ok(path) = CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    // R_OK | W_OK | X_OK: inspect permissions without creating a probe file.
    // SAFETY: CString supplies a valid, NUL-terminated path for this synchronous call.
    unsafe { access(path.as_ptr(), 4 | 2 | 1) == 0 }
}

#[cfg(not(unix))]
fn has_save_access(path: &Path) -> bool {
    path.metadata()
        .map(|metadata| !metadata.permissions().readonly())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_directory_and_rejects_missing_file_and_relative_paths() {
        let dir =
            std::env::temp_dir().join(format!("aspect-save-folder-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("file.txt");
        std::fs::write(&file, b"test").unwrap();
        assert!(is_available(&dir));
        assert!(!is_available(&file));
        assert!(!is_available(&dir.join("missing")));
        assert!(!is_available(Path::new(".")));
        std::fs::remove_file(file).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
