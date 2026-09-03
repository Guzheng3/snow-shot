import { useRouter } from "@tanstack/react-router";
import { openPath } from "@tauri-apps/plugin-opener";
import React, { useContext, useEffect } from "react";
import { showMainWindow } from "@/commands/videoRecord";
import { getSelectedText } from "@/commands/core";
import { EventListenerContext } from "@/components/eventListener";
import { AppSettingsPublisher } from "@/contexts/appSettingsActionContext";
import { useStateSubscriber } from "@/hooks/useStateSubscriber";
import { getImageSaveDirectory } from "@/utils/file";
import { encodeParamsValue } from "@/utils/base64";
import { showWindow } from "@/utils/window";

const GlobalEventHandlerCore: React.FC = () => {
	const router = useRouter();

	const { addListener, removeListener } = useContext(EventListenerContext);
	const [getAppSettings] = useStateSubscriber(AppSettingsPublisher, undefined);

	useEffect(() => {
		const listenerIdList: number[] = [];
		listenerIdList.push(
			addListener("show-or-hide-main-window", () => {
				showMainWindow(true);
			}),
			addListener("open-image-save-folder", async () => {
				const saveFileDirectory = await getImageSaveDirectory(getAppSettings());
				openPath(saveFileDirectory);
			}),
			addListener("open-capture-history", async () => {
				await showWindow();
				router.navigate({
					to: `/tools/captureHistory`,
				});
			}),
			// 翻译：显示主窗口并打开翻译页
			addListener("execute-translate", async () => {
				await showMainWindow();
				router.navigate({
					to: "/tools/translation",
				});
			}),
			// 翻译选中文字：先在其他应用仍持有焦点时取词，再显示主窗口带词跳转翻译页
			addListener("execute-translate-selected-text", async () => {
				const selectedText = await getSelectedText();
				await showMainWindow();
				// t 为刷新标记：相同 selectText 的重复触发也能重新填充
				router.navigate({
					to: `/tools/translation?t=${Date.now()}&selectText=${encodeParamsValue(selectedText)}`,
				});
			}),
		);

		return () => {
			listenerIdList.forEach((id) => {
				removeListener(id);
			});
		};
	}, [addListener, removeListener, router, getAppSettings]);

	return undefined;
};

export const GlobalEventHandler = React.memo(GlobalEventHandlerCore);
