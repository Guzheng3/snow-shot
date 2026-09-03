import * as dialog from "@tauri-apps/plugin-dialog";
import { ocrImportModelArchive } from "@/commands/ocr";
import { AppSettingsGroup, OcrModel } from "@/types/appSettings";
import type { AppSettingsActionContextType } from "@/types/contexts";

/**
 * 一键导入 OCR 模型压缩包：选择 zip → 后端解压到应用配置目录并删除原包 →
 * 更新设置（记录模型目录并切换为本地模型）让 OCR 服务重新初始化。
 * 返回导入后的模型目录，未选择则返回 undefined。
 */
export const importOcrModelArchive = async (
	updateAppSettings: AppSettingsActionContextType["updateAppSettings"],
): Promise<string | undefined> => {
	const selected = await dialog.open({
		multiple: false,
		title: "导入 OCR 模型压缩包",
		filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }],
	});

	if (typeof selected !== "string" || selected === "") {
		return undefined;
	}

	const modelDir = await ocrImportModelArchive(selected);

	// 导入即启用：记录模型目录并切换为本地模型（插件版默认云端）
	updateAppSettings(
		AppSettingsGroup.FunctionOcr,
		{ ocrModelDir: modelDir, ocrModel: OcrModel.RapidOcrV5Server },
		false,
		true,
		true,
		false,
	);

	return modelDir;
};