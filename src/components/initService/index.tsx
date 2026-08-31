import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { App as AntdApp } from "antd";
import { initUiElements } from "@/commands";
import { getBuiltinOcrModelDir } from "@/commands/file";
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
					appSettings[AppSettingsGroup.SystemScreenshot].ocrHotStart !==
						prevAppSettings[AppSettingsGroup.SystemScreenshot].ocrHotStart ||
					appSettings[AppSettingsGroup.SystemScreenshot]
						.ocrModelWriteToMemory !==
						prevAppSettings[AppSettingsGroup.SystemScreenshot]
							.ocrModelWriteToMemory))
		) {
			try {
				const rapidOcrResourceDir = await getBuiltinOcrModelDir();
				// 同步云端 token（云端识别时鉴权使用）
				await ocrSetCloudToken(
					appSettings[AppSettingsGroup.FunctionOcr].ocrCloudToken,
				);
				ocrInit(
					rapidOcrResourceDir,
					appSettings[AppSettingsGroup.FunctionOcr].ocrModel,
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

	return null;
};
