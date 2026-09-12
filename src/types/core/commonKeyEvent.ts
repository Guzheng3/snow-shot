export enum CommonKeyEventGroup {
	FixedContent = "fixedContent",
}

export type CommonKeyEventValue = {
	hotKey: string;
	unique?: boolean;
	group: CommonKeyEventGroup;
};

export type CommonKeyEventComponentValue = CommonKeyEventValue & {
	messageId: string;
};

export enum CommonKeyEventKey {
	FixedContentEnableDraw = "fixedContentEnableDraw",
	FixedContentSwitchThumbnail = "fixedContentSwitchThumbnail",
	FixedContentAlwaysOnTop = "fixedContentAlwaysOnTop",
	FixedContentCloseWindow = "fixedContentCloseWindow",
	FixedContentCopyToClipboard = "fixedContentCopyToClipboard",
	// FixedContentCopyRawToClipboard = 'fixedContentCopyRawToClipboard',
	FixedContentSaveToFile = "fixedContentSaveToFile",
	FixedContentSelectText = "fixedContentSelectText",
	FixedContentSetOpacity = "fixedContentSetOpacity",
}
