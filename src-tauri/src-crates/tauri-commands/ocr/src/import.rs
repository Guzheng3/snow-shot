use snow_shot_app_services::file_cache_service::FileCacheService;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// 本地 OCR 模型必需的文件（自当前内置版本导出，解压后归一化到目录根）
const REQUIRED_MODEL_FILES: [&str; 4] = [
    "ch_PP-OCRv5_server_det.onnx",
    "ch_ppocr_mobile_v2.0_cls_mobile.onnx",
    "ch_PP-OCRv5_rec_server.onnx",
    "ppocrv5_dict.txt",
];

/// 计算导入后的目标目录：应用配置目录下的 ocr_model/
fn model_dir(app: &tauri::AppHandle, file_cache_service: &FileCacheService) -> Result<PathBuf, String> {
    let app_config_dir = file_cache_service
        .get_app_config_dir(app)
        .map_err(|e| format!("[ocr_import_model_archive] get app config dir failed: {}", e))?;
    Ok(app_config_dir.join("ocr_model"))
}

/// 递归在 self_dir 中查找名为 file_name 的文件，返回其完整路径
fn find_file(dir: &Path, file_name: &str) -> Option<PathBuf> {
    if dir.is_dir() {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(found) = find_file(&path, file_name) {
                        return Some(found);
                    }
                } else if path.file_name().map(|n| n == file_name).unwrap_or(false) {
                    return Some(path);
                }
            }
        }
    }
    None
}

/// 在 dest_dir 中递归查找缺失的必需文件并复制到目录根，保证 OCR 服务按固定文件名加载
fn normalize_model_files(dest_dir: &Path) -> Result<(), String> {
    if !dest_dir.is_dir() {
        return Err("[ocr_import_model_archive] extracted dir missing".to_string());
    }

    for file_name in REQUIRED_MODEL_FILES {
        let root_path = dest_dir.join(file_name);
        if root_path.exists() {
            continue;
        }
        let found = find_file(dest_dir, file_name).ok_or_else(|| {
            format!(
                "[ocr_import_model_archive] required model file not found in archive: {file_name}"
            )
        })?;
        fs::copy(&found, &root_path).map_err(|e| {
            format!("[ocr_import_model_archive] copy {file_name} failed: {}", e)
        })?;
    }

    Ok(())
}

/// 导入 OCR 模型压缩包：解压到应用配置目录 ocr_model/，并删除原压缩包，
/// 只保留解压之后的模型文件。返回解压目录路径。
pub async fn ocr_import_model_archive(
    app: tauri::AppHandle,
    file_cache_service: tauri::State<'_, Arc<FileCacheService>>,
    archive_path: PathBuf,
) -> Result<PathBuf, String> {
    log::info!(
        "[ocr_import_model_archive] archive_path: {:?}",
        archive_path
    );

    if !archive_path.exists() {
        return Err(format!(
            "[ocr_import_model_archive] archive not found: {:?}",
            archive_path
        ));
    }

    let dest_dir = model_dir(&app, &file_cache_service)?;

    // 覆盖式导入：清理旧目录
    if dest_dir.exists() {
        fs::remove_dir_all(&dest_dir).map_err(|e| {
            format!(
                "[ocr_import_model_archive] clear old model dir failed: {}",
                e
            )
        })?;
    }
    fs::create_dir_all(&dest_dir).map_err(|e| {
        format!(
            "[ocr_import_model_archive] create model dir failed: {}",
            e
        )
    })?;

    // 解压（zip 4.x 的 enclosed_name 已做过路径穿越防护）
    let file = fs::File::open(&archive_path).map_err(|e| {
        format!(
            "[ocr_import_model_archive] open archive failed: {}",
            e
        )
    })?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| {
        format!(
            "[ocr_import_model_archive] invalid zip archive: {}",
            e
        )
    })?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| {
            format!(
                "[ocr_import_model_archive] read zip entry failed: {}",
                e
            )
        })?;

        // 手动清理相对路径，防止路径穿越（拒绝绝对路径、含 .. 的路径）
        let raw_name = entry.name().replace('\\', "/");
        if raw_name.starts_with('/') || raw_name.split('/').any(|seg| seg == "..") {
            log::warn!(
                "[ocr_import_model_archive] skip unsafe entry: {}",
                entry.name()
            );
            continue;
        }
        let entry_path = Path::new(&raw_name);

        let out_path = dest_dir.join(entry_path);
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| {
                format!(
                    "[ocr_import_model_archive] create dir {:?} failed: {}",
                    entry.name(),
                    e
                )
            })?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    format!(
                        "[ocr_import_model_archive] create parent {:?} failed: {}",
                        parent, e
                    )
                })?;
            }
            let mut out_file = fs::File::create(&out_path).map_err(|e| {
                format!(
                    "[ocr_import_model_archive] create file {:?} failed: {}",
                    entry.name(),
                    e
                )
            })?;
            std::io::copy(&mut entry, &mut out_file).map_err(|e| {
                format!(
                    "[ocr_import_model_archive] extract {:?} failed: {}",
                    entry.name(),
                    e
                )
            })?;
        }
    }

    // 归一化：确保必需模型文件位于目录根
    normalize_model_files(&dest_dir)?;

    // 只保留解压之后的文件，删除原压缩包
    fs::remove_file(&archive_path).map_err(|e| {
        format!(
            "[ocr_import_model_archive] remove archive failed: {}",
            e
        )
    })?;

    log::info!(
        "[ocr_import_model_archive] success, model dir: {:?}",
        dest_dir
    );

    Ok(dest_dir)
}