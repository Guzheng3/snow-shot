import { ProForm } from "@ant-design/pro-components";
import { Col, Row, Select, theme } from "antd";
import { FormattedMessage } from "react-intl";
import { useLanguageOptions } from "@/components/translator";
import { useTranslationRequest } from "@/core/translations";

export const TranslationConfig = () => {
	const { token } = theme.useToken();

	const {
		sourceLanguage,
		updateSourceLanguage,
		targetLanguage,
		updateTargetLanguage,
	} = useTranslationRequest();
	const { sourceLanguageOptions, targetLanguageOptions } = useLanguageOptions();

	return (
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
	);
};
