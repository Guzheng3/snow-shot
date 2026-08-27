import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { AntdContext } from "@/contexts/antdContext";
import { AppSettingsActionContext } from "@/contexts/appSettingsActionContext";
import { useAppSettingsLoad } from "@/hooks/useAppSettingsLoad";
import { useStateRef } from "@/hooks/useStateRef";
import { translateText } from "@/commands/httpServices";
import { AppSettingsGroup } from "@/types/appSettings";
import { appError } from "@/utils/log";

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
			},
			[setSourceLanguage, setTargetLanguage, options?.enableCacheConfig],
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
				const result = await translateText(text, sourceLanguage, targetLanguage);
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

	return {
		updateSourceLanguage,
		updateTargetLanguage,
		requestTranslate,
		startTranslateLoading,
		translatedContent,
		sourceLanguage,
		targetLanguage,
		getTranslatedContent,
	};
};