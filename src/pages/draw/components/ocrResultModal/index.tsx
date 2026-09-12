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
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { getCurrentMonitorInfo } from "@/commands/core";
import { AntdContext } from "@/contexts/antdContext";
import { useAppSettingsLoad } from "@/hooks/useAppSettingsLoad";
import { type AppSettingsData, AppSettingsGroup } from "@/types/appSettings";
import type { OcrDetectResult } from "@/types/commands/ocr";
import { writeTextToClipboard } from "@/utils/clipboard";
import { setWindowRect } from "@/utils/window";
import styles from "./index.module.css";

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
			win
				.startResizeDragging(RESIZE_DIRECTIONS[direction])
				.catch((err: unknown) => {
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
		/^[（(【[《“"「『]|^[0-9一二三四五六七八九十]+[、.．]|^[A-Za-z0-9#*•·-]/;

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
					/[A-Za-z0-9]/.test(prevLastChar) && /[A-Za-z0-9]/.test(currFirstChar);
				merged[merged.length - 1] = prev + (needSpace ? " " : "") + trimmed;
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
	let m: RegExpExecArray | null = urlPattern.exec(text);
	let cleaned = text;
	while (m !== null) {
		let url = m[0];
		// 去掉尾部常见标点（. , ; : ！？)】]）等）
		url = url.replace(/[.,;:!?。，；：！？）)】】》》」』"'“”‘’]+$/, "");
		if (url) {
			urlSet.add(url);
		}
		// 挖掉 URL（含认证段），避免其内部被误当邮箱
		cleaned = cleaned.replace(m[0], " ");
		m = urlPattern.exec(text);
	}

	// 邮箱（在挖掉 URL 后的文本中提取）
	const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
	m = emailPattern.exec(cleaned);
	while (m !== null) {
		emailSet.add(m[0]);
		// 挖掉邮箱，避免其内部被误当手机号/QQ
		cleaned = cleaned.replace(m[0], " ");
		m = emailPattern.exec(cleaned);
	}

	const phoneSet = new Set<string>();
	const qqSet = new Set<string>();

	// 手机号：1[3-9] 开头 11 位（中国大陆）
	const phonePattern = /(?<![0-9])1[3-9][0-9]{9}(?![0-9])/g;
	m = phonePattern.exec(cleaned);
	while (m !== null) {
		phoneSet.add(m[0]);
		cleaned = cleaned.replace(m[0], " ");
		m = phonePattern.exec(cleaned);
	}

	// QQ 号：5-11 位独立数字段（排除手机号、排除 0 开头、排除长数字内截取）
	const qqPattern = /(?<![0-9])([1-9][0-9]{4,10})(?![0-9])/g;
	m = qqPattern.exec(cleaned);
	while (m !== null) {
		const num = m[1];
		// 11 位且 1[3-9] 开头 = 手机号，跳过
		if (num.length === 11 && /^1[3-9]/.test(num)) {
			m = qqPattern.exec(cleaned);
			continue;
		}
		qqSet.add(num);
		m = qqPattern.exec(cleaned);
	}

	return {
		urls: [...urlSet],
		emails: [...emailSet],
		phones: [...phoneSet],
		qqs: [...qqSet],
	};
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
	onClose: () => void;
}> = ({ open, ocrResult, onClose }) => {
	const { message } = useContext(AntdContext);
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

	// 每次 OCR 结果变化时，重置为语义智能排版（按几何位置聚类行与段落，更贴近阅读顺序）
	useEffect(() => {
		if (open && ocrResult) {
			setLayoutType("semantic");
			setEditableText(semanticLayout(ocrResult));
		}
	}, [open, ocrResult]);

	// 编辑内容变化 → 实时重新提取链接/邮箱（编辑后成为链接也会自动显示）
	useEffect(() => {
		setExtracted(extractLinks(editableText));
		setCopiedItem("");
	}, [editableText]);

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
			getCurrentWindow()
				.isAlwaysOnTop()
				.then(setPinned)
				.catch(() => setPinned(true));
		}
	}, [open]);

	// OCR 结果窗口：常驻拖拽边界线设置（来自"主题→OCR 结果窗口"）
	const [ocrResultWindowBorderEnabled, setOcrResultWindowBorderEnabled] =
		useState(true);
	const [ocrResultWindowBorderColor, setOcrResultWindowBorderColor] =
		useState("#00000020");
	const [ocrResultWindowBorderWidth, setOcrResultWindowBorderWidth] =
		useState(1);
	useAppSettingsLoad(
		useCallback((settings: AppSettingsData) => {
			const common = settings[AppSettingsGroup.Common];
			setOcrResultWindowBorderEnabled(common.ocrResultWindowBorderEnabled);
			setOcrResultWindowBorderColor(common.ocrResultWindowBorderColor);
			setOcrResultWindowBorderWidth(common.ocrResultWindowBorderWidth);
		}, []),
		true,
	);
	const togglePinned = useCallback(() => {
		const win = getCurrentWindow();
		const next = !pinned;
		setPinned(next);
		win.setAlwaysOnTop(next);
	}, [pinned]);

	// 打开时按基准尺寸居中定位到当前显示器
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

				const windowHeight = Math.min(
					Math.round(baseLogicalHeight * scaleFactor),
					Math.round(monitorInfo.monitor_height * 0.94),
				);
				const maxWindowWidth = Math.round(monitorInfo.monitor_width * 0.94);
				const windowWidth = Math.min(
					Math.round(baseLogicalWidth * scaleFactor),
					maxWindowWidth,
				);

				// 以当前窗口中心为锚点扩展/收缩，保证居中
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
				console.warn("[OcrResultModal] resizeWindowForLayout failed:", error);
			}
		};

		resizeWindowForLayout();

		return () => {
			cancelled = true;
		};
	}, [open]);

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
						type="button"
						className={`${styles.titleBtn} ${pinned ? styles.pinned : ""}`}
						title={pinned ? "取消置顶" : "置顶"}
						onClick={togglePinned}
					>
						<PushpinOutlined />
					</button>
					<button
						type="button"
						className={styles.titleBtn}
						title="最小化"
						onClick={minWindow}
					>
						<MinusOutlined />
					</button>
					<button
						type="button"
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
						type="button"
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
				</div>

				{blockCount === 0 ? (
					<div className={styles.empty}>识别结果为空</div>
				) : (
					/* OCR 单栏：仅原文（可编辑） */
					<div className={styles.ocrResult}>
						<div className={styles.ocrCol}>
							<button
								type="button"
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
										<span className={styles.extractIcon}>{meta.icon}</span>
										<span className={styles.extractLabel}>{meta.label}</span>
										<span
											className={`${styles.extractValue} ${
												key === "urls" ? styles.link : ""
											} ${copied ? styles.copied : ""}`}
										>
											{copied ? "已复制" : value}
										</span>
										{key === "urls" && (
											<button
												type="button"
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
							type="button"
							className={styles.minWinBtn}
							title="最小化到状态栏"
							onClick={minWindow}
						>
							<MinusOutlined />
							<span>最小化</span>
						</button>
						<button
							type="button"
							className={styles.closeWinBtn}
							onClick={onClose}
						>
							关闭窗口
						</button>
					</div>
				</div>
			</div>
		</div>
	);
};

export default OcrResultModal;
