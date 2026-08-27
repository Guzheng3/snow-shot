import {
	AppstoreOutlined,
	InfoCircleOutlined,
	SettingOutlined,
	ToolOutlined,
} from "@ant-design/icons";
import { useLocation, useRouter } from "@tanstack/react-router";
import { Layout, theme } from "antd";
import type { ItemType, MenuItemType } from "antd/es/menu/interface";
import React, { useCallback, useContext, useEffect, useMemo } from "react";
import { useIntl } from "react-intl";
import { CheckEnvironment } from "@/components/checkEnvironment";
import { GlobalEventHandler } from "@/components/globalEventHandler";
import { GlobalShortcut } from "@/components/globalShortcut";
import { PersonalizationIcon } from "@/components/icons";
import { InitService } from "@/components/initService";
import {
	TrayIconLoader,
	TrayIconStatePublisher,
} from "@/components/trayIconLoader";
import {
		PLUGIN_ID_FFMPEG,
	} from "@/constants/pluginService";
import { AppContext } from "@/contexts/appContext";
import { AppSettingsActionContext } from "@/contexts/appSettingsActionContext";
import { usePluginServiceContext } from "@/contexts/pluginServiceContext";
import { useAppSettingsLoad } from "@/hooks/useAppSettingsLoad";
import { withStatePublisher } from "@/hooks/useStatePublisher";
import { en } from "@/messages/en";
import { zhHans } from "@/messages/zhHans";
import { zhHant } from "@/messages/zhHant";
import {
	AppSettingsGroup,
	AppSettingsLanguage,
	AppSettingsTheme,
} from "@/types/appSettings";
import type { RouteItem, RouteMapItem } from "@/types/components/menuLayout";
import { getPlatformValue } from "@/utils/platform";
import { MenuContent } from "./components/menuContent";
import { MenuSider } from "./components/menuSider";

type MenuItem = ItemType<MenuItemType>;

