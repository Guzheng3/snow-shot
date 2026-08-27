use log;
use paddle_ocr_rs::ocr_result::{Point, TextBlock};
use serde_json::Value;
use std::time::{Duration, Instant};

/// 百度 AI Studio PaddleOCR 服务化部署 API 地址
const JOB_URL: &str = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";
/// 使用的模型名称
const MODEL: &str = "PP-OCRv6";

/// 识别结果可能较慢，最长轮询等待时间
const POLL_TIMEOUT: Duration = Duration::from_secs(120);
/// 轮询间隔
const POLL_INTERVAL: Duration = Duration::from_secs(2);

fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// 提交 OCR 任务，返回 jobId
async fn submit_job(image_bytes: Vec<u8>, token: &str) -> Result<String, String> {
    let optional_payload = serde_json::json!({
        "useDocOrientationClassify": false,
        "useDocUnwarping": false,
        "useTextlineOrientation": false,
    });

    let file_part = reqwest::multipart::Part::bytes(image_bytes)
        .file_name("image.png")
        .mime_str("image/png")
        .map_err(|e| format!("PP-OCRv6 构造文件表单失败: {}", e))?;

    let form = reqwest::multipart::Form::new()
        .text("model", MODEL.to_string())
        .text("optionalPayload", optional_payload.to_string())
        .part("file", file_part);

    let resp = build_client()
        .post(JOB_URL)
        .header("Authorization", format!("bearer {}", token))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("PP-OCRv6 提交识别任务失败: {}", e))?;

    let status = resp.status();
    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("PP-OCRv6 解析提交响应失败: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "PP-OCRv6 提交识别任务失败，状态码: {}, 响应: {}",
            status, json
        ));
    }

    json["data"]["jobId"]
        .as_str()
        .map(|job_id| job_id.to_string())
        .ok_or_else(|| "PP-OCRv6 响应缺少 jobId".to_string())
}

/// 轮询任务状态，完成后返回 jsonUrl
async fn poll_job(job_id: &str, token: &str) -> Result<String, String> {
    let url = format!("{}/{}", JOB_URL, job_id);
    let start = Instant::now();

    loop {
        let resp = build_client()
            .get(&url)
            .header("Authorization", format!("bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("PP-OCRv6 查询任务状态失败: {}", e))?;

        let json: Value = resp
            .json()
            .await
            .map_err(|e| format!("PP-OCRv6 解析任务状态失败: {}", e))?;

        let state = json["data"]["state"].as_str().unwrap_or("");

        match state {
            "done" => {
                return json["data"]["resultUrl"]["jsonUrl"]
                    .as_str()
                    .map(|url| url.to_string())
                    .ok_or_else(|| "PP-OCRv6 响应缺少 jsonUrl".to_string());
            }
            "failed" => {
                let error_msg = json["data"]["errorMsg"]
                    .as_str()
                    .unwrap_or("未知错误")
                    .to_string();
                return Err(format!("PP-OCRv6 识别失败: {}", error_msg));
            }
            "pending" | "running" => {
                if start.elapsed() > POLL_TIMEOUT {
                    return Err("PP-OCRv6 识别超时".to_string());
                }
                log::info!("[pp_ocr_service] job {} state: {}", job_id, state);
                tokio::time::sleep(POLL_INTERVAL).await;
            }
            _ => {
                return Err(format!("PP-OCRv6 未知任务状态: {}", state));
            }
        }
    }
}

/// 解析多边形坐标 [[x, y], [x, y], ...] 为 Point 列表
fn parse_poly(poly: &Value) -> Vec<Point> {
    poly.as_array()
        .map(|points| {
            points
                .iter()
                .filter_map(|p| {
                    let x = p.get(0).and_then(Value::as_f64)?;
                    let y = p.get(1).and_then(Value::as_f64)?;
                    Some(Point {
                        x: x.max(0.0) as u32,
                        y: y.max(0.0) as u32,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 解析单个 prunedResult 为 TextBlock 列表
fn parse_pruned_result(pruned: &Value) -> Result<Vec<TextBlock>, String> {
    let rec_texts = pruned["rec_texts"]
        .as_array()
        .ok_or_else(|| "PP-OCRv6 识别结果缺少 rec_texts".to_string())?;
    let rec_scores = pruned["rec_scores"].as_array();
    let dt_polys = pruned["dt_polys"].as_array();

    let mut text_blocks = Vec::with_capacity(rec_texts.len());
    for (index, text) in rec_texts.iter().enumerate() {
        let text = text.as_str().unwrap_or("").to_string();
        let text_score = rec_scores
            .and_then(|scores| scores.get(index))
            .and_then(Value::as_f64)
            .unwrap_or(0.0) as f32;
        let box_points = dt_polys
            .and_then(|polys| polys.get(index))
            .map(parse_poly)
            .unwrap_or_default();

        text_blocks.push(TextBlock {
            box_points,
            box_score: 0.0,
            angle_index: 0,
            angle_score: 0.0,
            text,
            text_score,
        });
    }

    Ok(text_blocks)
}

/// 下载并解析 JSONL 识别结果
async fn parse_jsonl(jsonl_url: &str) -> Result<Vec<TextBlock>, String> {
    let resp = build_client()
        .get(jsonl_url)
        .send()
        .await
        .map_err(|e| format!("PP-OCRv6 获取识别结果失败: {}", e))?;

    let text = resp
        .text()
        .await
        .map_err(|e| format!("PP-OCRv6 读取识别结果失败: {}", e))?;

    let mut text_blocks: Vec<TextBlock> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let json: Value = serde_json::from_str(line)
            .map_err(|e| format!("PP-OCRv6 解析识别结果失败: {}", e))?;

        if let Some(ocr_results) = json["result"]["ocrResults"].as_array() {
            for ocr_result in ocr_results {
                if let Some(pruned) = ocr_result.get("prunedResult") {
                    text_blocks.extend(parse_pruned_result(pruned)?);
                }
            }
        }
    }

    Ok(text_blocks)
}

/// 使用百度 AI Studio PP-OCRv6 云端服务识别图片
pub async fn detect(image_bytes: Vec<u8>, token: &str) -> Result<Vec<TextBlock>, String> {
    let job_id = submit_job(image_bytes, token).await?;
    log::info!("[pp_ocr_service] job submitted, jobId: {}", job_id);

    let jsonl_url = poll_job(&job_id, token).await?;

    parse_jsonl(&jsonl_url).await
}
