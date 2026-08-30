import {
	CloseOutlined,
	CopyOutlined,
	ExportOutlined,
	LinkOutlined,
	MailOutlined,
	MinusOutlined,
	MobileOutlined,
	PushpinOutlined,
	QqOutlined,
} from "@ant-design/icons";
import { Select } from "antd";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { useIntl } from "react-intl";
import { getCurrentMonitorInfo } from "@/commands/core";
import { AntdContext } from "@/contexts/antdContext";
import { useTranslationRequest } from "@/core/translations";
import { useLanguageOptions } from "@/components/translator";
import { useAppSettingsLoad } from "@/hooks/useAppSettingsLoad";
import { AppSettingsGroup, type AppSettingsData } from "@/types/appSettings";
import type { OcrDetectResult } from "@/types/commands/ocr";
import { writeTextToClipboard } from "@/utils/clipboard";
import { setWindowRect } from "@/utils/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { alignTranslatedBySourceProportion } from "@/pages/fixedContent/components/ocrResult/extra";
import styles from "./index.module.css";

/** 已选语言（auto / en / zh-CHS 等）映射为展示标签 */
const languageLabel = (code: string, intl: ReturnType<typeof useIntl>) => {
	if (code === "auto") {
		return intl.formatMessage({ id: "tools.translation.language.auto" });
	}
	if (code === "zh-CHS") {
		return intl.formatMessage({
			id: "tools.translation.language.simplifiedChinese",
		});
	}
	if (code === "zh-CHT") {
		return intl.formatMessage({
			id: "tools.translation.language.traditionalChinese",
		});
	}
	if (code === "en") {
		return intl.formatMessage({ id: "tools.translation.language.english" });
	}
	return code;
};

/** Tauri v2 ResizeDirection 枚举值 */
const RESIZE_DIRECTIONS = {
	top: "North",
	bottom: "South",
	left: "West",
	right: "East",
	topLeft: "NorthWest",
	topRight: "NorthEast",
	bottomLeft: "SouthWest",
	bottomRight: "SouthEast",
} as const;

type ResizeDirection = keyof typeof RESIZE_DIRECTIONS;

/**
 * 无边框窗口的拖拽调整大小边框
 * 利用 Tauri v2 原生 startResizeDragging 实现，四边 + 四角共 8 个拖拽热区
 * - borderEnabled=false: 不显示常驻边界线（仅保留热区的 hover 高亮）
 * - borderColor/borderWidth: 常驻边界线样式（通过 box-shadow inset 注入容器）
 */
const ResizeBorder: React.FC<{
	borderEnabled: boolean;
	borderColor: string;
	borderWidth: number;
}> = ({ borderEnabled, borderColor, borderWidth }) => {
	const handleResizeMouseDown = useCallback(
		(e: React.MouseEvent, direction: ResizeDirection) => {
			e.preventDefault();
			e.stopPropagation();
			const win = getCurrentWindow() as unknown as {
				startResizeDragging: (dir: string) => Promise<void>;
			};
			win.startResizeDragging(RESIZE_DIRECTIONS[direction]).catch((err: unknown) => {
				console.warn("[ResizeBorder] startResizeDragging failed:", err);
			});
		},
		[],
	);

	// box-shadow inset 注入四边；width=0 时不渲染常驻线但保留热区
	const borderStyle: React.CSSProperties =
		borderEnabled && borderWidth > 0
			? {
					boxShadow: `inset 0 0 0 ${borderWidth}px ${borderColor}`,
				}
			: {};

	return (
		<div className={styles.resizeBorder} style={borderStyle}>
			<div
				className={styles.resizeTop}
				onMouseDown={(e) => handleResizeMouseDown(e, "top")}
			/>
			<div
				className={styles.resizeBottom}
				onMouseDown={(e) => handleResizeMouseDown(e, "bottom")}
			/>
			<div
				className={styles.resizeLeft}
				onMouseDown={(e) => handleResizeMouseDown(e, "left")}
			/>
			<div
				className={styles.resizeRight}
				onMouseDown={(e) => handleResizeMouseDown(e, "right")}
			/>
			<div
				className={styles.resizeTopLeft}
				onMouseDown={(e) => handleResizeMouseDown(e, "topLeft")}
			/>
			<div
				className={styles.resizeTopRight}
				onMouseDown={(e) => handleResizeMouseDown(e, "topRight")}
			/>
			<div
				className={styles.resizeBottomLeft}
				onMouseDown={(e) => handleResizeMouseDown(e, "bottomLeft")}
			/>
			<div
				className={styles.resizeBottomRight}
				onMouseDown={(e) => handleResizeMouseDown(e, "bottomRight")}
			/>
		</div>
	);
};

