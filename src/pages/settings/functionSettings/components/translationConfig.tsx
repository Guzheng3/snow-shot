import { ProForm } from "@ant-design/pro-components";
import {
	ArrowDownOutlined,
	ArrowUpOutlined,
} from "@ant-design/icons";
import { Button, Col, List, Row, Select, theme, Tooltip, Typography } from "antd";
import { FormattedMessage, useIntl } from "react-intl";
import { useLanguageOptions } from "@/components/translator";
import { TRANSLATE_ENGINE_KEYS, useTranslationRequest } from "@/core/translations";

/** 引擎标识 → i18n 文案 key */
const ENGINE_LABEL_KEYS: Record<string, string> = {
	Transmart: "tools.translation.engine.transmart",
	ICibaTranslate: "tools.translation.engine.icibaTranslate",
	Microsoft: "tools.translation.engine.microsoft",
	Yandex: "tools.translation.engine.yandex",
};

export const TranslationConfig = () => {
	const { token } = theme.useToken();
	const intl = useIntl();

	const {
		sourceLanguage,
		updateSourceLanguage,
		targetLanguage,
		updateTargetLanguage,
		engineOrder,
		updateEngineOrder,
	} = useTranslationRequest();
	const { sourceLanguageOptions, targetLanguageOptions } = useLanguageOptions();

	const moveEngine = (index: number, dir: -1 | 1) => {
		const target = index + dir;
		if (target < 0 || target >= engineOrder.length) return;
		const next = [...engineOrder];
		[next[index], next[target]] = [next[target], next[index]];
		updateEngineOrder(next);
	};

	return (
		<>
			<Row gutter={token.marginLG}>
				<Col span={12}>
					<ProForm.Item
						layout="vertical"
						label={<FormattedMessage id="tools.translation.sourceLanguage" />}
					>
						<Select
							value={sourceLanguage}
							onChange={(value) => updateSourceLanguage(value)}
							options={sourceLanguageOptions}
							styles={{
								popup: {
									root: {
										minWidth: 200,
									},
								},
							}}
						/>
					</ProForm.Item>
				</Col>
				<Col span={12}>
					<ProForm.Item
						layout="vertical"
						label={<FormattedMessage id="tools.translation.targetLanguage" />}
					>
						<Select
							value={targetLanguage}
							onChange={(value) => updateTargetLanguage(value)}
							options={targetLanguageOptions}
							styles={{
								popup: {
									root: {
										minWidth: 200,
									},
								},
							}}
						/>
					</ProForm.Item>
				</Col>
			</Row>
			<ProForm.Item
				layout="vertical"
				label={
					<span>
						<FormattedMessage id="settings.functionSettings.translationSettings.engineOrder" />
						<Typography.Text type="secondary" style={{ marginLeft: token.marginXS }}>
							<FormattedMessage id="settings.functionSettings.translationSettings.engineOrder.tip" />
						</Typography.Text>
					</span>
				}
			>
				<List
					size="small"
					bordered
					style={{ maxWidth: 360 }}
					dataSource={engineOrder ?? [...TRANSLATE_ENGINE_KEYS]}
					renderItem={(engine, index) => (
						<List.Item
							actions={[
								<Tooltip
									key="up"
									title={
										<FormattedMessage id="settings.functionSettings.translationSettings.engineOrder.moveUp" />
									}
								>
									<Button
										type="text"
										size="small"
										icon={<ArrowUpOutlined />}
										disabled={index === 0}
										onClick={() => moveEngine(index, -1)}
									/>
								</Tooltip>,
								<Tooltip
									key="down"
									title={
										<FormattedMessage id="settings.functionSettings.translationSettings.engineOrder.moveDown" />
									}
								>
									<Button
										type="text"
										size="small"
										icon={<ArrowDownOutlined />}
										disabled={
											index === (engineOrder ?? [...TRANSLATE_ENGINE_KEYS]).length - 1
										}
										onClick={() => moveEngine(index, 1)}
									/>
								</Tooltip>,
							]}
						>
							{`${index + 1}. ${intl.formatMessage({ id: ENGINE_LABEL_KEYS[engine] ?? engine })}`}
						</List.Item>
					)}
				/>
			</ProForm.Item>
		</>
	);
};
