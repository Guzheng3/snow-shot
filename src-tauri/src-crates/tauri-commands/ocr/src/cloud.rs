use crate::{normalize_text_blocks, OcrDetectResult};
use paddle_ocr_rs::ocr_result::{Point, TextBlock};
use serde_json::Value;
use std::time::Duration;

/// 云端 PaddleOCR v6 识别 endpoint（不内置模型，仅提交任务）
const CLOUD_JOB_URL: &str = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";
/// 固定的云端模型（仅支持 v6）
const CLOUD_MODEL: &str = "PP-OCRv6";

/// 构建请求 Header：云端用 bearer token 鉴权
fn build_headers(token: &str) -> Result<reqwest::header::HeaderMap, String> {
    let mut headers = reqwest::header::HeaderMap::new();
    let mut auth_value = reqwest::header::HeaderValue::from_str(&format!("bearer {}", token))
        .map_err(|e| format!("[cloud_ocr] invalid token: {}", e))?;
    auth_value.set_sensitive(true);
    headers.insert(reqwest::header::AUTHORIZATION, auth_value);
    Ok(headers)
}

/// 从 jsonl 结果中递归定位识别文本数组（兼容多种字段命名）：
/// 常见命名如 `recTexts` / `recognizeTexts` / `rec_texts` / `texts`。
/// 返回 (文本列表, 是否有匹配的文本字段)
fn extract_texts(value: &Value) -> (Vec<String>, bool) {
    // 常见字段名优先
    const TEXT_KEYS: &[&str] = &["recTexts", "recognizeTexts", "rec_texts", "texts"];
    if let Some(obj) = value.as_object() {
        for key in TEXT_KEYS {
            if let Some(arr) = obj.get(*key) {
                if let Some(list) = arr.as_array() {
                    let texts: Vec<String> = list
                        .iter()
                        .filter_map(|v| {
                            v.as_str().map(|s| s.to_string()).or_else(|| {
                                // 兜底：字段可能是 { text: "..." } 的对象
                                v.get("text").and_then(|t| t.as_str()).map(String::from)
                            })
                        })
                        .collect();
                    if !texts.is_empty() {
                        return (texts, true);
                    }
                }
            }
        }
    }
    (Vec::new(), false)
}

/// 从 jsonl 结果中递归定位坐标框数组（兼容云端 v2 返回的 `dt_polys` / `rec_polys`，
/// 以及通用的 `recTextBoxes` / `recognizeTextBoxes` / `boxes` / `bboxes`）。
/// 返回每个框的 4 个角点（[[x, y], ...]）。
fn extract_boxes(value: &Value) -> (Vec<Vec<Vec<f64>>>, bool) {
    const BOX_KEYS: &[&str] = &[
        "dt_polys",
        "rec_polys",
        "recTextBoxes",
        "recognizeTextBoxes",
        "boxes",
        "bboxes",
    ];
    if let Some(obj) = value.as_object() {
        for key in BOX_KEYS {
            if let Some(arr) = obj.get(*key) {
                if let Some(list) = arr.as_array() {
                    let boxes: Vec<Vec<Vec<f64>>> = list
                        .iter()
                        .filter_map(|v| {
                            let pts = v.as_array()?;
                            // 每个框由 4 点或任意点构成
                            let points: Vec<Vec<f64>> = pts
                                .iter()
                                .filter_map(|p| {
                                    let pair = p.as_array()?;
                                    if pair.len() >= 2 {
                                        Some(vec![
                                            pair[0].as_f64()?,
                                            pair[1].as_f64()?,
                                        ])
                                    } else {
                                        None
                                    }
                                })
                                .collect();
                            if points.len() >= 4 {
                                Some(points)
                            } else {
                                None
                            }
                        })
                        .collect();
                    if !boxes.is_empty() {
                        return (boxes, true);
                    }
                }
            }
        }
    }
    (Vec::new(), false)
}