type LayoutType = "original" | "semantic";

type ExtractedLinks = {
	urls: string[];
	emails: string[];
	phones: string[];
	qqs: string[];
};

/**
 * 原图格式排版：按识别顺序，每个文本块一行
 */
const originalLayout = (result: OcrDetectResult): string => {
	return result.text_blocks.map((block) => block.text).join("\n");
};

/**
 * 语义智能排版：按文本块几何位置聚类成行与段落
 * - 同一水平线的文本块合并为一行（按 x 排序，空格连接）
 * - 行间距较大的行之间用空行分隔，形成段落
 */
const semanticLayout = (result: OcrDetectResult): string => {
	const blocks = result.text_blocks;
	if (blocks.length === 0) {
		return "";
	}

	type LineItem = {
		text: string;
		cx: number;
		cy: number;
		minY: number;
		maxY: number;
		height: number;
	};

	const items: LineItem[] = blocks.map((block) => {
		const ys = block.box_points.map((p) => p.y);
		const xs = block.box_points.map((p) => p.x);
		return {
			text: block.text,
			cx: xs.reduce((a, c) => a + c, 0) / xs.length,
			cy: ys.reduce((a, c) => a + c, 0) / ys.length,
			minY: Math.min(...ys),
			maxY: Math.max(...ys),
			height: Math.max(...ys) - Math.min(...ys),
		};
	});

	// 按中心 y 排序
	items.sort((a, b) => a.cy - b.cy);

	// 聚类成行：与上一行中心 y 差距小于行高 → 同一行
	const lines: LineItem[][] = [];
	for (const item of items) {
		const lastLine = lines[lines.length - 1];
		if (lastLine && lastLine.length > 0) {
			const lastItem = lastLine[lastLine.length - 1];
			const avgHeight = lastItem.height || 1;
			if (item.cy - lastItem.cy < avgHeight * 0.8) {
				lastLine.push(item);
				continue;
			}
		}
		lines.push([item]);
	}

	// 每行内按 x 排序，拼接行文本
	const lineTexts = lines.map((line) => {
		line.sort((a, b) => a.cx - b.cx);
		return line.map((item) => item.text).join(" ");
	});

	// 段落：相邻行 y 间隙大于 1.5 倍行高 → 换段落（空行分隔）
	const paragraphs: string[][] = [];
	let prevBottom = -Infinity;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineTop = Math.min(...line.map((it) => it.minY));
		const lineBottom = Math.max(...line.map((it) => it.maxY));
		const avgHeight =
			line.reduce((a, it) => a + it.height, 0) / line.length || 1;
		if (i > 0 && lineTop - prevBottom > avgHeight * 1.5) {
			paragraphs.push([]);
		}
		if (paragraphs.length === 0) {
			paragraphs.push([]);
		}
		paragraphs[paragraphs.length - 1].push(lineTexts[i]);
		prevBottom = lineBottom;
	}

	// 语义合并：段落内，行尾无句末标点且下一行非段落开头 → 合并为一句（去掉换行）
	// 中文直接拼接；相邻英文/数字用空格分隔
	const sentenceEndPattern = /[。！？!?…；;：:"“”''）)】》」』]$/;
	const paragraphStartPattern =
		/^[（(【\[《“"「『]|^[0-9一二三四五六七八九十]+[、.．]|^[A-Za-z0-9#*•·-]/;

	const mergeParagraph = (lines: string[]): string => {
		const merged: string[] = [];
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			if (merged.length === 0) {
				merged.push(trimmed);
				continue;
			}
			const prev = merged[merged.length - 1];
			const prevEndsSentence = sentenceEndPattern.test(prev);
			const currStartsParagraph = paragraphStartPattern.test(trimmed);
			if (!prevEndsSentence && !currStartsParagraph) {
				// 合并为一句（去掉换行）
				const prevLastChar = prev[prev.length - 1];
				const currFirstChar = trimmed[0];
				const needSpace =
					/[A-Za-z0-9]/.test(prevLastChar) &&
					/[A-Za-z0-9]/.test(currFirstChar);
				merged[merged.length - 1] =
					prev + (needSpace ? " " : "") + trimmed;
			} else {
				merged.push(trimmed);
			}
		}
		return merged.join("\n");
	};

	return paragraphs.map(mergeParagraph).join("\n\n");
};

/**
 * 从文本中提取链接与邮箱（去重、去尾部标点）
 */
const extractLinks = (text: string): ExtractedLinks => {
	const urlSet = new Set<string>();
	const emailSet = new Set<string>();

	// URL：http(s):// 或 www. 开头，直到空白/引号/尖括号
	const urlPattern = /(?:https?:\/\/|www\.)[^\s<>"'“”‘’]+/gi;
	let m: RegExpExecArray | null;
	let cleaned = text;
	while ((m = urlPattern.exec(text)) !== null) {
		let url = m[0];
		// 去掉尾部常见标点（. , ; : ！？)】]）等）
		url = url.replace(/[.,;:!?。，；：！？）)】】》》」』"'“”‘’]+$/, "");
		if (url) {
			urlSet.add(url);
		}
		// 挖掉 URL（含认证段），避免其内部被误当邮箱
		cleaned = cleaned.replace(m[0], " ");
	}

	// 邮箱（在挖掉 URL 后的文本中提取）
	const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
	while ((m = emailPattern.exec(cleaned)) !== null) {
		emailSet.add(m[0]);
		// 挖掉邮箱，避免其内部被误当手机号/QQ
		cleaned = cleaned.replace(m[0], " ");
	}

	const phoneSet = new Set<string>();
	const qqSet = new Set<string>();

	// 手机号：1[3-9] 开头 11 位（中国大陆）
	const phonePattern = /(?<![0-9])1[3-9][0-9]{9}(?![0-9])/g;
	while ((m = phonePattern.exec(cleaned)) !== null) {
		phoneSet.add(m[0]);
		cleaned = cleaned.replace(m[0], " ");
	}

	// QQ 号：5-11 位独立数字段（排除手机号、排除 0 开头、排除长数字内截取）
	const qqPattern = /(?<![0-9])([1-9][0-9]{4,10})(?![0-9])/g;
	while ((m = qqPattern.exec(cleaned)) !== null) {
		const num = m[1];
		// 11 位且 1[3-9] 开头 = 手机号，跳过
		if (num.length === 11 && /^1[3-9]/.test(num)) continue;
		qqSet.add(num);
	}

	return { urls: [...urlSet], emails: [...emailSet], phones: [...phoneSet], qqs: [...qqSet] };
};

/**
 * 打开链接（www. 开头补 https://）
 */
const openLink = (url: string) => {
	const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
	openUrl(normalized);
};

const ICONS: Record<
	"urls" | "emails" | "phones" | "qqs",
	{ icon: ReactNode; label: string; type: "链接" | "邮箱" | "手机号" | "QQ 号" }
> = {
	urls: { icon: <LinkOutlined />, label: "链接", type: "链接" },
	emails: { icon: <MailOutlined />, label: "邮箱", type: "邮箱" },
	phones: { icon: <MobileOutlined />, label: "手机", type: "手机号" },
	qqs: { icon: <QqOutlined />, label: "QQ", type: "QQ 号" },
};

const ITEM_ORDER: ("urls" | "emails" | "phones" | "qqs")[] = [
	"urls",
	"emails",
	"phones",
	"qqs",
];

export const OcrResultModal: React.FC<{
	open: boolean;
	ocrResult: OcrDetectResult | undefined;
	/** ocr —— 纯识别（默认展示原文）；translate —— 工具栏翻译（默认只展示译文，可打开原文对照） */
	mode?: "ocr" | "translate";
	onClose: () => void;
}> = ({ open, ocrResult, mode = "ocr", onClose }) => {
	const intl = useIntl();
	const { targetLanguageOptions } = useLanguageOptions();
	const { message } = useContext(AntdContext);
	const isTranslateMode = mode === "translate";
	const [layoutType, setLayoutType] = useState<LayoutType>("original");
	const [editableText, setEditableText] = useState("");
	const [copying, setCopying] = useState(false);
	const [extracted, setExtracted] = useState<ExtractedLinks>({
		urls: [],
		emails: [],
		phones: [],
		qqs: [],
	});
	const [copiedItem, setCopiedItem] = useState("");
	const [translateOpen, setTranslateOpen] = useState(false);
	const [translatedText, setTranslatedText] = useState("");
	// 翻译模式下默认隐藏原文，展示译文；可通过"原文对照"打开
	const [showOcrText, setShowOcrText] = useState(!isTranslateMode);
	// 原文/译文对照模式：当前激活的行索引（点击对应展示）
	const [activePair, setActivePair] = useState(-1);
	const autoTranslatedTextRef = useRef<string | undefined>(undefined);
	const sourceCompareRootRef = useRef<HTMLDivElement | null>(null);
	const translateCompareRootRef = useRef<HTMLDivElement | null>(null);

	// 每次 OCR 结果变化时，重置为语义智能排版（按几何位置聚类行与段落，更贴近阅读顺序）
	useEffect(() => {
		if (open && ocrResult) {
			setLayoutType("semantic");
			setEditableText(semanticLayout(ocrResult));
			// 翻译模式下默认隐藏原文
			setShowOcrText(!isTranslateMode);
			setTranslatedText("");
			setActivePair(-1);
			setTranslateOpen(false);
		}
	}, [open, ocrResult, isTranslateMode]);

	// 编辑内容变化 → 实时重新提取链接/邮箱（编辑后成为链接也会自动显示）
	useEffect(() => {
		setExtracted(extractLinks(editableText));
		setCopiedItem("");
	}, [editableText]);

	const { requestTranslate, startTranslateLoading, targetLanguage, updateTargetLanguage } =
		useTranslationRequest({
			onComplete: useCallback((result) => {
				setTranslatedText(result.map((r) => r.content).join("\n"));
			}, []),
		});

	// 翻译模式下，打开窗口即自动翻译（与工具栏"翻译"走同一套 requestTranslate/翻译引擎）
	useEffect(() => {
		if (isTranslateMode && open && editableText) {
			if (autoTranslatedTextRef.current !== editableText) {
				autoTranslatedTextRef.current = editableText;
				requestTranslate(editableText.split("\n"));
			}
		}
	}, [isTranslateMode, open, editableText, requestTranslate]);

	// 原文/译文逐行对照的源数据：源文本按行，译文按源文本长度占比切分对齐
	const sourceLines = useMemo(() => editableText.split("\n"), [editableText]);
	const translatedSegments = useMemo(
		() =>
			translatedText
				? alignTranslatedBySourceProportion(
						sourceLines,
						translatedText.split("\n"),
					)
				: [],
		[translatedText, sourceLines],
	);

	const toggleOcrText = useCallback(() => {
		setActivePair(-1);
		setShowOcrText((prev) => !prev);
	}, []);

	// 点击原文/译文某一行，在另一列滚动到对应行并高亮（对应显示）
	const onPairClick = useCallback(
		(index: number, from: "source" | "translate") => {
			setActivePair((prev) => (prev === index ? -1 : index));
			const targetRoot =
				from === "source"
					? translateCompareRootRef.current
					: sourceCompareRootRef.current;
			targetRoot
				?.querySelector<HTMLElement>(`[data-pair="${index}"]`)
				?.scrollIntoView({ block: "nearest" });
		},
		[],
	);

	const sourceLanguage = useMemo(
		() => ocrResult?.lang ?? "auto",
		[ocrResult],
	);

	const onToggleTranslate = useCallback(() => {
		setTranslateOpen((prev) => {
			const next = !prev;
			if (next && editableText) {
				requestTranslate(editableText.split("\n"));
			}
			return next;
		});
	}, [editableText, requestTranslate]);

	// 切换目标语言：持久化后立即按新语言重新翻译（若已有可翻译原文）
	const handleTargetLanguageChange = useCallback(
		(value: string) => {
			updateTargetLanguage(value);
			if (editableText) {
				requestTranslate(editableText.split("\n"));
			}
		},
		[updateTargetLanguage, editableText, requestTranslate],
	);

	const handleLayoutChange = (type: LayoutType) => {
		setLayoutType(type);
		if (ocrResult) {
			setEditableText(
				type === "original"
					? originalLayout(ocrResult)
					: semanticLayout(ocrResult),
			);
		}
	};

	const handleCopy = async () => {
		if (!editableText) {
			return;
		}
		setCopying(true);
		try {
			await writeTextToClipboard(editableText);
			message.success("已复制到剪贴板");
		} catch {
			message.error("复制失败");
		} finally {
			setCopying(false);
		}
	};

	const handleCopyTranslated = useCallback(async () => {
		if (!translatedText) {
			return;
		}
		try {
			await writeTextToClipboard(translatedText);
			message.success("翻译已复制到剪贴板");
		} catch {
			message.error("复制失败");
		}
	}, [translatedText, message]);

	const handleCopyItem = async (
		value: string,
		type: "链接" | "邮箱" | "手机号" | "QQ 号",
	) => {
		try {
			await writeTextToClipboard(value);
			setCopiedItem(value);
			message.success(`${type}已复制`);
		} catch {
			message.error("复制失败");
		}
	};

	const handleItemClick = (
		key: "urls" | "emails" | "phones" | "qqs",
		value: string,
	) => {
		if (key === "urls") {
			openLink(value);
		} else {
			handleCopyItem(value, ICONS[key].type);
		}
	};

	const minWindow = useCallback(() => {
		getCurrentWindow().minimize();
	}, []);
	const [pinned, setPinned] = useState(false);
	// 窗口默认置顶创建，进入时同步置顶按钮初始状态
	useEffect(() => {
		if (open) {
			getCurrentWindow().isAlwaysOnTop().then(setPinned).catch(() => setPinned(true));
		}
	}, [open]);

	// OCR / 翻译结果窗口：常驻拖拽边界线设置（来自"主题→OCR / 翻译结果窗口"）
	const [ocrResultWindowBorderEnabled, setOcrResultWindowBorderEnabled] =
		useState(true);
	const [ocrResultWindowBorderColor, setOcrResultWindowBorderColor] =
		useState("#00000020");
	const [ocrResultWindowBorderWidth, setOcrResultWindowBorderWidth] =
		useState(1);
	useAppSettingsLoad(
		useCallback(
			(settings: AppSettingsData) => {
				const common = settings[AppSettingsGroup.Common];
				setOcrResultWindowBorderEnabled(common.ocrResultWindowBorderEnabled);
				setOcrResultWindowBorderColor(common.ocrResultWindowBorderColor);
				setOcrResultWindowBorderWidth(common.ocrResultWindowBorderWidth);
			},
			[],
		),
		true,
	);
	const togglePinned = useCallback(() => {
		const win = getCurrentWindow();
		const next = !pinned;
		setPinned(next);
		win.setAlwaysOnTop(next);
	}, [pinned]);

	// 是否处于双栏布局（原文/译文对照 或 翻译弹开）：双栏时窗口加宽一倍并保持居中
	const isDualColumn =
		(!isTranslateMode && translateOpen) || (isTranslateMode && showOcrText);

	useEffect(() => {
		if (!open) {
			return;
		}

		let cancelled = false;
		const resizeWindowForLayout = async () => {
			try {
				const appWindow = getCurrentWindow();
				const monitorInfo = await getCurrentMonitorInfo();
				const scaleFactor = window.devicePixelRatio;

				// 基准逻辑尺寸（与 ocrResult/page.tsx 保持一致）
				const baseLogicalWidth = 480;
				const baseLogicalHeight = 640;
				// 双栏时窗口宽度扩一倍
				const targetLogicalWidth = isDualColumn
					? baseLogicalWidth * 2
					: baseLogicalWidth;
				// 双栏时窗口高度也增加：原文 / 译文并排时每列能显示的行数比单栏少，
				// 保持 640 会让每列只能放下 6~8 行就触底滚动，整体显得很扁。
				// 高度 +96 后双栏宽高比从 3:2 变为 3:2.2，更协调、每列能放下更多行。
				const targetLogicalHeight = isDualColumn
					? baseLogicalHeight + 96
					: baseLogicalHeight;

				const windowHeight = Math.min(
					Math.round(targetLogicalHeight * scaleFactor),
					// 高度同样受屏幕高度限制：高 DPI（1.5x / 2x）下双栏 736 逻辑
					// 会换算成 1104 / 1472 物理像素，超出 1080p 屏高导致窗口跑到屏幕外
					Math.round(monitorInfo.monitor_height * 0.94),
				);
				// 受当前显示器宽度限制（左右留边）
				const maxWindowWidth = Math.round(monitorInfo.monitor_width * 0.94);
				const windowWidth = Math.min(
					Math.round(targetLogicalWidth * scaleFactor),
					maxWindowWidth,
				);

				// 以当前窗口中心为锚点扩展/收缩，保证切换前后居中
				const [pos, size] = await Promise.all([
					appWindow.outerPosition(),
					appWindow.outerSize(),
				]);
				const centerX = pos.x + size.width / 2;
				const centerY = pos.y + size.height / 2;

				const minX = Math.round(centerX - windowWidth / 2);
				const minY = Math.round(centerY - windowHeight / 2);

				if (cancelled) {
					return;
				}

				await setWindowRect(appWindow, {
					min_x: minX,
					min_y: minY,
					max_x: minX + windowWidth,
					max_y: minY + windowHeight,
				});
			} catch (error) {
				console.warn(
					"[OcrResultModal] resizeWindowForLayout failed:",
					error,
				);
			}
		};

		resizeWindowForLayout();

		return () => {
			cancelled = true;
		};
	}, [open, isDualColumn]);

	if (!open) {
		return null;
	}

	const blockCount = ocrResult?.text_blocks.length ?? 0;
	const totalExtracted =
		extracted.urls.length +
		extracted.emails.length +
		extracted.phones.length +
		extracted.qqs.length;

	return (
		<div className={styles.window}>
			{/* 拖拽调整窗口大小边框（四边 + 四角，常驻线样式由外观设置控制） */}
			<ResizeBorder
				borderEnabled={ocrResultWindowBorderEnabled}
				borderColor={ocrResultWindowBorderColor}
				borderWidth={ocrResultWindowBorderWidth}
			/>

			{/* 标题栏（PixPin 风格） */}
			<div className={styles.title} data-tauri-drag-region>
				<span className={styles.logo}>P</span>
				<span className={styles.titleText}>Snow Shot 文字识别</span>
				<span className={styles.spacer} />
				<span className={styles.titleActions}>
					<button
						className={`${styles.titleBtn} ${pinned ? styles.pinned : ""}`}
						title={pinned ? "取消置顶" : "置顶"}
						onClick={togglePinned}
					>
						<PushpinOutlined />
					</button>
					<button
					className={styles.titleBtn}
					title="最小化"
					onClick={minWindow}
				>
					<MinusOutlined />
				</button>
				<button
					className={`${styles.titleBtn} ${styles.closeBtn}`}
					title="关闭"
					onClick={onClose}
				>
					<CloseOutlined />
				</button>
				</span>
			</div>

			{/* 操作行 */}
			<div className={styles.body}>
				<div className={styles.actions}>
					<button
						className={`${styles.actionBtn} ${
							layoutType === "semantic" ? styles.active : ""
						}`}
						title="排版设置"
						onClick={() =>
							handleLayoutChange(
								layoutType === "semantic" ? "original" : "semantic",
							)
						}
					>
						<span>{layoutType === "semantic" ? "语义排版" : "原图排版"}</span>
					</button>
					{isTranslateMode ? (
						<button
							className={`${styles.actionBtn} ${
								showOcrText ? styles.active : ""
							}`}
							title={showOcrText ? "隐藏原文，只显示译文" : "打开原文对照"}
							onClick={toggleOcrText}
						>
							<span>{showOcrText ? "隐藏原文" : "原文对照"}</span>
						</button>
					) : (
						<button
							className={`${styles.actionBtn} ${
								translateOpen ? styles.active : ""
							}`}
							title="翻译"
							onClick={onToggleTranslate}
						>
							<span>翻译</span>
						</button>
					)}
					<span className={styles.langTag}>
						识别：{languageLabel(sourceLanguage, intl)}
					</span>
					{(isTranslateMode || translateOpen) && (
						<Select
							className={styles.langSelect}
							value={targetLanguage}
							onChange={handleTargetLanguageChange}
							options={targetLanguageOptions}
							placeholder="译至"
							popupMatchSelectWidth={false}
							suffixIcon={null}
							bordered={false}
						/>
					)}
				</div>

				{blockCount === 0 ? (
					<div className={styles.empty}>识别结果为空</div>
				) : isTranslateMode && showOcrText ? (
					/* 翻译模式：原文 ↔ 译文 逐行对照（点击某行，另一侧对应展示） */
					<div className={styles.compareGrid}>
						<div
							className={styles.dualCol}
							ref={sourceCompareRootRef}
						>
							<div className={styles.dualColHeader}>
								<span className={styles.dualColTitle}>原文</span>
								<span className={styles.dualColHeaderRight}>
									<span className={styles.tag}>
										{languageLabel(sourceLanguage, intl)}
									</span>
									<button
										className={styles.headerActionBtn}
										title="复制原文"
										onClick={handleCopy}
										disabled={!editableText}
									>
										<CopyOutlined />
										<span>复制</span>
									</button>
								</span>
							</div>
							<div className={styles.dualColBody}>
								<div className={styles.compareRows}>
									{sourceLines.map((line, i) => (
										<div
											key={i}
											data-pair={i}
											className={`${styles.compareRow} ${
												activePair === i ? styles.active : ""
											}`}
											onClick={() => onPairClick(i, "source")}
										>
											{line || "\u00A0"}
										</div>
									))}
								</div>
							</div>
						</div>
						<div
							className={styles.dualCol}
							ref={translateCompareRootRef}
						>
							<div className={styles.dualColHeader}>
								<span className={styles.dualColTitle}>译文</span>
								<span className={styles.dualColHeaderRight}>
									<span className={styles.tag}>
										{languageLabel(targetLanguage, intl)}
									</span>
									<button
										className={styles.headerActionBtn}
										title="复制译文"
										onClick={handleCopyTranslated}
										disabled={!translatedText}
									>
										<CopyOutlined />
										<span>复制</span>
									</button>
								</span>
							</div>
							{startTranslateLoading ? (
								<div className={styles.empty} style={{ minHeight: 200 }}>
									翻译中…
								</div>
							) : (
								<div className={styles.dualColBody}>
									<div className={styles.compareRows}>
										{translatedSegments.map((line, i) => (
											<div
												key={i}
												data-pair={i}
												className={`${styles.compareRow} ${
													activePair === i ? styles.active : ""
												}`}
												onClick={() => onPairClick(i, "translate")}
											>
												{line || "\u00A0"}
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					</div>
				) : isTranslateMode ? (
					/* 翻译模式：默认只展示译文 */
					<div className={styles.translateOnly}>
						<button
							className={styles.copyCorner}
							title="复制翻译"
							onClick={handleCopyTranslated}
							disabled={!translatedText}
						>
							<CopyOutlined />
							<span>复制</span>
						</button>
						<div className={styles.ocrText}>
							{startTranslateLoading
								? "翻译中…"
								: translatedText || "（暂无译文，请检查网络或翻译引擎配置）"}
						</div>
					</div>
				) : translateOpen ? (
					/* OCR 双栏：原文(可编辑) ↔ 译文，与翻译对照双栏完全对称 */
					<div className={styles.compareGrid}>
						<div className={styles.dualCol}>
							<div className={styles.dualColHeader}>
								<span className={styles.dualColTitle}>原文</span>
								<span className={styles.dualColHeaderRight}>
									<span className={styles.tag}>
										{languageLabel(sourceLanguage, intl)}
									</span>
									<button
										className={styles.headerActionBtn}
										title="复制原文"
										onClick={handleCopy}
										disabled={!editableText || copying}
									>
										<CopyOutlined />
										<span>{copying ? "复制中…" : "复制"}</span>
									</button>
								</span>
							</div>
							<div className={styles.dualColBody}>
								<textarea
									className={styles.editorTextarea}
									value={editableText}
									onChange={(e) => setEditableText(e.target.value)}
									placeholder="识别结果为空"
									spellCheck={false}
								/>
							</div>
						</div>
						<div className={styles.dualCol}>
							<div className={styles.dualColHeader}>
								<span className={styles.dualColTitle}>译文</span>
								<span className={styles.dualColHeaderRight}>
									<span className={styles.tag}>
										{languageLabel(targetLanguage, intl)}
									</span>
									<button
										className={styles.headerActionBtn}
										title="复制译文"
										onClick={handleCopyTranslated}
										disabled={!translatedText}
									>
										<CopyOutlined />
										<span>复制</span>
									</button>
								</span>
							</div>
							{startTranslateLoading ? (
								<div className={styles.empty} style={{ minHeight: 200 }}>
									翻译中…
								</div>
							) : (
								<div className={styles.dualColBody}>
									<div className={styles.compareValue}>
										{translatedText || "（暂无译文，请检查网络或翻译引擎配置）"}
									</div>
								</div>
							)}
						</div>
					</div>
				) : (
					/* OCR 单栏：仅原文（可编辑） */
					<div className={styles.ocrResult}>
						<div className={styles.ocrCol}>
							<button
								className={styles.copyCorner}
								title="复制文本"
								onClick={handleCopy}
								disabled={!editableText || copying}
							>
								<CopyOutlined />
								<span>{copying ? "复制中…" : "复制"}</span>
							</button>
							<textarea
								className={styles.ocrText}
								value={editableText}
								onChange={(e) => setEditableText(e.target.value)}
								placeholder="识别结果为空"
								spellCheck={false}
							/>
						</div>
					</div>
				)}

				{/* 提取区 */}
				{totalExtracted > 0 && (
					<div className={styles.extractPanel}>
						{ITEM_ORDER.map((key) =>
							extracted[key].map((value) => {
								const meta = ICONS[key];
								const copied = copiedItem === value;
								return (
									<span
										key={`${key}-${value}`}
										className={styles.extractChip}
										title={key === "urls" ? "点击在浏览器打开" : "点击复制"}
										onClick={() => handleItemClick(key, value)}
									>
										<span className={styles.extractIcon}>
											{meta.icon}
										</span>
										<span className={styles.extractLabel}>
											{meta.label}
										</span>
										<span
											className={`${styles.extractValue} ${
												key === "urls" ? styles.link : ""
											} ${copied ? styles.copied : ""}`}
										>
											{copied ? "已复制" : value}
										</span>
										{key === "urls" && (
											<button
												className={styles.extractAction}
												title="在浏览器打开"
												onClick={(e) => {
													e.stopPropagation();
													handleItemClick(key, value);
												}}
											>
												<ExportOutlined />
											</button>
										)}
									</span>
								);
							}),
						)}
					</div>
				)}

				{/* 底部操作栏 */}
				<div className={styles.footer}>
					<span className={styles.footerHint}>
						{layoutType === "semantic"
							? "语义排版 · 已按阅读顺序整理"
							: "原图排版 · 与截图顺序一致"}
					</span>
					<div className={styles.footerActions}>
						<button
							className={styles.minWinBtn}
							title="最小化到状态栏"
							onClick={minWindow}
						>
							<MinusOutlined />
							<span>最小化</span>
						</button>
						<button className={styles.closeWinBtn} onClick={onClose}>
							关闭窗口
						</button>
					</div>
				</div>
			</div>
		</div>
	);
};

export default OcrResultModal;
