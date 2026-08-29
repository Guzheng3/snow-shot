import { useCallback, useContext, useEffect, useImperativeHandle, useRef, useState } from "react";
import { DrawStatePublisher } from "@/components/drawCore/extra";
import { AppSettingsPublisher } from "@/contexts/appSettingsActionContext";
import { useStateSubscriber } from "@/hooks/useStateSubscriber";
import {
	type AllOcrResult,
	type AppOcrResult,
	covertOcrResultToText,
	OcrResult,
	type OcrResultActionType,
	type OcrResultType,
} from "@/pages/fixedContent/components/ocrResult";
import { createOcrResultWindow } from "@/commands/core";
import { AppSettingsGroup, OcrDetectAfterAction } from "@/types/appSettings";
import type { OcrDetectResult } from "@/types/commands/ocr";
import type { ElementRect } from "@/types/commands/screenshot";
import { DrawState } from "@/types/draw";
import { writeTextToClipboard } from "@/utils/clipboard";
import { appError } from "@/utils/log";
import { ScreenshotType } from "@/utils/types";
import { zIndexs } from "@/utils/zIndex";
import {
	type CaptureBoundingBoxInfo,
	ScreenshotTypePublisher,
} from "../../extra";
import OcrTool, { isOcrTool } from "../drawToolbar/components/tools/ocrTool";

export type OcrBlocksSelectedText = {
	text: string;
};

export type OcrBlocksActionType = {
	init: (
		selectRect: ElementRect,
		captureBoundingBoxInfo: CaptureBoundingBoxInfo,
		canvas: HTMLCanvasElement,
		allOcrResult: AllOcrResult | undefined,
	) => Promise<void>;
	setEnable: (enable: boolean | ((enable: boolean) => boolean)) => void;
	getOcrResultAction: () => OcrResultActionType | undefined;
	getSelectedText: () => OcrBlocksSelectedText | undefined;
};

export const OcrBlocks: React.FC<{
	actionRef: React.RefObject<OcrBlocksActionType | undefined>;
	finishCapture: () => void;
}> = ({ actionRef, finishCapture }) => {
	const ocrResultActionRef = useRef<OcrResultActionType>(undefined);

	const [getScreenshotType] = useStateSubscriber(
		ScreenshotTypePublisher,
		undefined,
	);
	const [getAppSettings] = useStateSubscriber(AppSettingsPublisher, undefined);
	const [getDrawState] = useStateSubscriber(
		DrawStatePublisher,
		useCallback((drawState: DrawState) => {
			ocrResultActionRef.current?.setEnable(isOcrTool(drawState));
			ocrResultActionRef.current?.clear();
		}, []),
	);

	useImperativeHandle(
		actionRef,
		() => ({
			init: async (
				selectRect: ElementRect,
				captureBoundingBoxInfo: CaptureBoundingBoxInfo,
				canvas: HTMLCanvasElement,
				allOcrResult: AllOcrResult | undefined,
			) => {
				ocrResultActionRef.current?.init({
					selectRect,
					captureBoundingBoxInfo,
					canvas,
					allOcrResult,
				});
			},
			setEnable: (enable: boolean | ((enable: boolean) => boolean)) => {
				ocrResultActionRef.current?.setEnable(enable);
			},
			getOcrResultAction: () => {
				return ocrResultActionRef.current;
			},
			getSelectedText: () => {
				return ocrResultActionRef.current?.getSelectedText();
			},
		}),
		[],
	);

	const onOcrDetect = useCallback(
		(ocrResult: OcrDetectResult) => {
			// 判断是否是 OCR 工具
			if (!isOcrTool(getDrawState())) {
				return;
			}

			// 打开独立 OCR 结果窗口（关闭当前截图窗口）
			// 工具栏"翻译"按钮走 translate 模式（默认隐藏原文，展示译文）；OCR 按钮走 ocr 模式
			const mode =
				getDrawState() === DrawState.OcrTranslate ? "translate" : "ocr";
			createOcrResultWindow(ocrResult, mode)
				.then(() => {
					// 关闭截图窗口前执行正常清理流程：创建新的空闲 draw 窗口并重置截图状态，
					// 否则直接关闭窗口会导致热加载窗口池耗尽，下一次无法再次调用截图功能
					finishCapture();
				})
				.catch((error) => {
					appError(
						"[OcrBlocks.onOcrDetect] createOcrResultWindow error",
						error,
					);
				});

			// 只在 OCR 检测时启用 OCR 后操作,截图翻译时不启用
			if (getDrawState() === DrawState.OcrDetect) {
				const ocrAfterAction =
					getAppSettings()[AppSettingsGroup.FunctionScreenshot].ocrAfterAction;

				if (
					ocrAfterAction === OcrDetectAfterAction.CopyText ||
					(ocrAfterAction === OcrDetectAfterAction.OcrDetectCopyText &&
						getScreenshotType().type === ScreenshotType.OcrDetect)
				) {
					writeTextToClipboard(covertOcrResultToText(ocrResult));
				} else if (
					ocrAfterAction === OcrDetectAfterAction.CopyTextAndCloseWindow ||
					(ocrAfterAction ===
						OcrDetectAfterAction.OcrDetectCopyTextAndCloseWindow &&
						getScreenshotType().type === ScreenshotType.OcrDetect)
				) {
					writeTextToClipboard(covertOcrResultToText(ocrResult));
				}
			}
		},
		[finishCapture, getAppSettings, getDrawState, getScreenshotType],
	);

	const onTranslate = useCallback(() => {
		ocrResultActionRef.current?.startTranslate();
	}, []);

	const [currentOcrResult, setCurrentOcrResult] = useState<
		(AppOcrResult & { ocrResultType: OcrResultType }) | undefined
	>(undefined);
	const [ocrResult, setOcrResult] = useState<AppOcrResult | undefined>(
		undefined,
	);
	const [translatedOcrResult, setTranslatedOcrResult] = useState<
		AppOcrResult | undefined
	>(undefined);
	const [translateLoading, setTranslateLoading] = useState(false);
	const onSwitchOcrResult = useCallback((ocrResultType: OcrResultType) => {
		ocrResultActionRef.current?.switchOcrResult(ocrResultType);
	}, []);

	return (
		<>
			<OcrTool
				onSwitchOcrResult={onSwitchOcrResult}
				onTranslate={onTranslate}
				currentOcrResult={currentOcrResult}
				ocrResult={ocrResult}
				translatedOcrResult={translatedOcrResult}
				translateLoading={translateLoading}
			/>

			<OcrResult
				zIndex={zIndexs.Draw_OcrResult}
				actionRef={ocrResultActionRef}
				onOcrDetect={onOcrDetect}
				hideOcrTextBlocks
				onCurrentOcrResultChange={setCurrentOcrResult}
				onOcrResultChange={setOcrResult}
				onTranslatedResultChange={setTranslatedOcrResult}
				onTranslateLoading={setTranslateLoading}
			/>
		</>
	);
};
