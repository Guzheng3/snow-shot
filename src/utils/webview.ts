import { supportWebViewSharedBuffer } from "./environment";

export const getWebViewSharedBuffer = (
	channelId?: string,
	transferType?: string,
): Promise<ArrayBuffer | undefined> => {
	if (!supportWebViewSharedBuffer()) {
		return Promise.resolve(undefined);
	}

	// Windows 下支持通过 SharedBuffer 传输图像数据
	return new Promise((resolve) => {
		const handleSharedBufferReceived = (e: {
			getBuffer: () => ArrayBuffer;
			additionalData?: Record<string, unknown>;
		}) => {
			if (transferType && e.additionalData?.transfer_type !== transferType) {
				return;
			}

			if (channelId && e.additionalData?.id !== channelId) {
				return;
			}

			clearTimeout(timeout);

			const buffer = e.getBuffer();

			resolve(buffer);
			window.chrome.webview.removeEventListener(
				"sharedbufferreceived",
				handleSharedBufferReceived,
			);
		};

		window.chrome.webview.addEventListener(
			"sharedbufferreceived",
			handleSharedBufferReceived,
		);

		const timeout = setTimeout(() => {
			resolve(undefined);
			window.chrome.webview.removeEventListener(
				"sharedbufferreceived",
				handleSharedBufferReceived,
			);
		}, 1000 * 3);
	});
};

export const releaseWebViewSharedBuffer = (buffer: ArrayBuffer) => {
	if (!supportWebViewSharedBuffer()) {
		return;
	}
	window.chrome.webview.releaseBuffer(buffer);
};

/**
 * 将 canvas 的 RGBA 像素分块写入共享缓冲（destination）。
 * 分块读取并在块之间让出主线程，避免超大画布一次性 getImageData 造成界面长时间无响应。
 * 只写入 width * height * 4 字节的像素区；末尾的宽高字节由调用方自行写入。
 * @returns 是否写入成功（canvas 无 2d 上下文时返回 false）
 */
export const writeCanvasPixelsToBuffer = async (
	canvas: HTMLCanvasElement,
	destination: ArrayBuffer | SharedArrayBuffer,
	chunkRows = 128,
): Promise<boolean> => {
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return false;
	}

	const { width, height } = canvas;
	const target = new Uint8ClampedArray(destination);
	let y = 0;

	while (y < height) {
		const bandHeight = Math.min(chunkRows, height - y);
		const imageData = ctx.getImageData(0, y, width, bandHeight);
		target.set(imageData.data, y * width * 4);
		y += bandHeight;

		// 让出主线程，让渲染/交互能继续，避免一次性同步读取造成卡顿
		if (y < height) {
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
		}
	}

	return true;
};
