use tauri::command;
use tokio::sync::Mutex;

use snow_shot_global_state::{CaptureState, OcrResultState, ReadClipboardState};

#[command]
pub async fn set_capture_state(
    capture_state: tauri::State<'_, Mutex<CaptureState>>,
    capturing: bool,
) -> Result<(), String> {
    let mut capture_state = capture_state.lock().await;
    capture_state.capturing = capturing;

    Ok(())
}

#[command]
pub async fn get_capture_state(
    capture_state: tauri::State<'_, Mutex<CaptureState>>,
) -> Result<CaptureState, String> {
    let capture_state = capture_state.lock().await;
    Ok(capture_state.clone())
}

#[command]
pub async fn set_read_clipboard_state(
    read_clipboard_state: tauri::State<'_, Mutex<ReadClipboardState>>,
    reading: bool,
) -> Result<(), String> {
    let mut read_clipboard_state = read_clipboard_state.lock().await;
    read_clipboard_state.reading = reading;
    Ok(())
}

#[command]
pub async fn get_read_clipboard_state(
    read_clipboard_state: tauri::State<'_, Mutex<ReadClipboardState>>,
) -> Result<ReadClipboardState, String> {
    let read_clipboard_state = read_clipboard_state.lock().await;
    Ok(read_clipboard_state.clone())
}

#[command]
pub async fn set_ocr_result_state(
    ocr_result_state: tauri::State<'_, Mutex<OcrResultState>>,
    ocr_result_json: String,
    mode: Option<String>,
) -> Result<(), String> {
    let mut ocr_result_state = ocr_result_state.lock().await;
    ocr_result_state.ocr_result_json = ocr_result_json;
    if let Some(mode) = mode {
        ocr_result_state.mode = mode;
    }
    Ok(())
}

#[command]
pub async fn get_ocr_result_state(
    ocr_result_state: tauri::State<'_, Mutex<OcrResultState>>,
) -> Result<OcrResultState, String> {
    let ocr_result_state = ocr_result_state.lock().await;
    Ok(ocr_result_state.clone())
}