const MenuLayoutCore: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	useEffect(() => {
		if (process.env.NODE_ENV !== "development") {
			return;
		}

		const zhHansKeys = Object.keys(zhHans);
		const zhHantKeys = new Set(Object.keys(zhHant));
		const enKeys = new Set(Object.keys(en));

		const zhHantMissingKeys: Record<string, string> = {};
		zhHansKeys
			.filter((key) => !zhHantKeys.has(key))
			.forEach((key) => {
				zhHantMissingKeys[key] = zhHans[key as keyof typeof zhHans];
			});

		const enMissingKeys: Record<string, string> = {};
		zhHansKeys
			.filter((key) => !enKeys.has(key))
			.forEach((key) => {
				enMissingKeys[key] = zhHans[key as keyof typeof zhHans];
			});

		console.log("App zh-Hant missing messages: ", zhHantMissingKeys);
		console.log("App en missing messages: ", enMissingKeys);
	}, []);

	const intl = useIntl();
	const appSettings = useContext(AppSettingsActionContext);
	const { currentTheme } = useContext(AppContext);
	const { updateAppSettings } = appSettings;

	const routerLocation = useLocation();
	const pathname = routerLocation.pathname || "/";
	useAppSettingsLoad(
		useCallback(
			(settings) => {
				// 获取浏览器语言，判断是否需要切换语言
				const settingBrowserLanguage =
					settings[AppSettingsGroup.Common].browserLanguage;
				const browserLanguage = navigator.language;
				if (settingBrowserLanguage !== browserLanguage) {
					// 切换语言
					let language = AppSettingsLanguage.EN;
					if (browserLanguage.startsWith("zh")) {
						if (browserLanguage.startsWith("zh-TW")) {
							language = AppSettingsLanguage.ZHHant;
						} else {
							language = AppSettingsLanguage.ZHHans;
						}
					}

					updateAppSettings(
						AppSettingsGroup.Common,
						{
							browserLanguage: browserLanguage,
							language,
						},
						false,
						true,
						true,
					);
				}
			},
			[updateAppSettings],
		),
	);

	const { token } = theme.useToken();
	const { isReadyStatus } = usePluginServiceContext();
	const router = useRouter();
	const routes = useMemo(() => {
		const routes: RouteItem[] = [
			{
				key: "/",
				path: "/",
				label: intl.formatMessage({ id: "menu.functions" }),
				icon: <AppstoreOutlined />,
				tabs: [
										{
											key: "screenshotFunction",
											label: intl.formatMessage({ id: "home.screenshotFunction" }),
										},
										{
											key: "videoRecordFunction",
											label: intl.formatMessage({ id: "home.videoRecordFunction" }),
										},
										{
											key: "otherFunction",
											label: intl.formatMessage({ id: "home.otherFunction" }),
										},
									].filter((item) => {
										if (item.key === "videoRecordFunction") {
											return isReadyStatus?.(PLUGIN_ID_FFMPEG);
										}


										return true;
									}),
			},
			{
				key: "/tools",
				path: undefined,
				label: intl.formatMessage({ id: "menu.tools" }),
				icon: <ToolOutlined />,
				tabs: [],
				children: [
										{
											key: "/tools/captureHistory",
											path: "/tools/captureHistory",
											label: intl.formatMessage({ id: "menu.tools.captureHistory" }),
											hideTabs: true,
											tabs: [
												{
													key: "captureHistory",
													label: intl.formatMessage({ id: "menu.tools.captureHistory" }),
												},
											],
										},
									].filter((item) => {

										return true;
									}),
			},
			{
				key: "/personalization",
				path: undefined,
				label: intl.formatMessage({ id: "menu.personalization" }),
				icon: <PersonalizationIcon />,
				tabs: [],
				children: [
					{
						key: "/personalization/appearance",
						path: "/personalization/appearance",
						label: intl.formatMessage({
							id: "menu.personalization.appearance",
						}),
						hideTabs: true,
						tabs: [
							{
								key: "appearance",
								label: intl.formatMessage({
									id: "menu.personalization.appearance",
								}),
							},
						],
					},
					{
						key: "/personalization/plugins",
						path: "/personalization/plugins",
						label: intl.formatMessage({ id: "menu.personalization.plugins" }),
						hideTabs: true,
						tabs: [
							{
								key: "plugins",
								label: intl.formatMessage({
									id: "menu.personalization.plugins",
								}),
							},
						],
					},
				],
			},
			{
				key: "/settings",
				path: undefined,
				label: intl.formatMessage({ id: "menu.settings" }),
				icon: <SettingOutlined />,
				tabs: [],
				children: [
					{
						key: "/settings/generalSettings",
						path: "/settings/generalSettings",
						label: intl.formatMessage({ id: "menu.settings.generalSettings" }),
						hideTabs: true,
						tabs: [],
					},
					{
						key: "/settings/functionSettings",
						path: "/settings/functionSettings",
						label: intl.formatMessage({ id: "menu.settings.functionSettings" }),
						hideTabs: true,
						tabs: [],
					},
					{
						key: "/settings/hotKeySettings",
						path: "/settings/hotKeySettings",
						label: intl.formatMessage({ id: "menu.settings.hotKeySettings" }),
						hideTabs: true,
						tabs: [],
					},
					{
						key: "/settings/systemSettings",
						path: "/settings/systemSettings",
						label: intl.formatMessage({ id: "menu.settings.systemSettings" }),
						hideTabs: true,
						tabs: [],
					},
				],
			},
			{
				key: "/about",
				path: "/about",
				tabs: [
					{
						key: "snowShot",
						label: intl.formatMessage({ id: "home.snowShot" }),
					},
				],
				label: intl.formatMessage({ id: "menu.about" }),
				icon: <InfoCircleOutlined />,
			},
		];

		return routes;
	}, [intl, isReadyStatus]);
	const { menuItems, routeTabsMap } = useMemo(() => {
		const routeTabsMap: Record<string, RouteMapItem> = {};

		const convertToMenuItem = (route: RouteItem): MenuItem => {
			const menuItem: MenuItem = {
				key: route.key,
				label: route.label,
				icon: route.icon,
				onClick: () => {
					if (!route.path) {
						return;
					}

					router.navigate({ to: route.path });
				},
				children: undefined as unknown as MenuItem[],
			};

			if (route.children?.length) {
				menuItem.children = route.children.map((child) =>
					convertToMenuItem(child),
				);
			}

			if (route.path && route.tabs?.length !== undefined) {
				routeTabsMap[route.path] = {
					items: route.tabs,
					hideTabs: route.hideTabs,
				};
			}

			return menuItem;
		};

		const menuItems = Object.values(routes).map(convertToMenuItem);

		return { menuItems, routeTabsMap };
	}, [router, routes]);

	return (
		<>
			<TrayIconLoader />
			<GlobalEventHandler />
			<CheckEnvironment />
			<div className="menu-layout-wrap">
				<Layout>
					<MenuSider
						menuItems={menuItems}
						darkMode={currentTheme === AppSettingsTheme.Dark}
						pathname={pathname}
					/>
					<MenuContent pathname={pathname} routeTabsMap={routeTabsMap}>
						<GlobalShortcut>{children}</GlobalShortcut>
					</MenuContent>
				</Layout>
				<style jsx>{`
                    .menu-layout-wrap {
                        box-shadow: 0 0 12px 0 rgba(0, 0, 0, 0.21);
                        overflow: hidden;
                        height: 100%;
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        z-index: 1;
                    }

                    .menu-layout-wrap :global(.ant-layout) {
                        height: 100% !important;
                    }

                    .menu-layout-wrap > :global(.ant-layout) {
                        flex-direction: row !important;
                    }

                    .menu-layout-wrap :global(.ant-layout-sider-trigger) {
                        position: absolute !important;
                    }

                    .menu-layout-wrap :global(.ant-layout-sider) {
                        box-shadow: ${token.boxShadowSecondary};
                    }

                    .menu-layout-wrap :global(.ant-layout-header) {
                        height: 32px !important;
                        background: ${token.colorBgContainer};
                        display: flex;
                        align-items: center;
                        justify-content: flex-end;
                        padding: 0 ${token.padding}px;
                    }
                `}</style>
			</div>
		</>
	);
};

const ML = React.memo(
	withStatePublisher(MenuLayoutCore, TrayIconStatePublisher),
);

export const MenuLayout = ({ children }: { children: React.ReactNode }) => {
	return (
		<>
			<InitService />
			<ML>{children}</ML>
		</>
	);
};
