use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use hmac::{Hmac, Mac};
use md5::{Digest, Md5};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

/// 微软翻译 X-MT-Signature 私钥
const MS_PRIVATE_KEY: &[u8] = &[
    0xa2, 0x29, 0x3a, 0x3d, 0xd0, 0xdd, 0x32, 0x73,
    0x97, 0x7a, 0x64, 0xdb, 0xc2, 0xf3, 0x27, 0xf5,
    0xd7, 0xbf, 0x87, 0xd9, 0x45, 0x9d, 0xf0, 0x5a,
    0x09, 0x66, 0xc6, 0x30, 0xc6, 0x6a, 0xaa, 0x84,
    0x9a, 0x41, 0xaa, 0x94, 0x3a, 0xa8, 0xd5, 0x1a,
    0x6e, 0x4d, 0xaa, 0xc9, 0xa3, 0x70, 0x12, 0x35,
    0xc7, 0xeb, 0x12, 0xf6, 0xe8, 0x23, 0x07, 0x9e,
    0x47, 0x10, 0x95, 0x91, 0x88, 0x55, 0xd8, 0x17,
];

/// 翻译引擎枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TranslateEngine {
    Microsoft,
    Transmart,
    ICibaTranslate,
    Yandex,
}

impl TranslateEngine {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Microsoft => "Microsoft",
            Self::Transmart => "Transmart",
            Self::ICibaTranslate => "ICiba Translate",
            Self::Yandex => "Yandex",
        }
    }

    pub fn default_order() -> Vec<TranslateEngine> {
        // 国内可直连的服务优先，境外（需代理）靠后
        vec![
            Self::Transmart,
            Self::ICibaTranslate,
            Self::Microsoft,
            Self::Yandex,
        ]
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslateRequest {
    pub text: String,
    pub source_lang: String,
    pub target_lang: String,
    pub engine: Option<TranslateEngine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslateResult {
    pub text: String,
    pub engine: String,
    pub success: bool,
    pub error: Option<String>,
}

pub struct TranslateService {
    client: Client,
}

impl TranslateService {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    pub async fn translate(
        &self,
        text: &str,
        source: &str,
        target: &str,
        engine_order: Option<&[TranslateEngine]>,
    ) -> TranslateResult {
        let engines: Vec<TranslateEngine> = match engine_order {
            Some(order) => order.to_vec(),
            None => TranslateEngine::default_order(),
        };

        for engine in &engines {
            let result = match engine {
                TranslateEngine::Microsoft => {
                    self.translate_microsoft(text, source, target).await
                }
                TranslateEngine::Transmart => {
                    self.translate_transmart(text, source, target).await
                }
                TranslateEngine::ICibaTranslate => {
                    self.translate_iciba_translate(text, source, target).await
                }
                TranslateEngine::Yandex => {
                    self.translate_yandex(text, source, target).await
                }
            };

            match result {
                Ok(translated) => {
                    return TranslateResult {
                        text: translated,
                        engine: engine.name().to_string(),
                        success: true,
                        error: None,
                    };
                }
                Err(e) => {
                    log::warn!("{} failed: {}", engine.name(), e);
                }
            }
        }

        TranslateResult {
            text: String::new(),
            engine: String::new(),
            success: false,
            error: Some("All translation engines failed".to_string()),
        }
    }

    // ==================== Microsoft ====================
    async fn translate_microsoft(
        &self,
        text: &str,
        source: &str,
        target: &str,
    ) -> Result<String, String> {
        let source = normalize_ms_lang(source);
        let target = normalize_ms_lang(target);

        let path = if source == "auto" || source.is_empty() {
            format!(
                "api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&to={}",
                target
            )
        } else {
            format!(
                "api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&from={}&to={}",
                source, target
            )
        };

        let signature = ms_signature(&path);

        let body = serde_json::json!([{ "Text": text }]);

        let resp = self
            .client
            .post(format!("https://{}", path))
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            .header("X-MT-Signature", &signature)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Microsoft request failed: {}", e))?;

        let json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Microsoft parse failed: {}", e))?;

        let text = json[0]["translations"][0]["text"]
            .as_str()
            .ok_or("Microsoft: unexpected response format")?;

        Ok(text.to_string())
    }

    // ==================== Transmart ====================
    async fn translate_transmart(
        &self,
        text: &str,
        source: &str,
        target: &str,
    ) -> Result<String, String> {
        let source = normalize_transmart_lang(source);
        let target = normalize_transmart_lang(target);

        let body = serde_json::json!({
            "header": {
                "fn": "auto_translation_block",
                "client_key": "browser-chrome-110.0.0-Mac OS-df4bd4c5-a65d-44b2-a40f-42f34f3535f2-1677486696487"
            },
            "type": "plain",
            "model_category": "normal",
            "source": {
                "lang": source,
                "text_block": text
            },
            "target": {
                "lang": target
            }
        });

        let resp = self
            .client
            .post("https://transmart.qq.com/api/imt")
            .header(
                "User-Agent",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            )
            .header("Referer", "https://yi.qq.com/zh-CN/index")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Transmart request failed: {}", e))?;

        let json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Transmart parse failed: {}", e))?;

        let translated = json["auto_translation"]
            .as_str()
            .ok_or("Transmart: unexpected response format")?;

        Ok(translated.to_string())
    }

    // ==================== ICiba Translate ====================
    async fn translate_iciba_translate(
        &self,
        text: &str,
        source: &str,
        target: &str,
    ) -> Result<String, String> {
        if text.trim().is_empty() {
            return Err("ICiba Translate: empty text".to_string());
        }

        let source = normalize_iciba_lang(source);
        let target = normalize_iciba_lang(target);

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis()
            .to_string();

        let path = "/dictionary/fy/batch";
        let signature = iciba_signature(path, &timestamp);

        let body = serde_json::json!({
            "from": source,
            "to": target,
            "textList": [text]
        });

        let url = format!(
            "https://dictionary.iciba.com/dictionary/fy/batch?client=6&key=1000006&timestamp={}&signature={}",
            timestamp, signature
        );

        let resp = self
            .client
            .post(&url)
            .header("Origin", "https://www.iciba.com")
            .header("Referer", "https://www.iciba.com/")
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("ICiba Translate request failed: {}", e))?;

        let json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("ICiba Translate parse failed: {}", e))?;

        let code = json["code"].as_i64().unwrap_or(-1);
        if code != 0 {
            let msg = json["msg"].as_str().unwrap_or("unknown");
            return Err(format!("ICiba Translate error {}: {}", code, msg));
        }

        let data = json["data"]
            .as_array()
            .ok_or("ICiba Translate: no data array")?;
        if data.is_empty() {
            return Err("ICiba Translate: data array empty".to_string());
        }

        let first = &data[0];
        let translated = if let Some(s) = first.as_str() {
            s.to_string()
        } else if let Some(obj) = first.as_object() {
            obj.get("out")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        } else {
            return Err("ICiba Translate: unexpected data format".to_string());
        };

        if translated.is_empty() {
            return Err("ICiba Translate: empty translation".to_string());
        }

        Ok(translated)
    }

    // ==================== Yandex ====================
    async fn translate_yandex(
        &self,
        text: &str,
        source: &str,
        target: &str,
    ) -> Result<String, String> {
        let source = normalize_yandex_lang(source);
        let target = normalize_yandex_lang(target);

        let ucid = Uuid::new_v4().to_string().replace('-', "");

        let lang = if source == "auto" || source.is_empty() {
            target.to_string()
        } else {
            format!("{}-{}", source, target)
        };

        let url = format!(
            "https://translate.yandex.net/api/v1/tr.json/translate?ucid={}&srv=android&format=text",
            ucid
        );

        let resp = self
            .client
            .post(&url)
            .header("User-Agent", "ru.yandex.translate/3.20.2024")
            .form(&[("text", text), ("lang", &lang)])
            .send()
            .await
            .map_err(|e| format!("Yandex request failed: {}", e))?;

        let json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Yandex parse failed: {}", e))?;

        let text_arr = json["text"]
            .as_array()
            .ok_or("Yandex: unexpected response format")?;

        let translated = text_arr
            .first()
            .and_then(|v| v.as_str())
            .ok_or("Yandex: no translation")?;

        Ok(translated.to_string())
    }
}

