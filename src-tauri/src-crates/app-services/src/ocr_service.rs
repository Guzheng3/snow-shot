use std::path::{Path, PathBuf};

use num_cpus;
use ort::session::builder::SessionBuilder;
use paddle_ocr_rs::ocr_lite::OcrLite;
use serde::{Deserialize, Serialize};

pub struct OcrService {
    hot_start: bool,
    ocr_core: Option<OcrLite>,
    det_model: Option<(PathBuf, Option<Vec<u8>>)>,
    rec_model: Option<(PathBuf, Option<Vec<u8>>)>,
    cls_model: Option<(PathBuf, Option<Vec<u8>>)>,
    /// 识别模型的字符字典文件路径（PP-OCRv5 不内嵌 character 元数据，需外部字典）
    rec_keys_path: Option<PathBuf>,
    /// 当前选中的识别模型（本地/云端），供命令层决定走本地会话还是云端通道
    model: Option<OcrModel>,
    /// 云端 PaddleOCR 鉴权 token（由前端设置页填写）
    paddle_cloud_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Copy, PartialOrd, Serialize, Deserialize)]
pub enum OcrModel {
    RapidOcrV5Server,
    /// 云端 PaddleOCR v6 识别（不内置模型，需配置 token），此枚举值仅作标识，
    /// 实际识别由 tauri-commands/ocr 层的云端通道处理，不在这里初始化本地模型
    PaddleCloudV6,
}

impl OcrService {
    pub fn new() -> Self {
        Self {
            hot_start: false,
            ocr_core: None,
            det_model: None,
            rec_model: None,
            cls_model: None,
            rec_keys_path: None,
            model: None,
            paddle_cloud_token: None,
        }
    }

    async fn read_model_data(
        &self,
        det_path: &Path,
        cls_path: &Path,
        rec_path: &Path,
    ) -> Result<(Vec<u8>, Vec<u8>, Vec<u8>), String> {
        let (det_result, cls_result, rec_result) = tokio::join!(
            tokio::fs::read(det_path),
            tokio::fs::read(cls_path),
            tokio::fs::read(rec_path)
        );

        Ok((
            det_result.map_err(|e| {
                format!(
                    "[OcrService::read_model_data] Failed to read det model data: {}",
                    e
                )
            })?,
            cls_result.map_err(|e| {
                format!(
                    "[OcrService::read_model_data] Failed to read cls model data: {}",
                    e
                )
            })?,
            rec_result.map_err(|e| {
                format!(
                    "[OcrService::read_model_data] Failed to read rec model data: {}",
                    e
                )
            })?,
        ))
    }

