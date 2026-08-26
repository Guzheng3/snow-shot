"use client";

import {
	GithubOutlined,
	MailOutlined,
	MessageOutlined,
	QqOutlined,
} from "@ant-design/icons";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Badge, Button, Divider, Space, Tag, Typography, theme } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";

const { Title, Paragraph, Text } = Typography;

export const AboutPage = () => {
	const { token } = theme.useToken();
	const intl = useIntl();
	const [version, setVersion] = useState("0.1.3");

	const inited = useRef(false);
	const init = useCallback(async () => {
		if (inited.current) {
			return;
		}
		inited.current = true;

		const version = await getVersion();
		setVersion(version);
	}, []);

	useEffect(() => {
		init();
	}, [init]);

	return (
		<div
			style={{
				margin: `${token.marginLG}px 0`,
				minHeight: "100vh",
			}}
		>
			{/* 头部信息 */}
			<div style={{ textAlign: "center", marginBottom: token.marginLG }}>
				<div style={{ marginBottom: -12 }}>
					<img
						src={"/images/app-icon.png"}
						alt="Snow Shot"
						width={100}
						height={100}
					/>
				</div>

				<Title level={2} style={{ marginTop: token.marginSM }}>
					<Badge
						style={{ display: "block", cursor: "pointer" }}
						size="small"
						onClick={() => openUrl("https://snowshot.top/")}
					>
						<div
							style={{
								fontSize: token.fontSizeHeading2,
								marginTop: token.marginXS,
							}}
						>
							<span style={{ color: "var(--snow-shot-purple-color)" }}>
								Snow{" "}
							</span>
							<span>Shot</span>
						</div>
					</Badge>
				</Title>
				<div>
					<Text type="secondary">
						{intl.formatMessage({ id: "about.subtitle" })}
					</Text>
				</div>
				<div style={{ marginTop: token.margin }}>
					<Tag color="blue">
						<a
							style={{ color: token.colorLink }}
							onClick={() => openUrl("https://snowshot.top/")}
						>
							{intl.formatMessage({ id: "about.version" })} {version}
						</a>
					</Tag>
					<Tag color="green">
						<a
							style={{ color: token.colorLink }}
							onClick={() => openUrl("https://github.com/mg-chao")}
						>
							{intl.formatMessage({ id: "about.author" })}
						</a>
					</Tag>
				</div>
			</div>

			<Divider />

			{/* 开源协议 */}
			<div style={{ marginBottom: token.marginLG }}>
				<Title level={3}>
					{intl.formatMessage({ id: "about.license.title" })}
				</Title>
				<Paragraph>
					{intl.formatMessage({ id: "about.license.description" })}
				</Paragraph>
				<ul>
					<li>
						<strong>
							{intl.formatMessage({ id: "about.license.nonCommercial" })}
						</strong>
						<a
							onClick={() =>
								openUrl("https://www.apache.org/licenses/LICENSE-2.0")
							}
						>
							{intl.formatMessage({ id: "about.license.nonCommercialType" })}
						</a>
					</li>
					<li>
						<strong>
							{intl.formatMessage({ id: "about.license.commercial" })}
						</strong>
						<a
							onClick={() =>
								openUrl("https://www.gnu.org/licenses/gpl-3.0.html")
							}
						>
							{intl.formatMessage({ id: "about.license.commercialType" })}
						</a>
					</li>
				</ul>
			</div>

			{/* 联系方式 */}
			<div style={{ marginBottom: token.marginLG }}>
				<Title level={3}>
					{intl.formatMessage({ id: "about.contact.title" })}
				</Title>
				<Space direction="vertical" style={{ width: "100%" }}>
					<Button
						type="primary"
						icon={<GithubOutlined />}
						onClick={() =>
							openUrl("https://github.com/mg-chao/snow-shot/issues")
						}
						block
					>
						{intl.formatMessage({ id: "about.contact.github" })}
					</Button>
					<Button
						icon={<MessageOutlined />}
						onClick={() =>
							openUrl("https://space.bilibili.com/3546897042114689")
						}
						block
					>
						{intl.formatMessage({ id: "about.contact.bilibili" })}
					</Button>
					<Button
						icon={<MailOutlined />}
						onClick={() => openUrl("mailto:chao@mgchao.top")}
						block
					>
						{intl.formatMessage({ id: "about.contact.email" })}
					</Button>
					<Button
						icon={<QqOutlined />}
						onClick={() => openUrl("https://qm.qq.com/q/w9B2gLdoYg")}
						block
					>
						{intl.formatMessage({ id: "about.contact.qqGroup" })}
					</Button>
				</Space>
			</div>
		</div>
	);
};
