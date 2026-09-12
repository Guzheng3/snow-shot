import { emit } from "@tauri-apps/api/event";

export const showOrHideMainWindow = async () => {
	await emit("show-or-hide-main-window");
};

export const openImageSaveFolder = async () => {
	await emit("open-image-save-folder");
};

export const openCaptureHistory = async () => {
	await emit("open-capture-history");
};
