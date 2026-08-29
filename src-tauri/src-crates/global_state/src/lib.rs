use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

#[derive(Clone, Serialize, Deserialize)]
pub struct CaptureState {
    pub capturing: bool,
}

/// 是否支持 WebView SharedBuffer 传输
pub struct WebViewSharedBufferState {
    pub enable: RwLock<bool>,
}

impl WebViewSharedBufferState {
    pub fn new(value: bool) -> Self {
        Self {
            enable: RwLock::new(value),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ReadClipboardState {
    pub reading: bool,
}

impl ReadClipboardState {
    pub fn new(value: bool) -> Self {
        Self { reading: value }
    }
}

/// 最近一次 OCR 识别结果的 JSON 字符串，供 OCR 结果弹窗窗口主动拉取
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrResultState {
    pub ocr_result_json: String,
    /// 弹窗模式：ocr —— 纯识别（默认展示原文）；translate —— 工具栏翻译（默认只展示译文）
    pub mode: String,
}

impl OcrResultState {
    pub fn new(ocr_result_json: String) -> Self {
        Self {
            ocr_result_json,
            mode: String::from("ocr"),
        }
    }
}
