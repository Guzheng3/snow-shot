use log;
use paddle_ocr_rs::ocr_result::TextBlock;
use rayon::iter::IntoParallelIterator;
use rayon::iter::ParallelIterator;
use serde::Deserialize;
use serde::Serialize;
use snow_shot_app_services::ocr_service::{OcrModel, OcrService};
use std::io::Cursor;
use std::path::PathBuf;
use tauri::Emitter as _;
use tokio::sync::Mutex;

mod cloud;
use cloud::ocr_detect_cloud;

mod import;
pub use import::ocr_import_model_archive;

pub async fn ocr_init(
    orc_plugin_path: PathBuf,
    ocr_service: tauri::State<'_, Mutex<OcrService>>,
    model: OcrModel,
    hot_start: bool,
    ocr_model_write_to_memory: bool,
) -> Result<(), String> {
    let mut ocr_service = ocr_service.lock().await;

    ocr_service
        .init_models(orc_plugin_path, model, hot_start, ocr_model_write_to_memory)
        .await?;

    Ok(())
}

/// 配置云端 PaddleOCR token（供云端识别通道鉴权）
pub async fn ocr_set_cloud_token(
    ocr_service: tauri::State<'_, Mutex<OcrService>>,
    token: String,
) -> Result<(), String> {
    let mut ocr_service = ocr_service.lock().await;
    ocr_service.set_cloud_token(token);
    Ok(())
}

#[derive(Serialize, Deserialize)]
pub struct OcrDetectResult {
    pub text_blocks: Vec<TextBlock>,
    pub scale_factor: f32,
    /// 识别出的源语言（当前恒为 auto，前端可据此判断是否展示源语言标签）
    #[serde(default = "default_lang")]
    pub lang: String,
}

fn default_lang() -> String {
    "auto".to_string()
}

/// 将全角 ASCII 字符（U+FF01–U+FF5E）及全角空格（U+3000）归一化为半角，
/// 避免 OCR 把链接/代码/数字中的半角字符识别成全角（如 https：// 或 ＡＢＣ１２３）。
fn normalize_fullwidth_to_halfwidth(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '\u{3000}' => ' ',
            '\u{FF01}'..='\u{FF5E}' => char::from_u32(c as u32 - 0xFEE0).unwrap_or(c),
            _ => c,
        })
        .collect()
}

fn is_cjk_ideograph(c: char) -> bool {
    matches!(
        c,
        '\u{4E00}'..='\u{9FFF}'
            | '\u{3400}'..='\u{4DBF}'
            | '\u{20000}'..='\u{2A6DF}'
            | '\u{F900}'..='\u{FAFF}'
            | '\u{2F800}'..='\u{2FA1F}'
    )
}

fn is_mostly_chinese(text: &str) -> bool {
    let total = text.chars().count();
    if total == 0 {
        return false;
    }
    let cjk_count = text.chars().filter(|c| is_cjk_ideograph(*c)).count();
    (cjk_count as f64 / total as f64) >= 0.3
}

fn contains_url_pattern(text: &str) -> bool {
    let normalized = normalize_fullwidth_to_halfwidth(text);
    normalized.contains("http://")
        || normalized.contains("https://")
        || normalized.contains("ftp://")
        || normalized.contains("www.")
}

fn normalize_text_blocks(text_blocks: Vec<TextBlock>) -> Vec<TextBlock> {
    text_blocks
        .into_iter()
        .map(|mut block| {
            if contains_url_pattern(&block.text) || !is_mostly_chinese(&block.text) {
                block.text = normalize_fullwidth_to_halfwidth(&block.text);
            }
            block
        })
        .collect()
}

fn convert_rgba_to_rgb(image: &[u8]) -> Vec<u8> {
    let pixel_count = image.len() / 4;
    let mut rgb_data = Vec::with_capacity(pixel_count * 3);

    unsafe {
        rgb_data.set_len(pixel_count * 3);

        let image_ptr_address = image.as_ptr() as usize;
        let rgb_ptr_address = rgb_data.as_mut_ptr() as usize;

        (0..pixel_count).into_par_iter().for_each(|i| {
            let image_base = i * 4;
            let rgb_base = i * 3;
            std::ptr::copy_nonoverlapping(
                (image_ptr_address as *const u8).add(image_base),
                (rgb_ptr_address as *mut u8).add(rgb_base),
                3,
            );
        });
    }

    rgb_data
}

