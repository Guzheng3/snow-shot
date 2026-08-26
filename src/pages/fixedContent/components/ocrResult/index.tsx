import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { theme } from "antd";
import Color from "color";
import {
	useCallback,
	useContext,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { ocrDetect, ocrDetectWithSharedBuffer } from "@/commands/ocr";
import { createWebViewSharedBufferChannel } from "@/commands/webview";
import { PLUGIN_ID_RAPID_OCR } from "@/constants/pluginService";
import { AntdContext } from "@/contexts/antdContext";
import { AppSettingsPublisher } from "@/contexts/appSettingsActionContext";
import { usePluginServiceContext } from "@/contexts/pluginServiceContext";
import { useTranslationRequest } from "@/core/translations";
import { releaseOcrSession } from "@/functions/ocr";
import { useHotkeysApp } from "@/hooks/useHotkeysApp";
import { useStateRef } from "@/hooks/useStateRef";
import { useStateSubscriber } from "@/hooks/useStateSubscriber";
import type { OcrBlocksSelectedText } from "@/pages/draw/components/ocrBlocks";
import {
	type CaptureBoundingBoxInfo,
	ElementDraggingPublisher,
} from "@/pages/draw/extra";
import { AppSettingsGroup } from "@/types/appSettings";
import type { OcrDetectResult } from "@/types/commands/ocr";
import type { ElementRect } from "@/types/commands/screenshot";
import { writeTextToClipboard } from "@/utils/clipboard";
import { appError } from "@/utils/log";
import { getPlatformValue } from "@/utils/platform";
import { randomString } from "@/utils/random";
import { getWebViewSharedBuffer } from "@/utils/webview";
import {
	alignTranslatedBySourceProportion,
	getOcrResultIframeSrcDoc,
} from "./extra";

// 定义角度阈值常量（以度为单位）
const ROTATION_THRESHOLD = 3; // 小于3度的旋转被视为误差，不进行旋转

export type AppOcrResult = {
	result: OcrDetectResult;
	ignoreScale: boolean;
};

export type AllOcrResult = {
	ocrResult: AppOcrResult | undefined;
	translatedResult: AppOcrResult | undefined;
	currentOcrResultType: OcrResultType | undefined;
};

export type OcrResultInitDrawCanvasParams = {
	selectRect: ElementRect;
	canvas: HTMLCanvasElement;
	captureBoundingBoxInfo: CaptureBoundingBoxInfo;
	/** 已有的 OCR 结果 */
	allOcrResult: AllOcrResult | undefined;
};

export type OcrResultInitImageParams = {
	canvas: HTMLCanvasElement;
	monitorScaleFactor: number;
};

export type OcrResultActionType = {
	init: (
		params: OcrResultInitDrawCanvasParams | OcrResultInitImageParams,
	) => Promise<void>;
	setEnable: (enable: boolean | ((enable: boolean) => boolean)) => void;
	setScale: (scale: number) => void;
	clear: () => void;
	getOcrResult: () =>
		| (AppOcrResult & { ocrResultType: OcrResultType })
		| undefined;
	getAllOcrResult: () => AllOcrResult | undefined;
	getSelectedText: () => OcrBlocksSelectedText | undefined;
	startTranslate: () => void;
	switchOcrResult: (ocrResultType: OcrResultType) => void;
};

export const covertOcrResultToText = (ocrResult: OcrDetectResult) => {
	return ocrResult.text_blocks.map((block) => block.text).join("\n");
};

export enum OcrResultType {
	Ocr = "ocr",
	Translated = "translated",
}

export const OcrResult: React.FC<{
	zIndex: number;
	actionRef: React.RefObject<OcrResultActionType | undefined>;
	onOcrDetect?: (ocrResult: OcrDetectResult) => void;
	onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
	onWheel?: (event: React.WheelEvent<HTMLDivElement>) => void;
	enableCopy?: boolean;
	disabled?: boolean;
	onMouseDown?: (event: React.MouseEvent<HTMLDivElement>) => void;
	onMouseMove?: (event: React.MouseEvent<HTMLDivElement>) => void;
	onMouseUp?: (event: React.MouseEvent<HTMLDivElement>) => void;
	onCurrentOcrResultChange?: (
		ocrResult: (AppOcrResult & { ocrResultType: OcrResultType }) | undefined,
	) => void;
	onTranslatedResultChange?: (ocrResult: AppOcrResult | undefined) => void;
	onOcrResultChange?: (ocrResult: AppOcrResult | undefined) => void;
	style?: React.CSSProperties;
	onTranslateLoading?: (loading: boolean) => void;
}> = ({
	zIndex,
	actionRef,
	onOcrDetect,
	onContextMenu: onContextMenuProp,
	onWheel,
	enableCopy,
	disabled,
	onMouseDown,
	onMouseMove,
	onMouseUp,
	style,
	onTranslatedResultChange,
	onOcrResultChange,
	onCurrentOcrResultChange,
	onTranslateLoading,
}) => {
	const intl = useIntl();
	const { token } = theme.useToken();
	const { message } = useContext(AntdContext);

	const containerElementRef = useRef<HTMLDivElement>(null);
	const textContainerElementRef = useRef<HTMLDivElement>(null);
	const textIframeContainerElementWrapRef = useRef<HTMLDivElement>(null);
	const textIframeContainerElementRef = useRef<HTMLIFrameElement>(null);
	const [textContainerContent, setTextContainerContent] = useState("");

	const [getAppSettings] = useStateSubscriber(AppSettingsPublisher, undefined);

	const [currentOcrResult, setCurrentOcrResult, currentOcrResultRef] =
		useStateRef<(AppOcrResult & { ocrResultType: OcrResultType }) | undefined>(
			undefined,
		);

	const enableRef = useRef<boolean>(false);
	const setEnable = useCallback(
		(enable: boolean | ((enable: boolean) => boolean)) => {
			if (!containerElementRef.current) {
				return;
			}

			if (typeof enable === "function") {
				enableRef.current = enable(enableRef.current);
			} else {
				enableRef.current = enable;
			}

			if (enableRef.current) {
				containerElementRef.current.style.opacity = "1";
				containerElementRef.current.style.pointerEvents = "auto";
			} else {
				containerElementRef.current.style.opacity = "0";
				containerElementRef.current.style.pointerEvents = "none";
			}
		},
		[],
	);

	const selectRectRef = useRef<ElementRect>(undefined);
	const monitorScaleFactorRef = useRef<number>(undefined);
	const updateOcrTextElements = useCallback(
		async (
			ocrResult: OcrDetectResult,
			ignoreScale: boolean,
			ocrResultType: OcrResultType,
			options?: {
				ignoreResetValue?: boolean;
			},
		) => {
			const monitorScaleFactor = monitorScaleFactorRef.current;
			const selectRect = selectRectRef.current;

			if (!selectRect || !monitorScaleFactor) {
				return;
			}

			setCurrentOcrResult({
				result: ocrResult,
				ignoreScale: ignoreScale,
				ocrResultType: ocrResultType,
			});

			const transformScale = 1 / monitorScaleFactor;

			const baseX = selectRect.min_x * transformScale;
			const baseY = selectRect.min_y * transformScale;

			const textContainerElement = textContainerElementRef.current;
			const textIframeContainerWrapElement =
				textIframeContainerElementWrapRef.current;
			if (!textContainerElement || !textIframeContainerWrapElement) {
				return;
			}

			if (containerElementRef.current && !options?.ignoreResetValue) {
				containerElementRef.current.style.opacity = "0";
			}

			textContainerElement.innerHTML = "";

			textContainerElement.style.left =
				textIframeContainerWrapElement.style.left = `${baseX}px`;
			textContainerElement.style.top =
				textIframeContainerWrapElement.style.top = `${baseY}px`;
			textContainerElement.style.width =
				textIframeContainerWrapElement.style.width = `${(selectRect.max_x - selectRect.min_x) * transformScale}px`;
			textContainerElement.style.height =
				textIframeContainerWrapElement.style.height = `${(selectRect.max_y - selectRect.min_y) * transformScale}px`;

			await Promise.all(
				ocrResult.text_blocks.map(async (block) => {
					if (Number.isNaN(block.text_score) || block.text_score < 0.3) {
						return null;
					}

					const rectLeftTopX = block.box_points[0].x * transformScale;
					const rectLeftTopY = block.box_points[0].y * transformScale;
					const rectRightTopX = block.box_points[1].x * transformScale;
					const rectRightTopY = block.box_points[1].y * transformScale;
					const rectRightBottomX = block.box_points[2].x * transformScale;
					const rectRightBottomY = block.box_points[2].y * transformScale;
					const rectLeftBottomX = block.box_points[3].x * transformScale;
					const rectLeftBottomY = block.box_points[3].y * transformScale;

					// 计算矩形中心点
					const centerX =
						(rectLeftTopX +
							rectRightTopX +
							rectRightBottomX +
							rectLeftBottomX) /
						4;
					const centerY =
						(rectLeftTopY +
							rectRightTopY +
							rectRightBottomY +
							rectLeftBottomY) /
						4;

					// 计算矩形旋转角度 (使用顶边与水平线的夹角)
					const rotationRad = Math.atan2(
						rectRightTopY - rectLeftTopY,
						rectRightTopX - rectLeftTopX,
					);
					let rotationDeg = rotationRad * (180 / Math.PI);

					// 如果旋转角度小于阈值，则视为误差，不进行旋转
					if (Math.abs(rotationDeg) < ROTATION_THRESHOLD) {
						rotationDeg = 0;
					}

					// 计算宽度和高度
					const width = Math.sqrt(
						(rectRightTopX - rectLeftTopX) ** 2 +
							(rectRightTopY - rectLeftTopY) ** 2,
					);
					const height = Math.sqrt(
						(rectLeftBottomX - rectLeftTopX) ** 2 +
							(rectLeftBottomY - rectLeftTopY) ** 2,
					);

					const textElement = document.createElement("div");
					textElement.innerText = block.text;
					textElement.style.color = token.colorText;
					textElement.style.display = "inline-block";
					textElement.className = "ocr-result-text-element";

					const textWrapElement = document.createElement("div");
					const textBackgroundElement = document.createElement("div");
					textBackgroundElement.className =
						"ocr-result-text-background-element";
					textBackgroundElement.style.position =
						textWrapElement.style.position = "absolute";
					textBackgroundElement.style.width =
						textWrapElement.style.width = `${width}px`;
					textBackgroundElement.style.height =
						textWrapElement.style.height = `${height}px`;
					textBackgroundElement.style.transformOrigin =
						textWrapElement.style.transformOrigin = "center";

					textWrapElement.style.display = "flex";
					textWrapElement.style.alignItems = "center";
					textWrapElement.style.justifyContent = "center";
					textWrapElement.style.backgroundColor = "transparent";
					textWrapElement.style.zIndex = "1";

					textBackgroundElement.style.backgroundColor = Color(
						token.colorBgContainer,
					)
						.alpha(0.42)
						.toString();

					const isVertical = !ignoreScale && height > width * 1.5;
					if (isVertical) {
						textWrapElement.style.writingMode = "vertical-rl";
					}

					if (ignoreScale) {
						textElement.style.whiteSpace = "normal";
						textElement.style.fontSize = "16px";
						textElement.style.wordBreak = "break-all";
					} else {
						textElement.style.fontSize = "12px";
						textElement.style.whiteSpace = "nowrap";
						textWrapElement.style.textAlign = "center";
					}

					textElement.setAttribute("onmousedown", "event.stopPropagation();");
					textElement.style.cursor = "text";

					textWrapElement.appendChild(textElement);
					textContainerElement.appendChild(textBackgroundElement);
					textContainerElement.appendChild(textWrapElement);

					await new Promise((resolve) => {
						setTimeout(() => {
							let textWidth = textElement.clientWidth;
							let textHeight = textElement.clientHeight;
							if (isVertical) {
								textWidth -= 1;
							} else {
								textHeight -= 1;
							}

							const scale = Math.min(height / textHeight, width / textWidth);
							textElement.style.transform = `scale(${scale})`;
							const leftWidth = Math.max(0, width - textWidth * scale); // 文本的宽度可能小于 OCR 识别的宽度
							let letterSpaceWidth = 0;
							if (textElement.innerText.length > 1) {
								// letterSpace 对于每个字符都生效，行首也要加一个间距，所以 +1
								const letterSpaceCount = textElement.innerText.length + 1;
								letterSpaceWidth = leftWidth / letterSpaceCount / scale;
							}
							textElement.style.letterSpacing = `${letterSpaceWidth}px`;
							textElement.style.textIndent = `${letterSpaceWidth}px`;
							textBackgroundElement.style.transform =
								textWrapElement.style.transform = `translate(${centerX - width * 0.5}px, ${centerY - height * 0.5}px) rotate(${rotationDeg}deg)`;

							resolve(undefined);
						}, 17);
					});
				}),
			);
			setTextContainerContent(
				textContainerElement.innerHTML ? textContainerElement.innerHTML : " ", // 避免空字符串导致 iframe 内容为空
			);
			if (containerElementRef.current && enableRef.current) {
				containerElementRef.current.style.opacity = "1";
			}
		},
		[token.colorBgContainer, token.colorText, setCurrentOcrResult],
	);
	const setScale = useCallback((scale: number) => {
		if (
			!textContainerElementRef.current ||
			!textIframeContainerElementWrapRef.current
		) {
			return;
		}

		textContainerElementRef.current.style.transform = `scale(${scale / 100})`;
		textIframeContainerElementWrapRef.current.style.transform = `scale(${scale / 100})`;
	}, []);

	const ocrDetectWithSharedBufferAction = useCallback(
		async (
			canvas: HTMLCanvasElement,
			scaleFactor: number,
			detectAngle: boolean,
		): Promise<OcrDetectResult | undefined> => {
			const sharedBufferChannelId = `ocrDetectByCanvas:${Date.now()}:${randomString(8)}`;
			const getWebViewSharedBufferPromise = getWebViewSharedBuffer(
				sharedBufferChannelId,
			);

			const createResult = await createWebViewSharedBufferChannel(
				sharedBufferChannelId,
				canvas.width * canvas.height * 4 + 8, // 后 8 个字节写入宽高
			);
			if (!createResult) {
				return undefined;
			}

			const imageDataArray = canvas
				.getContext("2d")
				?.getImageData(0, 0, canvas.width, canvas.height);
			if (!imageDataArray) {
				appError("[ocrDetectByCanvas] imageDataArray is undefined");
				return undefined;
			}

			const reciveData = (await getWebViewSharedBufferPromise) as unknown as
				| SharedArrayBuffer
				| undefined;
			if (!reciveData) {
				appError("[ocrDetectByCanvas] reciveData is undefined");
				return undefined;
			}

			// 将 ImageData 写入 SharedArrayBuffer
			const sharedArray = new Uint8ClampedArray(reciveData);
			sharedArray.set(imageDataArray.data);

			// 将宽高以 u32 字节形式写入最后 8 个字节（使用 Uint32Array 更高效）
			const u32Array = new Uint32Array(
				reciveData,
				imageDataArray.data.length,
				2,
			);
			u32Array[0] = canvas.width;
			u32Array[1] = canvas.height;

			return ocrDetectWithSharedBuffer(
				sharedBufferChannelId,
				scaleFactor,
				detectAngle,
			);
		},
		[],
	);

	const ocrDetectByCanvas = useCallback(
		async (
			canvas: HTMLCanvasElement,
			scaleFactor: number,
			detectAngle: boolean,
		): Promise<OcrDetectResult | undefined> => {
			const ocrResultWithSharedBuffer = await ocrDetectWithSharedBufferAction(
				canvas,
				scaleFactor,
				detectAngle,
			);

			if (ocrResultWithSharedBuffer) {
				return ocrResultWithSharedBuffer;
			}

			const imageBlob = await new Promise<Blob | null>((resolve) => {
				canvas.toBlob(resolve, "image/png", 1);
			});

			if (!imageBlob) {
				return undefined;
			}

			const ocrResult = await ocrDetect(
				await imageBlob.arrayBuffer(),
				scaleFactor,
				detectAngle,
			);
			return ocrResult;
		},
		[ocrDetectWithSharedBufferAction],
	);

	/** 请求 ID，避免 OCR 检测中切换工具后仍然触发 OCR 结果 */
	const requestIdRef = useRef<number>(0);
	const { isReady } = usePluginServiceContext();

	const [ocrResult, setOcrResult, ocrResultRef] = useStateRef<
		AppOcrResult | undefined
	>(undefined);
	const [translatorOcrResult, setTranslatorOcrResult, translatorOcrResultRef] =
		useStateRef<AppOcrResult | undefined>(undefined);
	const initDrawCanvas = useCallback(
		async (params: OcrResultInitDrawCanvasParams) => {
			if (!isReady?.(PLUGIN_ID_RAPID_OCR)) {
				return;
			}

			setCurrentOcrResult(undefined);
			setOcrResult(undefined);
			setTranslatorOcrResult(undefined);

			requestIdRef.current++;
			const currentRequestId = requestIdRef.current;

			const { selectRect, canvas } = params;

			monitorScaleFactorRef.current = window.devicePixelRatio;

			let ocrResult:
				| {
						result: OcrDetectResult;
						ignoreScale: boolean;
				  }
				| undefined;

			if (params.allOcrResult) {
				selectRectRef.current = selectRect;
				setOcrResult(params.allOcrResult.ocrResult);
				setTranslatorOcrResult(params.allOcrResult.translatedResult);

				let targetOcrResult:
					| (AppOcrResult & { ocrResultType: OcrResultType })
					| undefined;
				switch (params.allOcrResult.currentOcrResultType) {
					case OcrResultType.Ocr:
						if (params.allOcrResult.ocrResult) {
							targetOcrResult = {
								...params.allOcrResult.ocrResult,
								ocrResultType: OcrResultType.Ocr,
							};
						}
						break;
					case OcrResultType.Translated:
						if (params.allOcrResult.translatedResult) {
							targetOcrResult = {
								...params.allOcrResult.translatedResult,
								ocrResultType: OcrResultType.Translated,
							};
						}
						break;
				}

				if (targetOcrResult) {
					updateOcrTextElements(
						targetOcrResult.result,
						targetOcrResult.ignoreScale,
						targetOcrResult.ocrResultType,
					);
					onOcrDetect?.(targetOcrResult.result);
				}

				return;
			} else {
				try {
					const tempOcrResult = await ocrDetectByCanvas(
						canvas,
						monitorScaleFactorRef.current,
						getAppSettings()[AppSettingsGroup.SystemScreenshot].ocrDetectAngle,
					);

					if (!tempOcrResult) {
						appError("[ocrDetectByCanvas] ocrDetectByCanvas failed");
						return;
					}

					ocrResult = {
						result: tempOcrResult,
						ignoreScale: false,
					};
				} finally {
					releaseOcrSession();
				}
			}

			// 如果请求 ID 不一致，说明 OCR 检测中切换工具了，不进行更新
			if (currentRequestId !== requestIdRef.current) {
				return;
			}

			selectRectRef.current = selectRect;
			setOcrResult({
				result: ocrResult.result,
				ignoreScale: ocrResult.ignoreScale,
			});
			updateOcrTextElements(
				ocrResult.result,
				ocrResult.ignoreScale,
				OcrResultType.Ocr,
			);
			onOcrDetect?.(ocrResult.result);
		},
		[
			isReady,
			onOcrDetect,
			updateOcrTextElements,
			ocrDetectByCanvas,
			setOcrResult,
			setTranslatorOcrResult,
			setCurrentOcrResult,
			getAppSettings,
		],
	);

	const initImage = useCallback(
		async (params: OcrResultInitImageParams) => {
			if (!isReady?.(PLUGIN_ID_RAPID_OCR)) {
				return;
			}

			setCurrentOcrResult(undefined);
			setOcrResult(undefined);
			setTranslatorOcrResult(undefined);
			const { canvas } = params;

			selectRectRef.current = {
				min_x: 0,
				min_y: 0,
				max_x: canvas.width,
				max_y: canvas.height,
			};
			monitorScaleFactorRef.current = params.monitorScaleFactor;

			let ocrResult: OcrDetectResult | undefined;
			try {
				ocrResult = await ocrDetectByCanvas(
					canvas,
					monitorScaleFactorRef.current,
					getAppSettings()[AppSettingsGroup.SystemScreenshot].ocrDetectAngle,
				);
			} finally {
				releaseOcrSession();
			}

			if (!ocrResult) {
				appError("[ocrDetectByCanvas] ocrDetectByCanvas failed");
				return;
			}

			setOcrResult({
				result: ocrResult,
				ignoreScale: false,
			});
			updateOcrTextElements(ocrResult, false, OcrResultType.Ocr);
			onOcrDetect?.(ocrResult);
		},
		[
			getAppSettings,
			isReady,
			onOcrDetect,
			updateOcrTextElements,
			ocrDetectByCanvas,
			setOcrResult,
			setTranslatorOcrResult,
			setCurrentOcrResult,
		],
	);

	const selectedTextRef = useRef<OcrBlocksSelectedText | undefined>(undefined);
	const getSelectedText = useCallback((): OcrBlocksSelectedText | undefined => {
		return {
			text:
				textIframeContainerElementRef.current?.contentWindow
					?.getSelection()
					?.toString()
					.trim() ?? "",
		};
	}, []);

	const menuRef = useRef<Menu>(undefined);
	const createContextMenu = useCallback(async () => {
		if (menuRef.current) {
			const closedMenu = menuRef.current;
			menuRef.current = undefined;
			closedMenu.close();
		}

		if (disabled) {
			return;
		}

		const appWindow = getCurrentWindow();
		const result = await Menu.new({
			items: [
				{
					id: `${appWindow.label}-copySelectedText`,
					text: intl.formatMessage({ id: "draw.copySelectedText" }),
					action: async () => {
						if (!selectedTextRef.current) {
							return;
						}

						writeTextToClipboard(selectedTextRef.current.text);
					},
				},
			],
		});
		menuRef.current = result;

		return result;
	}, [disabled, intl]);

	useEffect(() => {
		const appWindow = getCurrentWindow();
		const unlisten = appWindow.onCloseRequested(async () => {
			if (menuRef.current) {
				await Promise.all([menuRef.current.close()]);
			}
			menuRef.current = undefined;
		});

		return () => {
			unlisten.then((fn) => fn());
			if (menuRef.current) {
				menuRef.current.close();
			}
			menuRef.current = undefined;
		};
	}, []);

	useHotkeysApp(
		getPlatformValue("Ctrl+A", "Meta+A"),
		useCallback((event) => {
			if (!enableRef.current) {
				return;
			}

			event.preventDefault();

			const selection =
				textIframeContainerElementRef.current?.contentWindow?.getSelection();
			const targetElement =
				textIframeContainerElementRef.current?.contentDocument;
			if (containerElementRef.current && selection && targetElement) {
				textIframeContainerElementRef.current?.focus();
				const range = targetElement.createRange();
				range.selectNodeContents(targetElement.body);
				selection.removeAllRanges();
				selection.addRange(range);
			}
		}, []),
		useMemo(
			() => ({
				keyup: false,
				keydown: true,
				preventDefault: true,
			}),
			[],
		),
	);

	const onContextMenu = useCallback(() => {
		selectedTextRef.current = getSelectedText();
		if (selectedTextRef.current?.text.trim()) {
			createContextMenu().then((menu) => {
				menu?.popup();
			});
			return;
		}

		onContextMenuProp?.({
			preventDefault: () => {},
			stopPropagation: () => {},
			clientX: 0,
			clientY: 0,
		} as React.MouseEvent<HTMLDivElement>);
	}, [getSelectedText, onContextMenuProp, createContextMenu]);

	const onDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
		// 阻止截图双击复制和固定到屏幕双击缩放的操作
		e.preventDefault();
		e.stopPropagation();
	}, []);

	// 避免 iframe 影响元素拖拽
	const [isElementDragging, setIsElementDragging] = useState(false);
	useStateSubscriber(ElementDraggingPublisher, setIsElementDragging);

	useEffect(() => {
		if (disabled || isElementDragging) {
			return;
		}

		const handleMessage = (event: MessageEvent) => {
			const { type } = event.data;

			if (type === "contextMenu") {
				onContextMenu();
			} else if (type === "wheel") {
				const wheelEvent = {
					deltaY: event.data.eventData.deltaY,
					clientX: event.data.eventData.clientX,
					clientY: event.data.eventData.clientY,
					ctrlKey: event.data.eventData.ctrlKey,
					shiftKey: event.data.eventData.shiftKey,
					altKey: event.data.eventData.altKey,
				} as React.WheelEvent<HTMLDivElement>;
				onWheel?.(wheelEvent);
			} else if (type === "keydown" || type === "keyup") {
				// 创建并触发自定义键盘事件
				const keyEvent = new KeyboardEvent(type, {
					key: event.data.key,
					code: event.data.code,
					keyCode: event.data.keyCode,
					ctrlKey: event.data.ctrlKey,
					shiftKey: event.data.shiftKey,
					altKey: event.data.altKey,
					metaKey: event.data.metaKey,
					repeat: event.data.repeat,
					bubbles: true,
					cancelable: true,
				});
				document.dispatchEvent(keyEvent);
			} else if (type === "mousedown") {
				// 重新组装鼠标事件对象，模拟React.MouseEvent
				const mouseEvent = {
					clientX: event.data.clientX,
					clientY: event.data.clientY,
					button: event.data.button,
					buttons: event.data.buttons,
					ctrlKey: event.data.ctrlKey,
					shiftKey: event.data.shiftKey,
					altKey: event.data.altKey,
					metaKey: event.data.metaKey,
					preventDefault: () => {},
					stopPropagation: () => {},
				} as React.MouseEvent<HTMLDivElement>;
				onMouseDown?.(mouseEvent);
			} else if (type === "mousemove") {
				// 重新组装鼠标移动事件对象
				const mouseEvent = {
					clientX: event.data.clientX,
					clientY: event.data.clientY,
					button: event.data.button,
					buttons: event.data.buttons,
					ctrlKey: event.data.ctrlKey,
					shiftKey: event.data.shiftKey,
					altKey: event.data.altKey,
					metaKey: event.data.metaKey,
					preventDefault: () => {},
					stopPropagation: () => {},
				} as React.MouseEvent<HTMLDivElement>;
				onMouseMove?.(mouseEvent);
			} else if (type === "mouseup") {
				// 重新组装鼠标释放事件对象
				const mouseEvent = {
					clientX: event.data.clientX,
					clientY: event.data.clientY,
					button: event.data.button,
					buttons: event.data.buttons,
					ctrlKey: event.data.ctrlKey,
					shiftKey: event.data.shiftKey,
					altKey: event.data.altKey,
					metaKey: event.data.metaKey,
					preventDefault: () => {},
					stopPropagation: () => {},
				} as React.MouseEvent<HTMLDivElement>;
				onMouseUp?.(mouseEvent);
			}
		};

		window.addEventListener("message", handleMessage);

		return () => {
			window.removeEventListener("message", handleMessage);
		};
	}, [
		disabled,
		isElementDragging,
		onContextMenu,
		onMouseDown,
		onMouseMove,
		onMouseUp,
		onWheel,
	]);

	const handleContainerContextMenu = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			event.preventDefault();
			event.stopPropagation();
		},
		[],
	);

	const { requestTranslate } = useTranslationRequest(
		useMemo(() => {
			return {
				onComplete: (result, requestId) => {
					if (requestId !== requestIdRef.current || !ocrResultRef.current) {
						return;
					}

					const sourceTextList = ocrResultRef.current.result.text_blocks.map(
						(block) => block.text,
					);
					const translatedTextList = result.map((item) => item.content);
					let resultTextBlocks: string[] = [];
					if (
						sourceTextList.length > translatedTextList.length &&
						getAppSettings()[AppSettingsGroup.FunctionTranslation]
							.optimizeAiTranslationLayout
					) {
						resultTextBlocks = alignTranslatedBySourceProportion(
							sourceTextList,
							translatedTextList,
						);
					} else {
						resultTextBlocks = translatedTextList;
					}

					const translatorOcrResult: AppOcrResult = {
						ignoreScale: ocrResultRef.current.ignoreScale,
						result: {
							...ocrResultRef.current.result,
							text_blocks: ocrResultRef.current.result.text_blocks.map(
								(block, index) => ({
									...block,
									text: resultTextBlocks[index] ?? block.text,
								}),
							),
						},
					};

					setTranslatorOcrResult(translatorOcrResult);
					updateOcrTextElements(
						translatorOcrResult.result,
						translatorOcrResult.ignoreScale,
						OcrResultType.Translated,
					);
				},
				lazyLoad: true,
			};
		}, [
			setTranslatorOcrResult,
			ocrResultRef,
			updateOcrTextElements,
			getAppSettings,
		]),
	);

	const requestTranslateLoadingIdRef = useRef<number | undefined>(undefined);
	useImperativeHandle(
		actionRef,
		() => ({
			init: async (
				params: OcrResultInitDrawCanvasParams | OcrResultInitImageParams,
			) => {
				const hideLoading = message.loading(
					<FormattedMessage id="draw.ocrLoading" />,
					20,
				);

				if ("selectRect" in params) {
					await initDrawCanvas(params);
				} else if ("canvas" in params) {
					await initImage(params);
				}

				hideLoading();
			},
			setEnable,
			setScale,
			clear: () => {
				setTextContainerContent("");
				if (textContainerElementRef.current) {
					textContainerElementRef.current.innerHTML = "";
				}
			},
			getOcrResult: () => {
				return currentOcrResultRef.current;
			},
			getSelectedText,
			startTranslate: async () => {
				if (
					!ocrResultRef.current ||
					ocrResultRef.current.result.text_blocks.length === 0
				) {
					message.error(intl.formatMessage({ id: "draw.ocrResultEmpty" }));
					return;
				}

				if (
					requestTranslateLoadingIdRef.current &&
					requestTranslateLoadingIdRef.current === requestIdRef.current
				) {
					return;
				}

				setTranslatorOcrResult(undefined);

				requestTranslateLoadingIdRef.current = requestIdRef.current;
				const hideLoading = message.loading(
					intl.formatMessage({ id: "draw.ocrResult.translating" }),
					20,
				);
				onTranslateLoading?.(true);

				try {
					await requestTranslate(
						ocrResultRef.current.result.text_blocks.map((block) => block.text),
						requestIdRef.current,
					);
				} catch (error) {
					appError("[OcrResult.startTranslate] requestTranslate error", error);
					message.error(
						intl.formatMessage({ id: "draw.ocrResult.translateError" }),
					);
				}

				hideLoading();
				requestTranslateLoadingIdRef.current = undefined;
				onTranslateLoading?.(false);
			},
			switchOcrResult: (ocrResultType: OcrResultType) => {
				if (ocrResultType === OcrResultType.Ocr && ocrResultRef.current) {
					updateOcrTextElements(
						ocrResultRef.current.result,
						ocrResultRef.current.ignoreScale,
						OcrResultType.Ocr,
						{
							ignoreResetValue: true,
						},
					);
				} else if (
					ocrResultType === OcrResultType.Translated &&
					translatorOcrResultRef.current
				) {
					updateOcrTextElements(
						translatorOcrResultRef.current.result,
						translatorOcrResultRef.current.ignoreScale,
						OcrResultType.Translated,
						{
							ignoreResetValue: true,
						},
					);
				}
			},
			getAllOcrResult: () => {
				return {
					ocrResult: ocrResultRef.current,
					translatedResult: translatorOcrResultRef.current,
					currentOcrResultType: currentOcrResultRef.current?.ocrResultType,
				};
			},
		}),
		[
			getSelectedText,
			initDrawCanvas,
			initImage,
			message,
			setEnable,
			setScale,
			ocrResultRef,
			requestTranslate,
			setTranslatorOcrResult,
			intl,
			currentOcrResultRef,
			translatorOcrResultRef,
			updateOcrTextElements,
			onTranslateLoading,
		],
	);

	useEffect(() => {
		onOcrResultChange?.(ocrResult);
	}, [ocrResult, onOcrResultChange]);
	useEffect(() => {
		onTranslatedResultChange?.(translatorOcrResult);
	}, [translatorOcrResult, onTranslatedResultChange]);
	useEffect(() => {
		onCurrentOcrResultChange?.(currentOcrResult);
	}, [currentOcrResult, onCurrentOcrResultChange]);

	const enableDrag = !!(onMouseDown && onMouseMove && onMouseUp);

	return (
		<div
			style={{
				zIndex: zIndex,
				position: "fixed",
				top: 0,
				left: 0,
				width: "100%",
				height: "100%",
				...style,
			}}
			className="ocr-result-container"
			ref={containerElementRef}
			onContextMenu={handleContainerContextMenu}
			onWheel={onWheel}
			onMouseDown={onMouseDown}
		>
			<div
				ref={textContainerElementRef}
				style={{
					transformOrigin: "top left",
					position: "absolute",
					pointerEvents: "none",
				}}
				onDoubleClick={onDoubleClick}
				className="ocr-result-text-container"
			></div>
			<div
				className="ocr-result-text-iframe-container"
				ref={textIframeContainerElementWrapRef}
			>
				<iframe
				title="ocr-result-text-iframe"
				ref={textIframeContainerElementRef}
				style={{
					width: "100%",
					height: "100%",
					backgroundColor: "transparent",
				}}
				className="ocr-result-text-iframe"
				srcDoc={getOcrResultIframeSrcDoc(
					textContainerContent,
					currentOcrResult?.ocrResultType ?? OcrResultType.Ocr,
					enableDrag,
					enableCopy,
					token,
				)}
			/>
		</div>

			<style jsx>{`
                .ocr-result-text-iframe {
                    width: 100%;
                    height: 100%;
                    padding: 0;
                    margin: 0;
                    border: none;
                }

                :global(.ocr-result-text-background-element) {
                    backdrop-filter: blur(2.4px);
                }

                :global(.ocr-result-text-element) {
                    opacity: 0;
                }

                .ocr-result-text-iframe-container {
                    transform-origin: top left;
				    position: absolute;
				    user-select: none;
                }
            `}</style>
			<style jsx>{`
                .ocr-result-text-iframe-container {
                    pointer-events:
					${
						isElementDragging || disabled || !textContainerContent
							? "none"
							: "auto"
					};
                }
            `}</style>
		</div>
	);
};