/// 从一行 jsonl（`result.ocrResults[0]` 或递归下降）中提取文本块。
/// 兼容两种情形：
/// 1. 上层已有 recTexts + recTextBoxes（平铺）；2. 需要递归下降到 layout/ocrResults 中。
fn extract_text_blocks(root: &Value) -> Vec<TextBlock> {
    // 占位框的基准坐标：云端未返回坐标时用来从上到下排布文本，保证前端读取不越界
    let mut placeholder_x = 0u32;
    let mut placeholder_y = 0u32;

    // 收集所有候选对象：root 本身 + 递归遍历到的叶子对象，取第一个带文本和坐标的对象
    fn walk(value: &Value, out: &mut Vec<Value>) {
        match value {
            Value::Object(_) => {
                out.push(value.clone());
                for v in value.as_object().unwrap().values() {
                    walk(v, out);
                }
            }
            Value::Array(arr) => {
                for v in arr {
                    walk(v, out);
                }
            }
            _ => {}
        }
    }

    let mut candidates = Vec::new();
    walk(root, &mut candidates);

    let mut text_blocks = Vec::new();
    let mut matched = false;

    for candidate in &candidates {
        let (texts, has_text) = extract_texts(candidate);
        let (boxes, has_boxes) = extract_boxes(candidate);
        if !has_text {
            continue;
        }
        matched = true;

        for (i, text) in texts.iter().enumerate() {
            let box_points: Vec<Point> = if has_boxes && i < boxes.len() && !boxes[i].is_empty() {
                boxes[i]
                    .iter()
                    .filter_map(|p| {
                        // 坐标取整为像素
                        if p.len() >= 2 {
                            Some(Point {
                                x: p[0].round() as u32,
                                y: p[1].round() as u32,
                            })
                        } else {
                            None
                        }
                    })
                    .collect()
            } else {
                // 云端未返回坐标（或坐标缺失）：保持空，由下方生成占位框
                Vec::new()
            };

            // 若最终仍无坐标，则生成占位四边形（上一行文本 y 递增），避免空 box_points
            let final_points = if box_points.is_empty() {
                let base_y = placeholder_y;
                placeholder_y += 24;
                vec![
                    Point { x: placeholder_x, y: base_y },
                    Point { x: placeholder_x + 360, y: base_y },
                    Point {
                        x: placeholder_x + 360,
                        y: base_y + 20,
                    },
                    Point { x: placeholder_x, y: base_y + 20 },
                ]
            } else {
                box_points
            };

            text_blocks.push(TextBlock {
                box_points: final_points,
                box_score: 0.0,
                angle_index: 0,
                angle_score: 0.0,
                text: text.clone(),
                text_score: 0.0,
            });
        }
    }

    // 递归下降后仍没取到文本，则尝试兜底：把 root 里所有字符串当作候选文本（仅当确实没有结构化字段时）
    if !matched {
        let mut raw_texts = Vec::new();
        collect_strings(root, &mut raw_texts);
        // 去掉明显的标识类字符串（logId / errorCode 等），只保留较长的文本
        let filtered: Vec<String> = raw_texts
            .into_iter()
            .filter(|s| {
                let t = s.trim();
                t.len() >= 2 && !t.contains("errorCode") && !t.contains("logId")
            })
            .collect();
        if !filtered.is_empty() {
            for text in filtered {
                let base_y = placeholder_y;
                placeholder_y += 24;
                text_blocks.push(TextBlock {
                    box_points: vec![
                        Point { x: placeholder_x, y: base_y },
                        Point { x: placeholder_x + 360, y: base_y },
                        Point {
                            x: placeholder_x + 360,
                            y: base_y + 20,
                        },
                        Point { x: placeholder_x, y: base_y + 20 },
                    ],
                    box_score: 0.0,
                    angle_index: 0,
                    angle_score: 0.0,
                    text,
                    text_score: 0.0,
                });
            }
        }
    }

    text_blocks
}

/// 递归收集所有字符串值（兜底）
fn collect_strings(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::String(s) => out.push(s.clone()),
        Value::Object(map) => {
            for v in map.values() {
                collect_strings(v, out);
            }
        }
        Value::Array(arr) => {
            for v in arr {
                collect_strings(v, out);
            }
        }
        _ => {}
    }
}

