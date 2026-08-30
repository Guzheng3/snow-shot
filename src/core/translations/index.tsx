import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { AntdContext } from "@/contexts/antdContext";
import { AppSettingsActionContext } from "@/contexts/appSettingsActionContext";
import { useAppSettingsLoad } from "@/hooks/useAppSettingsLoad";
import { useStateRef } from "@/hooks/useStateRef";
import { translateText } from "@/commands/httpServices";
import { AppSettingsGroup } from "@/types/appSettings";
import { appError } from "@/utils/log";

/** 可选翻译引擎（后端 TranslateEngine 的序列化名） */
export const TRANSLATE_ENGINE_KEYS = [
	"Transmart",
	"ICibaTranslate",
	"Microsoft",
	"Yandex",
] as const;

/** 目标语言为 "auto"（自动）时，按源文本是中文还是外语决定真正的目标语言：
 *  中文 → 英文；外语 → 简体中文。 */
const resolveAutoTargetLanguage = (text: string): string => {
	// 统计常见 CJK（汉字）字符比例，>0 即视为含中文
	const cjkCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
	return cjkCount > 0 ? "en" : "zh-CHS";
};

export const useTranslationRequest = (options?: {
	enableCacheConfig?: boolean;
	onComplete?: (result: { content: string }[], requestId?: number) => void;
	lazyLoad?: boolean;
}) => {
	const intl = useIntl();
	const { message } = useContext(AntdContext);

	const [sourceLanguage, setSourceLanguage, sourceLanguageRef] =
		useStateRef<string>("auto");
	const [targetLanguage, setTargetLanguage, targetLanguageRef] =
		useStateRef<string>("zh-CHS");
	const [engineOrder, setEngineOrder, engineOrderRef] = useStateRef<string[]>(
		[...TRANSLATE_ENGINE_KEYS],
	);

	useAppSettingsLoad(
		useCallback(
			(settings) => {
				if (options?.enableCacheConfig) {
					setSourceLanguage(
						settings[AppSettingsGroup.FunctionTranslationCache]
							.cacheSourceLanguage,
					);
					setTargetLanguage(
						settings[AppSettingsGroup.FunctionTranslationCache]
							.cacheTargetLanguage,
					);
				} else {
					setSourceLanguage(
						settings[AppSettingsGroup.FunctionTranslation].sourceLanguage,
					);
					setTargetLanguage(
						settings[AppSettingsGroup.FunctionTranslation].targetLanguage,
					);
				}
				setEngineOrder(
					settings[AppSettingsGroup.FunctionTranslation]
						.translateEngineOrder ?? [...TRANSLATE_ENGINE_KEYS],
				);
			},
			[
				setSourceLanguage,
				setTargetLanguage,
				setEngineOrder,
				options?.enableCacheConfig,
			],
		),
		true,
	);
	const { updateAppSettings } = useContext(AppSettingsActionContext);

	const [startTranslateLoading, setStartTranslateLoading] = useState(false);
	const [translatedContent, setTranslatedContent, translatedContentRef] =
		useStateRef<string>("");

	const requestTranslate = useCallback(
		async (sourceContent: string[], requestId?: number) => {
			const sourceLanguage = sourceLanguageRef.current;
			const targetLanguage = targetLanguageRef.current;
			const text = sourceContent.join("\n");

			setStartTranslateLoading(true);
			try {
				// 目标语言选了"自动"时，按原文语言智能翻转目标语言
				const resolvedTargetLanguage =
					targetLanguage === "auto"
						? resolveAutoTargetLanguage(text)
						: targetLanguage;
				const result = await translateText(
					text,
					sourceLanguage,
					resolvedTargetLanguage,
					engineOrderRef.current ?? [...TRANSLATE_ENGINE_KEYS],
				);
				setStartTranslateLoading(false);

				if (result.success) {
					const results = [{ content: result.text }];
					options?.onComplete?.(results, requestId);
					setTranslatedContent(result.text);
				} else {
					message.error(result.error || "Translation failed");
				}
			} catch (error) {
				appError("[requestTranslate] error", error);
				message.error("Translation failed");
				setStartTranslateLoading(false);
			}
		},
		[
			options,
			sourceLanguageRef,
			message,
			targetLanguageRef,
			engineOrderRef,
			setTranslatedContent,
		],
	);

	const updateSourceLanguage = useCallback(
		(sourceLanguage: string) => {
			if (options?.enableCacheConfig) {
				updateAppSettings(
					AppSettingsGroup.FunctionTranslationCache,
					{ cacheSourceLanguage: sourceLanguage },
					true, true, false, true, false,
				);
			} else {
				updateAppSettings(
					AppSettingsGroup.FunctionTranslation,
					{ sourceLanguage },
					true, true, true, true, false,
				);
			}
		},
		[updateAppSettings, options?.enableCacheConfig],
	);

	const updateTargetLanguage = useCallback(
		(targetLanguage: string) => {
			if (options?.enableCacheConfig) {
				updateAppSettings(
					AppSettingsGroup.FunctionTranslationCache,
					{ cacheTargetLanguage: targetLanguage },
					true, true, false, true, false,
				);
			} else {
				updateAppSettings(
					AppSettingsGroup.FunctionTranslation,
					{ targetLanguage },
					true, true, true, true, false,
				);
			}
		},
		[updateAppSettings, options?.enableCacheConfig],
	);

	const getTranslatedContent = useCallback(() => {
		return translatedContentRef.current;
	}, [translatedContentRef]);

	const updateEngineOrder = useCallback(
		(newOrder: string[]) => {
			updateAppSettings(
				AppSettingsGroup.FunctionTranslation,
				{ translateEngineOrder: newOrder },
				true, true, true, true, false,
			);
			setEngineOrder(newOrder);
		},
		[updateAppSettings, setEngineOrder],
	);

	return {
		updateSourceLanguage,
		updateTargetLanguage,
		requestTranslate,
		startTranslateLoading,
		translatedContent,
		sourceLanguage,
		targetLanguage,
		getTranslatedContent,
		engineOrder,
		updateEngineOrder,
	};
};