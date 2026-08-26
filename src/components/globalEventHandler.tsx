import { useRouter } from "@tanstack/react-router";
import { openPath } from "@tauri-apps/plugin-opener";
import React, { useContext, useEffect } from "react";
import { showMainWindow } from "@/commands/videoRecord";
import { EventListenerContext } from "@/components/eventListener";
import { AppSettingsPublisher } from "@/contexts/appSettingsActionContext";
import { useStateSubscriber } from "@/hooks/useStateSubscriber";
import { getImageSaveDirectory } from "@/utils/file";
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