/// 上交云端任务：上传本地截图文件（multipart），返回 jobId
async fn submit_job(
    client: &reqwest::Client,
    token: &str,
    bytes: Vec<u8>,
    filename: &str,
) -> Result<String, String> {
    // 云端接口对 optionalPayload 做严格校验，任何不支持的字段都会触发 HTTP 400
    // "请求参数错误，请检查 optionalPayload 参数格式或内容"，因此此处置为空对象
    let optional_payload = serde_json::json!({});

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(filename.to_string())
        .mime_str("image/png")
        .map_err(|e| format!("[cloud_ocr] invalid part: {}", e))?;

    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", CLOUD_MODEL.to_string())
        .text("optionalPayload", optional_payload.to_string());

    let headers = build_headers(token)?;
    let response = client
        .post(CLOUD_JOB_URL)
        .headers(headers)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("[cloud_ocr] submit job failed: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("[cloud_ocr] read submit response failed: {}", e))?;

    if status != 200 {
        return Err(format!(
            "[cloud_ocr] submit job HTTP {} failed, body: {}",
            status, body
        ));
    }

    let parsed: Value = serde_json::from_str(&body)
        .map_err(|e| format!("[cloud_ocr] parse submit response failed: {}", e))?;
    let job_id = parsed
        .get("data")
        .and_then(|d| d.get("jobId"))
        .and_then(|j| j.as_str())
        .ok_or_else(|| format!("[cloud_ocr] response missing jobId: {}", body))?;
    Ok(job_id.to_string())
}

/// 轮询云端任务直到完成，返回结果 jsonl 的文本内容
async fn poll_job(
    client: &reqwest::Client,
    token: &str,
    job_id: &str,
    max_wait_secs: u64,
) -> Result<String, String> {
    let headers = build_headers(token)?;
    let job_url = format!("{}/{}", CLOUD_JOB_URL, job_id);
    let started = std::time::Instant::now();

    loop {
        let response = client
            .get(&job_url)
            .headers(headers.clone())
            .send()
            .await
            .map_err(|e| format!("[cloud_ocr] poll job failed: {}", e))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| format!("[cloud_ocr] read poll response failed: {}", e))?;
        if status != 200 {
            return Err(format!(
                "[cloud_ocr] poll job HTTP {} failed, body: {}",
                status, body
            ));
        }

        let parsed: Value = serde_json::from_str(&body)
            .map_err(|e| format!("[cloud_ocr] parse poll response failed: {}", e))?;
        let data = parsed.get("data").ok_or("missing data")?;
        let state = data
            .get("state")
            .and_then(|s| s.as_str())
            .unwrap_or("");

        match state {
            "done" => {
                let jsonl_url = data
                    .get("resultUrl")
                    .and_then(|r| r.get("jsonUrl"))
                    .and_then(|u| u.as_str())
                    .ok_or("[cloud_ocr] resultUrl.jsonUrl missing")?;
                let jsonl_response = client
                    .get(jsonl_url)
                    .send()
                    .await
                    .map_err(|e| format!("[cloud_ocr] fetch jsonl failed: {}", e))?;
                let jsonl_text = jsonl_response
                    .text()
                    .await
                    .map_err(|e| format!("[cloud_ocr] read jsonl failed: {}", e))?;
                return Ok(jsonl_text);
            }
            "failed" => {
                let err = data
                    .get("errorMsg")
                    .and_then(|e| e.as_str())
                    .unwrap_or("unknown error");
                return Err(format!("[cloud_ocr] job failed: {}", err));
            }
            _ => {
                // pending / running
                if started.elapsed().as_secs() >= max_wait_secs {
                    return Err("[cloud_ocr] poll timeout".to_string());
                }
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
}

/// 云端 PaddleOCR v6 识别入口：
/// 将 PNG 截图 bytes 上传云端 → 轮询 → 解析 jsonl → 转 OcrDetectResult
pub async fn ocr_detect_cloud(
    image_bytes: Vec<u8>,
    token: &str,
    scale_factor: f32,
) -> Result<OcrDetectResult, String> {
    let client = reqwest::Client::new();
    let filename = "snow_shot_ocr.png".to_string();

    let job_id = submit_job(&client, token, image_bytes, &filename).await?;
    log::info!("[cloud_ocr] job submitted: {}", job_id);

    let jsonl_text = poll_job(&client, token, &job_id, 120).await?;

    // 每行是一个 json result
    let mut text_blocks: Vec<TextBlock> = Vec::new();
    for line in jsonl_text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parsed: Value = serde_json::from_str(line)
            .map_err(|e| format!("[cloud_ocr] parse jsonl line failed: {}", e))?;
        // 优先取 result.ocrResults[0]，否则递归整行
        let target = parsed
            .get("result")
            .and_then(|r| r.get("ocrResults"))
            .and_then(|a| a.as_array())
            .and_then(|a| a.first())
            .cloned()
            .unwrap_or(parsed);
        text_blocks.extend(extract_text_blocks(&target));
    }

    // 坐标映射：云端返回的是原尺寸截图坐标，前端有 scale_factor，这里直接返回，与本地一致
    Ok(OcrDetectResult {
        text_blocks: normalize_text_blocks(text_blocks),
        scale_factor,
        lang: "auto".to_string(),
    })
}