/// 云端失败且无本地模型（插件版未导入模型包）时，向前端广播"导入本地模型包"提示并返回错误
fn err_no_local_model(app: &tauri::AppHandle) -> Result<OcrDetectResult, String> {
    let _ = app.emit("ocr:local-model-required", ());
    Err(
        "OCR 暂时不可用：在线服务不可达（网络异常或云端调用失败），且当前版本未内置本地 OCR 模型，请在设置中导入本地 OCR 模型压缩包。"
            .to_string(),
    )
}

pub async fn ocr_detect_core(
    ocr_service: tauri::State<'_, Mutex<OcrService>>,
    app: tauri::AppHandle,
    image: image::DynamicImage,
    scale_factor: f32,
    detect_angle: bool,
) -> Result<OcrDetectResult, String> {
    let mut ocr_service = ocr_service.lock().await;

    // 云端优先：选择云端模型，或未配置本地模型（插件版未导入压缩包）时也走云端兜底
    let model = ocr_service.model();
    let cloud_first =
        model != Some(OcrModel::RapidOcrV5Server) || !ocr_service.has_local_models();

    if cloud_first && ocr_service.has_cloud_token() {
        let token = ocr_service
            .cloud_token()
            .expect("[ocr_detect_core] cloud token checked")
            .to_string();
        // 把动态图编码为 PNG bytes 用于 multipart 上传
        let mut cursor = Cursor::new(Vec::new());
        image
            .write_to(&mut cursor, image::ImageFormat::Png)
            .map_err(|e| format!("[ocr_detect_core] encode image failed: {}", e))?;
        let bytes = cursor.into_inner();

        match ocr_detect_cloud(bytes, &token, scale_factor).await {
            Ok(result) => return Ok(result),
            Err(cloud_err) => {
                log::warn!(
                    "[ocr_detect_core] cloud ocr failed, fallback local: {}",
                    cloud_err
                );
                // 无本地模型（插件版未导入）时返回错误并提示导入
                if !ocr_service.has_local_models() {
                    return err_no_local_model(&app);
                }
            }
        }
    }

    // 本地识别（云端失败回退 / 显式选择本地模型）
    if !ocr_service.has_local_models() {
        return err_no_local_model(&app);
    }
    let mut image = image;
    // 当前识别图相对原始输入图的整体缩放倍数，识别后需把 box 坐标映射回原图，保证前端叠加不偏移
    let mut total_scale: f32 = 1.0;

    // 分辨率过小的图片识别可能有问题，当 scale_factor 低于 1.5 时，放大图片使有效缩放达到 1.5
    let target_scale_factor = 1.5;
    if scale_factor < target_scale_factor && scale_factor > 0.0 {
        let resize_factor = target_scale_factor / scale_factor;
        image = image.resize(
            (image.width() as f32 * resize_factor) as u32,
            (image.height() as f32 * resize_factor) as u32,
            image::imageops::FilterType::Lanczos3,
        );
        total_scale *= resize_factor;
    }

    // 大图保护：长边超过上限时等比缩小以降低 OCR 计算量
    const MAX_DIMENSION: u32 = 4096;
    let longest = image.height().max(image.width());
    if longest > MAX_DIMENSION {
        let down_factor = longest as f32 / MAX_DIMENSION as f32;
        image = image.resize(
            (image.width() as f32 / down_factor).round() as u32,
            (image.height() as f32 / down_factor).round() as u32,
            image::imageops::FilterType::Lanczos3,
        );
        total_scale /= down_factor;
    }

    let max_size = image.height().max(image.width());

    let image_buffer = match image {
        image::DynamicImage::ImageRgb8(image) => image,
        image::DynamicImage::ImageRgba8(image) => {
            let rgb_data = convert_rgba_to_rgb(image.as_raw());
            image::RgbImage::from_raw(image.width(), image.height(), rgb_data).unwrap()
        }
        _ => return Err("[ocr_detect_core] Invalid image".to_string()),
    };
    let ocr_result = ocr_service.get_session().await?.detect_angle_rollback(
        &image_buffer,
        50,
        max_size,
        0.5,
        0.3,
        1.6,
        detect_angle,
        false,
        0.9, // 屏幕截取的文字质量通常较高，且非横向排版的情况较少，尽量减少角度的影响
    );

    match ocr_result {
        Ok(ocr_result) => {
            let mut text_blocks = ocr_result.text_blocks;
            // 识别图相对原始图被整体缩放（放大提精度 / 缩小保护），需把 box 映射回原图坐标，
            // 使前端叠加的文字框与 canvas 物理坐标对齐
            let inverse_scale = 1.0 / total_scale;
            if (inverse_scale - 1.0).abs() > f32::EPSILON {
                for block in &mut text_blocks {
                    for p in &mut block.box_points {
                        p.x = (p.x as f32 * inverse_scale).round() as u32;
                        p.y = (p.y as f32 * inverse_scale).round() as u32;
                    }
                }
            }
            Ok(OcrDetectResult {
                text_blocks: normalize_text_blocks(text_blocks),
                scale_factor,
                lang: "auto".to_string(),
            })
        }
        Err(e) => return Err(format!("[ocr_detect_core] Failed to detect text: {}", e)),
    }
}

