import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { App as AntdApp } from "antd";
import { listen } from "@tauri-apps/api/event";
import { initUiElements } from "@/commands";
import { installFont, isFontInstalled } from "@/commands/font";
import { AppSettingsActionContext } from "@/contexts/appSettingsActionContext";
import {
	autoStartDisable,
	autoStartEnable,
	setEnableProxy,
	setRunLog,
} from "@/commands/core";
import { hotLoadPageInit } from "@/commands/hotLoadPage";
import { ocrInit, ocrSetCloudToken } from "@/commands/ocr";
import { videoRecordInit } from "@/commands/videoRecord";
import { getBuiltinOcrModelDir } from "@/commands/file";
import { importOcrModelArchive } from "@/functions/ocrModel";
import { OcrModel } from "@/types/appSettings";
import {
	PLUGIN_ID_FFMPEG,
} from "@/constants/pluginService";
import { usePluginServiceContext } from "@/contexts/pluginServiceContext";
import { useAppSettingsLoad } from "@/hooks/useAppSettingsLoad";
import { type AppSettingsData, AppSettingsGroup } from "@/types/appSettings";
import { CaptureHistory } from "@/utils/captureHistory";
import { appWarn } from "@/utils/log";

export const InitService = () => {
	const { modal, message } = AntdApp.useApp();
	const { updateAppSettings } = useContext(AppSettingsActionContext);
	// 清除无效的截图历史
	const clearCaptureHistory = useCallback(
		async (appSettings: AppSettingsData) => {
			const captureHistory = new CaptureHistory();
			await captureHistory.init();
			await captureHistory.clearExpired(appSettings);
		},
		[],
	);

	const hasInitOcr = useRef(false);
	const hasClearedCaptureHistory = useRef(false);
	const hasInitAutoStart = useRef(false);
	const hasInitEnableProxy = useRef(false);
	const hasInitRunLog = useRef(false);
	const hasInitHotLoadPage = useRef(false);
	const hasInitFontCheck = useRef(false);

	const [appSettings, setAppSettings] = useState<AppSettingsData | undefined>(
		undefined,
	);
	const [prevAppSettings, setPrevAppSettings] = useState<
		AppSettingsData | undefined
	>(undefined);

	const { isReadyStatus, pluginConfigRef } = usePluginServiceContext();

	const checkFontInstall = useCallback(async () => {
		if (!appSettings || hasInitFontCheck.current) {
			return;
		}
		hasInitFontCheck.current = true;

		if (appSettings[AppSettingsGroup.Cache].fontInstallDeclined) {
			return;
		}

		try {
			const installed = await isFontInstalled();
			if (installed) {
				return;
			}

			modal.confirm({
				title: "安装内置字体",
				content:
					"检测到内置字体「Aa言念君子 温其如玉」尚未安装。是否立即安装？安装后可在文字工具中选择该字体。",
				okText: "立即安装",
				cancelText: "取消",
				onOk: async () => {
					try {
						await installFont();
						message.success("字体安装成功");
					} catch (e) {
						message.error(`字体安装失败: ${e}`);
					}
				},
				onCancel: () => {
					updateAppSettings((prev) => ({
						...prev,
						[AppSettingsGroup.Cache]: {
							...prev[AppSettingsGroup.Cache],
							fontInstallDeclined: true,
						},
					}));
				},
			});
		} catch (e) {
			// 检查失败静默处理
		}
	}, [appSettings, message, modal, updateAppSettings]);

	const initServices = useCallback(async () => {
		if (!appSettings) {
			return;
		}

		if (
			!hasInitOcr.current ||
			(prevAppSettings &&
				(appSettings[AppSettingsGroup.FunctionOcr].ocrModel !==
					prevAppSettings[AppSettingsGroup.FunctionOcr].ocrModel ||
					appSettings[AppSettingsGroup.FunctionOcr].ocrCloudToken !==
						prevAppSettings[AppSettingsGroup.FunctionOcr].ocrCloudToken ||
					appSettings[AppSettingsGroup.FunctionOcr].ocrModelDir !==
						prevAppSettings[AppSettingsGroup.FunctionOcr].ocrModelDir ||
					appSettings[AppSettingsGroup.SystemScreenshot].ocrHotStart !==
						prevAppSettings[AppSettingsGroup.SystemScreenshot].ocrHotStart ||
					appSettings[AppSettingsGroup.SystemScreenshot]
						.ocrModelWriteToMemory !==
						prevAppSettings[AppSettingsGroup.SystemScreenshot]
							.ocrModelWriteToMemory))
		) {
			try {
				// 内置版：模型目录来自随包资源；插件版：无内置资源时回落到用户导入的目录
				const builtinOcrModelDir = await getBuiltinOcrModelDir();
				const importedOcrModelDir =
					appSettings[AppSettingsGroup.FunctionOcr].ocrModelDir;
				const rapidOcrResourceDir =
					builtinOcrModelDir ?? importedOcrModelDir;

				// 插件版首次启动（无内置资源、未导入压缩包）时把默认的本地模型
				// 自动切换为云端，避免每次识别都走云端兜底
				let ocrModel = appSettings[AppSettingsGroup.FunctionOcr].ocrModel;
				if (
					!builtinOcrModelDir &&
					!importedOcrModelDir &&
					ocrModel === OcrModel.RapidOcrV5Server
				) {
					ocrModel = OcrModel.PaddleCloudV6;
					updateAppSettings(
						AppSettingsGroup.FunctionOcr,
						{ ocrModel },
						false,
						true,
						true,
						false,
					);
				}

				// 同步云端 token（云端识别时鉴权使用，留空由后端使用内置 token）
				await ocrSetCloudToken(
					appSettings[AppSettingsGroup.FunctionOcr].ocrCloudToken,
				);
				ocrInit(
					rapidOcrResourceDir,
					ocrModel,
					appSettings[AppSettingsGroup.SystemScreenshot].ocrHotStart,
					appSettings[AppSettingsGroup.SystemScreenshot].ocrModelWriteToMemory,
				);
				hasInitOcr.current = true;
			} catch (e) {
				appWarn(`[InitService] Failed to init OCR: ${e}`);
			}
		}

		if (!hasClearedCaptureHistory.current) {
			hasClearedCaptureHistory.current = true;

			clearCaptureHistory(appSettings);
		}

		if (
			!hasInitEnableProxy.current ||
			(prevAppSettings &&
				appSettings[AppSettingsGroup.SystemNetwork].enableProxy !==
					prevAppSettings[AppSettingsGroup.SystemNetwork].enableProxy)
		) {
			hasInitEnableProxy.current = true;

			setEnableProxy(appSettings[AppSettingsGroup.SystemNetwork].enableProxy);
		}

		if (
			process.env.NODE_ENV !== "development" &&
			(!hasInitAutoStart.current ||
				(prevAppSettings &&
					appSettings[AppSettingsGroup.SystemCommon].autoStart !==
						prevAppSettings[AppSettingsGroup.SystemCommon].autoStart))
		) {
			hasInitAutoStart.current = true;

			if (appSettings[AppSettingsGroup.SystemCommon].autoStart) {
				autoStartEnable();
			} else {
				autoStartDisable();
			}
		}

		if (
			!hasInitRunLog.current ||
			(prevAppSettings &&
				appSettings[AppSettingsGroup.SystemCommon].runLog !==
					prevAppSettings[AppSettingsGroup.SystemCommon].runLog)
		) {
			hasInitRunLog.current = true;

			setRunLog(appSettings[AppSettingsGroup.SystemCommon].runLog);
		}

		if (
			!hasInitHotLoadPage.current ||
			(prevAppSettings &&
				appSettings[AppSettingsGroup.SystemCore].hotLoadPageCount !==
					prevAppSettings[AppSettingsGroup.SystemCore].hotLoadPageCount)
		) {
			hasInitHotLoadPage.current = true;

			hotLoadPageInit(
				appSettings[AppSettingsGroup.SystemCore].hotLoadPageCount,
			);
		}
	}, [
		appSettings,
		checkFontInstall,
		clearCaptureHistory,
		pluginConfigRef,
		isReadyStatus,
		prevAppSettings,
	]);

	useAppSettingsLoad(
		useCallback((appSettings, prevAppSettings) => {
			setAppSettings(appSettings);
			setPrevAppSettings(prevAppSettings);
		}, []),
		true,
	);

	const inited = useRef(false);

	useEffect(() => {
		if (inited.current) {
			return;
		}
		inited.current = true;

		initUiElements();
	}, []);

	useEffect(() => {
		initServices();
	}, [initServices]);

	const hasInitVideoRecord = useRef(false);
	useEffect(() => {
		if (hasInitVideoRecord.current) {
			return;
		}

		if (isReadyStatus?.(PLUGIN_ID_FFMPEG)) {
			hasInitVideoRecord.current = true;

			if (pluginConfigRef.current) {
				pluginConfigRef.current
					.getPluginDirPath(PLUGIN_ID_FFMPEG)
					.then((ffmpegPluginDir) => {
						videoRecordInit(ffmpegPluginDir);
					});
			} else {
				appWarn("[InitService] pluginConfigRef.current is not set");
			}
		}
	}, [isReadyStatus, pluginConfigRef]);

	// 云端 OCR 失败且无本地模型（插件版未导入压缩包）时，后端广播该事件，提示用户导入本地模型包
	const hasInitOcrImportPrompt = useRef(false);
	useEffect(() => {
		if (hasInitOcrImportPrompt.current) {
			return;
		}
		hasInitOcrImportPrompt.current = true;

		let unlisten: (() => void) | undefined;
		listen("ocr:local-model-required", () => {
			modal.warning({
				title: "提示",
				content:
					"在线 OCR 不可用（网络异常或云端服务失败），且尚未导入本地 OCR 模型包。是否立即导入本地 OCR 模型？",
				okText: "去导入",
				cancelText: "取消",
				onOk: async () => {
					try {
						await importOcrModelArchive(updateAppSettings);
						message.success("OCR 模型导入成功");
					} catch (e) {
						message.error(`OCR 模型导入失败: ${e}`);
					}
				},
			});
		})
			.then((unlistenFn) => {
				unlisten = unlistenFn;
			})
			.catch((e) => {
				appWarn(
					`[InitService] listen ocr:local-model-required failed: ${e}`,
				);
			});

		return () => {
			unlisten?.();
		};
	}, [modal, message, updateAppSettings]);

	return null;
};
