import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { getCurrentMonitorInfo } from "@/commands/core";
import { getOcrResultState } from "@/commands/globalSate";
import { EventListenerContext } from "@/components/eventListener";
import { TextScaleFactorContextProvider } from "@/components/textScaleFactorContextProvider";
import type { OcrDetectResult } from "@/types/commands/ocr";
import { setWindowRect, showWindow } from "@/utils/window";
import OcrResultModal from "@/pages/draw/components/ocrResultModal";

export const OcrResultPage: React.FC = () => {
	const { addListener, removeListener } = useContext(EventListenerContext);

	const [ocrResult, setOcrResult] = useState<OcrDetectResult | undefined>(
		undefined,
	);
	const [mode, setMode] = useState<"ocr" | "translate">("ocr");
	const [open, setOpen] = useState(false);

	const initedRef = useRef(false);

	/** 定位窗口到鼠标所在显示器居中并显示 */
	const positionAndShowWindow = useCallback(async () => {
		const appWindow = getCurrentWindow();
		const monitorInfo = await getCurrentMonitorInfo();
		const scaleFactor = window.devicePixelRatio;

		// 基准逻辑像素尺寸，根据 DPI 自动缩放（PixPin 风格紧凑识别窗口）
		const logicalWidth = 480;
		const logicalHeight = 640;
		const windowWidth = Math.round(logicalWidth * scaleFactor);
		const windowHeight = Math.round(logicalHeight * scaleFactor);

		const windowX = Math.round(
			monitorInfo.monitor_x + monitorInfo.monitor_width / 2 - windowWidth / 2,
		);
		const windowY = Math.round(
			monitorInfo.monitor_y + monitorInfo.monitor_height / 2 - windowHeight / 2,
		);

		await setWindowRect(appWindow, {
			min_x: windowX,
			min_y: windowY,
			max_x: windowX + windowWidth,
			max_y: windowY + windowHeight,
		});
		// 设置最小窗口尺寸（逻辑像素）
		await appWindow.setMinSize(new LogicalSize(400, 500));
		await showWindow();
	}, []);

	/** 从全局状态拉取最新 OCR 结果并显示 */
	const loadOcrResult = useCallback(async () => {
		const state = await getOcrResultState();
		if (!state.ocrResultJson) {
			return;
		}

		let result: OcrDetectResult;
		try {
			result = JSON.parse(state.ocrResultJson) as OcrDetectResult;
		} catch {
			return;
		}

		setOcrResult(result);
		setMode(state.mode === "translate" ? "translate" : "ocr");
		setOpen(true);
		await positionAndShowWindow();
	}, [positionAndShowWindow]);

	// 首次挂载时拉取已有数据
	useEffect(() => {
		if (initedRef.current) {
			return;
		}

		initedRef.current = true;
		loadOcrResult();
	}, [loadOcrResult]);

	// 复用窗口时，收到新数据通知后重新拉取
	useEffect(() => {
		const listenerId = addListener("ocr-result-show", () => {
			loadOcrResult();
		});

		return () => {
			removeListener(listenerId);
		};
	}, [addListener, removeListener, loadOcrResult]);

	/** 关闭弹窗后销毁窗口，确保屏幕不留任何 Snow Shot 窗口 */
	const handleClose = useCallback(() => {
		setOpen(false);
		getCurrentWindow().close();
	}, []);

	return (
		<TextScaleFactorContextProvider>
			<OcrResultModal
				open={open}
				ocrResult={ocrResult}
				mode={mode}
				onClose={handleClose}
			/>
		</TextScaleFactorContextProvider>
	);
};

export default OcrResultPage;