impl Default for TranslateService {
    fn default() -> Self {
        Self::new()
    }
}

// ==================== 签名函数 ====================

/// Microsoft X-MT-Signature
/// 算法: HMAC-SHA256(MSTranslatorAndroidApp + urlencode(path) + rfc1123_date + guid, private_key)
/// 输出: "MSTranslatorAndroidApp::{base64_hmac}::{date}::{guid}"
fn ms_signature(url: &str) -> String {
    let guid = Uuid::new_v4().to_string().replace('-', "").to_lowercase();
    let escaped_url = urlencoding::encode(url).to_lowercase();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let dt = chrono_lite(now);

    let raw = format!(
        "MSTranslatorAndroidApp{}{}{}",
        escaped_url, dt, guid
    )
    .to_lowercase();

    let mut mac = HmacSha256::new_from_slice(MS_PRIVATE_KEY).expect("HMAC key");
    mac.update(raw.as_bytes());
    let result = mac.finalize();
    let hash = BASE64.encode(result.into_bytes());

    format!("MSTranslatorAndroidApp::{}::{}::{}", hash, dt, guid)
}

/// 简单的 RFC 1123 日期格式 (无需 chrono 依赖)
fn chrono_lite(unix_secs: u64) -> String {
    // 从 UNIX 时间戳计算 RFC 1123 格式
    let days_since_epoch = unix_secs / 86400;
    let secs_in_day = unix_secs % 86400;

    // 1970-01-01 是周四
    let weekdays = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
    let months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];

    let weekday = weekdays[((days_since_epoch + 4) % 7) as usize];

    // 计算年/月/日 (简化版，适用于 2020-2100)
    let mut days = days_since_epoch as i64;
    let mut year = 1970i64;
    loop {
        let days_in_year = if is_leap(year) { 366 } else { 365 };
        if days < days_in_year {
            break;
        }
        days -= days_in_year;
        year += 1;
    }

    let month_days = if is_leap(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 0usize;
    for (i, &md) in month_days.iter().enumerate() {
        if days < md as i64 {
            month = i;
            break;
        }
        days -= md as i64;
    }

    let day = days + 1;
    let hours = secs_in_day / 3600;
    let mins = (secs_in_day % 3600) / 60;
    let secs = secs_in_day % 60;

    format!(
        "{}, {:02} {} {} {:02}:{:02}:{:02} GMT",
        weekday, day, months[month], year, hours, mins, secs
    )
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

/// ICiba 签名：MD5(path + sorted_query + salt)
fn iciba_signature(path: &str, timestamp: &str) -> String {
    let salt = "7ece94d9f9c202b0d2ec557dg4r9bc";
    let query = format!("client=6&key=1000006&timestamp={}", timestamp);
    let sign_str = format!("{}{}{}", path, query, salt);

    let mut hasher = Md5::new();
    hasher.update(sign_str.as_bytes());
    format!("{:x}", hasher.finalize())
}

// ==================== 语言标准化 ====================

fn normalize_ms_lang(lang: &str) -> &str {
    match lang {
        "zh-CN" | "zh" | "zh-Hans" => "zh-Hans",
        "zh-TW" | "zh-Hant" => "zh-Hant",
        "en" => "en",
        "ja" => "ja",
        "ko" => "ko",
        "fr" => "fr",
        "es" => "es",
        "ru" => "ru",
        "de" => "de",
        "it" => "it",
        "tr" => "tr",
        "pt" => "pt",
        "vi" => "vi",
        "id" => "id",
        "th" => "th",
        "ms" => "ms",
        "ar" => "ar",
        "auto" | "" => "auto",
        _ => "auto",
    }
}

fn normalize_transmart_lang(lang: &str) -> &str {
    match lang {
        "zh-CN" | "zh" | "zh-Hans" => "zh",
        "zh-TW" | "zh-Hant" => "zh-TW",
        "en" => "en",
        "ja" => "ja",
        "ko" => "ko",
        "fr" => "fr",
        "es" => "es",
        "ru" => "ru",
        "de" => "de",
        "it" => "it",
        "tr" => "tr",
        "pt" => "pt",
        "vi" => "vi",
        "id" => "id",
        "th" => "th",
        "ms" => "ms",
        "ar" => "ar",
        "auto" | "" => "auto",
        _ => "auto",
    }
}

fn normalize_iciba_lang(lang: &str) -> &str {
    match lang {
        "zh-CN" | "zh" | "zh-Hans" | "zh-Hant" | "zh-TW" => "zh",
        "en" => "en",
        "ja" => "ja",
        "ko" => "ko",
        "fr" => "fr",
        "es" => "es",
        "ru" => "ru",
        "de" => "de",
        "it" => "it",
        "tr" => "tr",
        "pt" => "pt",
        "vi" => "vi",
        "id" => "id",
        "th" => "th",
        "ms" => "ms",
        "ar" => "ar",
        "hi" => "hi",
        "auto" | "" => "auto",
        _ => "auto",
    }
}

fn normalize_yandex_lang(lang: &str) -> &str {
    match lang {
        "zh-CN" | "zh" | "zh-Hans" | "zh-Hant" | "zh-TW" => "zh",
        "en" => "en",
        "ja" => "ja",
        "ko" => "ko",
        "fr" => "fr",
        "es" => "es",
        "ru" => "ru",
        "de" => "de",
        "it" => "it",
        "tr" => "tr",
        "pt" => "pt",
        "vi" => "vi",
        "id" => "id",
        "th" => "th",
        "ms" => "ms",
        "ar" => "ar",
        "hi" => "hi",
        "auto" | "" => "auto",
        _ => "auto",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_iciba_signature() {
        let sig = iciba_signature("/dictionary/fy/batch", "1234567890");
        assert_eq!(sig.len(), 32);
    }

    #[test]
    fn test_ms_signature_format() {
        let sig = ms_signature("api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&to=zh-Hans");
        assert!(sig.starts_with("MSTranslatorAndroidApp::"));
        assert!(sig.contains("::GMT::"));
    }

    #[test]
    fn test_chrono_lite() {
        // 2024-01-01 00:00:00 UTC = 1704067200
        let dt = chrono_lite(1704067200);
        assert_eq!(dt, "Mon, 01 Jan 2024 00:00:00 GMT");
    }
}