export interface OcrDetectResultTextPoint {
	x: number;
	y: number;
}

export interface OcrDetectResultTextBlock {
	box_points: OcrDetectResultTextPoint[];
	text: string;
	text_score: number;
}

export interface OcrDetectResult {
	text_blocks: OcrDetectResultTextBlock[];
	scale_factor: number;
	/** 识别的源语言（可能未检测，为空时前端按 auto 处理） */
	lang?: string;
}