    fn build_session(builder: SessionBuilder) -> Result<SessionBuilder, ort::Error> {
        let num_thread = num_cpus::get_physical();
        // inter 线程池负责 operator 间调度，保持为 1 可避免线程争抢；
        // intra 线程池负责 operator 内部并行，设为物理核数以充分利用算力
        Ok(builder
            .with_inter_threads(1)?
            .with_intra_threads(num_thread)?
            .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)?)
    }

    pub async fn init_session(&mut self) -> Result<(), String> {
        if self.det_model.is_none() || self.cls_model.is_none() || self.rec_model.is_none() {
            // 未加载本地 ONNX 模型时无需初始化会话
            return Ok(());
        }

        let ((det_path, det_model_data), (cls_path, cls_model_data), (rec_path, rec_model_data)) = (
            self.det_model
                .as_ref()
                .expect("[OcrService::init_ocr_core] Det model is not loaded"),
            self.cls_model
                .as_ref()
                .expect("[OcrService::init_ocr_core] Cls model is not loaded"),
            self.rec_model
                .as_ref()
                .expect("[OcrService::init_ocr_core] Rec model is not loaded"),
        );

        let mut ocr_core = OcrLite::new();

        if let (Some(det_model_data), Some(cls_model_data), Some(rec_model_data)) =
            (det_model_data, cls_model_data, rec_model_data)
        {
            ocr_core.init_models_from_memory_custom(
                det_model_data,
                cls_model_data,
                rec_model_data,
                Self::build_session,
            )
        } else {
            let (det_model_data, cls_model_data, rec_model_data) =
                self.read_model_data(det_path, cls_path, rec_path).await?;

            ocr_core.init_models_from_memory_custom(
                det_model_data.as_ref(),
                cls_model_data.as_ref(),
                rec_model_data.as_ref(),
                Self::build_session,
            )
        }
        .map_err(|e| format!("[OcrService::init_ocr_core] Failed to init models: {}", e))?;

        // PP-OCRv6 识别模型不内嵌 character 元数据，需通过外部字典文件指定字符表
        if let Some(rec_keys_path) = &self.rec_keys_path {
            ocr_core
                .init_rec_keys_from_path(
                    rec_keys_path
                        .to_str()
                        .ok_or("[OcrService::init_ocr_core] rec_keys_path is not valid UTF-8")?,
                )
                .map_err(|e| {
                    format!(
                        "[OcrService::init_ocr_core] Failed to init rec keys from {}, e: {}",
                        rec_keys_path.display(),
                        e
                    )
                })?;
        }

        self.ocr_core.replace(ocr_core);

        Ok(())
    }

    pub async fn init_models(
        &mut self,
        orc_plugin_path: PathBuf,
        model: OcrModel,
        hot_start: bool,
        ocr_model_write_to_memory: bool,
    ) -> Result<(), String> {
        log::info!(
            "[OcrService::init_models] orc_plugin_path: {:?}, model: {:?}, hot_start: {:?}, ocr_model_write_to_memory: {:?}",
            orc_plugin_path,
            model,
            hot_start,
            ocr_model_write_to_memory
        );

        // 加载模型到内存
        let (det_model_path, cls_model_path, rec_model_path) = match model {
            OcrModel::RapidOcrV5Server => (
                orc_plugin_path.join("ch_PP-OCRv5_server_det.onnx"),
                orc_plugin_path.join("ch_ppocr_mobile_v2.0_cls_mobile.onnx"),
                orc_plugin_path.join("ch_PP-OCRv5_rec_server.onnx"),
            ),
            // 云端 PaddleOCR v6 不内置模型，无需加载本地 ONNX，仅记录模型标识
            OcrModel::PaddleCloudV6 => {
                self.model = Some(model);
                self.det_model = None;
                self.cls_model = None;
                self.rec_model = None;
                self.rec_keys_path = None;
                self.ocr_core.take();
                return Ok(());
            }
        };

        let (det_model_config, cls_model_config, rec_model_config) = if ocr_model_write_to_memory {
            let (det_result, cls_result, rec_result) = self
                .read_model_data(&det_model_path, &cls_model_path, &rec_model_path)
                .await?;

            (
                Some((det_model_path, Some(det_result))),
                Some((cls_model_path, Some(cls_result))),
                Some((rec_model_path, Some(rec_result))),
            )
        } else {
            (
                Some((det_model_path, None)),
                Some((cls_model_path, None)),
                Some((rec_model_path, None)),
            )
        };

        self.det_model = det_model_config;
        self.cls_model = cls_model_config;
        self.rec_model = rec_model_config;
        self.rec_keys_path = Some(orc_plugin_path.join("ppocrv5_dict.txt"));
        self.hot_start = hot_start;
        self.model = Some(model);

        if self.hot_start {
            self.init_session().await?;
        } else {
            self.ocr_core.take();
        }

        Ok(())
    }

    /// 释放 onnx session，并初始化新的 session
    pub async fn release_session(&mut self) -> Result<(), String> {
        if self.hot_start {
            self.init_session().await?;
        } else {
            self.ocr_core.take();
        }

        Ok(())
    }

    pub async fn get_session(&mut self) -> Result<&mut OcrLite, String> {
        if self.ocr_core.is_none() {
            self.init_session().await?;
        }

        Ok(self.ocr_core.as_mut().unwrap())
    }

    /// 当前是否走云端 PaddleOCR 通道
    pub fn is_cloud(&self) -> bool {
        matches!(self.model, Some(OcrModel::PaddleCloudV6))
    }

    /// 记录云端鉴权 token
    pub fn set_cloud_token(&mut self, token: String) {
        self.paddle_cloud_token = Some(token);
    }

    /// 取云端鉴权 token
    pub fn cloud_token(&self) -> Option<&str> {
        self.paddle_cloud_token.as_deref()
    }
}
