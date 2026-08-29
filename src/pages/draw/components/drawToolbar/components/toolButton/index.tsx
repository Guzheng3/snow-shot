import { Button, theme } from "antd";
import React, { useCallback, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { DrawStatePublisher } from "@/components/drawCore/extra";
import { defaultDrawToolbarKeyEventComponentConfig } from "@/constants/drawToolbarKeyEvent";
import { useAppSettingsLoad } from "@/hooks/useAppSettingsLoad";
import { useStateSubscriber } from "@/hooks/useStateSubscriber";
import { type AppSettingsData, AppSettingsGroup } from "@/types/appSettings";
import { DrawToolbarKeyEventKey } from "@/types/components/drawToolbar";
import type { HotkeysScope } from "@/types/core/appHotKeys";
import type { DrawState } from "@/types/draw";
import { getButtonTypeByState } from "../../extra";
import { KeyEventWrap } from "@/pages/draw/components/drawToolbar/components/keyEventWrap";

/**
 * 工具栏图标下方文字的短名称映射（长名称在设置面板里仍显示完整翻译）
 * 用户指定：锁定绘制工具→锁定、文本识别翻译→翻译、固定到屏幕→贴图、
 * 滚动截图→长图、复制到剪贴板→复制
 */
const TOOLBAR_SHORT_NAMES: Partial<Record<DrawToolbarKeyEventKey, string>> = {
	[DrawToolbarKeyEventKey.LockDrawTool]: "锁定",
	[DrawToolbarKeyEventKey.FixedTool]: "贴图",
	[DrawToolbarKeyEventKey.ScrollScreenshotTool]: "长图",
	[DrawToolbarKeyEventKey.CopyTool]: "复制",
	[DrawToolbarKeyEventKey.OcrTranslateTool]: "翻译",
};

const ToolButtonCore: React.FC<{
	hidden?: boolean;
	componentKey?: DrawToolbarKeyEventKey;
	icon: React.ReactNode;
	onClick: () => void;
	drawState: DrawState;
	extraDrawState?: DrawState[];
	enableState?: boolean;
	disable?: boolean;
	confirmTip?: React.ReactNode;
	hotkeyScope?: HotkeysScope;
	buttonProps?: React.ComponentProps<typeof Button>;
}> = ({
	hidden,
	componentKey,
	icon,
	onClick,
	drawState: propDrawState,
	extraDrawState,
	enableState,
	disable,
	confirmTip,
	hotkeyScope,
	buttonProps,
}) => {
	const intl = useIntl();
	const { token } = theme.useToken();
	const [buttonType, setButtonType] = useState(getButtonTypeByState(false));
	const updateButtonType = useCallback(
		(drawState: DrawState) => {
			setButtonType(
				getButtonTypeByState(
					drawState === propDrawState ||
						enableState ||
						(extraDrawState?.includes(drawState) ?? false),
				),
			);
		},
		[propDrawState, enableState, extraDrawState],
	);

	useStateSubscriber(DrawStatePublisher, updateButtonType);

	const [keyEventValue, setKeyEventValue] = useState<
		{ hotKey?: string; showInToolbar?: boolean } | undefined
	>(undefined);
	useAppSettingsLoad(
		useCallback(
			(settings: AppSettingsData) => {
				if (!componentKey) {
					return;
				}
				setKeyEventValue(
					settings[AppSettingsGroup.DrawToolbarKeyEvent][componentKey],
				);
			},
			[componentKey],
		),
		true,
	);

	// 图标下方文字：只显示功能名（与网页 demo 一致，不显示快捷键）
	const label = useMemo(() => {
		if (!componentKey) {
			return undefined;
		}
		return (
			TOOLBAR_SHORT_NAMES[componentKey] ??
			intl.formatMessage({
				id: defaultDrawToolbarKeyEventComponentConfig[componentKey].messageId,
			})
		);
	}, [componentKey, intl]);

	// hover 显示完整信息：功能名 + 快捷键（与网页 demo 一致）
	const hoverTitle = useMemo(() => {
		if (!componentKey) {
			return undefined;
		}
		const name =
			TOOLBAR_SHORT_NAMES[componentKey] ??
			intl.formatMessage({
				id: defaultDrawToolbarKeyEventComponentConfig[componentKey].messageId,
			});
		const hotKey = keyEventValue?.hotKey;
		return hotKey ? name + " " + hotKey : name;
	}, [componentKey, intl, keyEventValue]);

	const buttonDom = (
		<Button
			style={{
				display: hidden ? "none" : undefined,
			}}
			{...buttonProps}
			icon={icon}
			type={buttonType}
			onClick={onClick}
			disabled={disable}
			key={componentKey}
		/>
	);

	const inner = componentKey ? (
		<KeyEventWrap
			onKeyUpEventPropName="onClick"
			componentKey={componentKey}
			confirmTip={confirmTip}
			enable={disable ? false : undefined}
			hotkeyScope={hotkeyScope}
		>
			{buttonDom}
		</KeyEventWrap>
	) : (
		buttonDom
	);

	return (
		<div
			className="draw-toolbar-btn-wrap"
			title={hoverTitle}
			style={{
				display: hidden ? "none" : "inline-flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 7,
				lineHeight: 1,
			}}
		>
			{inner}
			{label && (
				<span
					className="draw-toolbar-btn-label"
					style={{
						fontSize: 10,
						lineHeight: 1.1,
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
						maxWidth: 72,
						color: token.colorTextSecondary,
						pointerEvents: "none",
					}}
				>
					{label}
				</span>
			)}
		</div>
	);
};
export const ToolButton = React.memo(ToolButtonCore);