pub async fn ocr_detect(
    app: tauri::AppHandle,
    ocr_service: tauri::State<'_, Mutex<OcrService>>,
    request: tauri::ipc::Request<'_>,
) -> Result<OcrDetectResult, String> {
    log::info!("[ocr_detect] start detect");

    let image_data = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data,
        _ => return Err("[ocr_detect] Invalid request body".to_string()),
    };

    let image = match image::load(Cursor::new(image_data), image::ImageFormat::Png) {
        Ok(image) => image,
        Err(_) => return Err("[ocr_detect] Invalid image".to_string()),
    };

    let scale_factor: f32 = match request.headers().get("x-scale-factor") {
        Some(header) => match header.to_str() {
            Ok(scale_factor) => scale_factor.parse::<f32>().unwrap(),
            Err(_) => return Err("[ocr_detect] Invalid scale factor".to_string()),
        },
        None => return Err("[ocr_detect] Missing scale factor".to_string()),
    };

    let detect_angle = match request.headers().get("x-detect-angle") {
        Some(header) => match header.to_str() {
            Ok(detect_angle) => detect_angle.parse::<bool>().unwrap(),
            Err(_) => return Err("[ocr_detect] Invalid detect angle".to_string()),
        },
        None => return Err("[ocr_detect] Missing detect angle".to_string()),
    };

    ocr_detect_core(ocr_service, app, image, scale_factor, detect_angle).await
}

#[cfg(target_os = "windows")]
pub async fn ocr_detect_with_shared_buffer(
    app: tauri::AppHandle,
    ocr_service: tauri::State<'_, Mutex<OcrService>>,
    shared_buffer_service: tauri::State<'_, std::sync::Arc<snow_shot_webview::SharedBufferService>>,
    channel_id: String,
    scale_factor: f32,
    detect_angle: bool,
) -> Result<OcrDetectResult, String> {
    log::info!("[ocr_detect_with_shared_buffer] start detect");

    let mut image_data = match shared_buffer_service.receive_data(channel_id) {
        Ok(image_data) => image_data,
        Err(e) => {
            return Err(format!(
                "[ocr_detect_with_shared_buffer] Failed to receive image data: {}",
                e
            ));
        }
    };

    if image_data.len() < 8 {
        return Err("[ocr_detect_with_shared_buffer] Invalid image data".to_string());
    }

    let image_width = u32::from_le_bytes(
        image_data[image_data.len() - 8..image_data.len() - 4]
            .try_into()
            .unwrap(),
    );
    let image_height = u32::from_le_bytes(
        image_data[image_data.len() - 4..image_data.len()]
            .try_into()
            .unwrap(),
    );

    // 移除末尾 8 字节的宽高信息，仅保留纯 RGBA 像素数据
    image_data.truncate(image_data.len() - 8);

    ocr_detect_core(
        ocr_service,
        app,
        image::DynamicImage::ImageRgba8(
            match image::RgbaImage::from_raw(image_width, image_height, image_data) {
                Some(image) => image,
                None => return Err("[ocr_detect_with_shared_buffer] Invalid image".to_string()),
            },
        ),
        scale_factor,
        detect_angle,
    )
    .await
}

pub async fn ocr_release(ocr_service: tauri::State<'_, Mutex<OcrService>>) -> Result<(), String> {
    let mut ocr_service = ocr_service.lock().await;

    ocr_service.release_session().await?;

    Ok(())
}
