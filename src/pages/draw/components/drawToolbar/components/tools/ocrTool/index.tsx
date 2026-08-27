import { Button } from "antd";
import { useCallback, useState } from "react";
import { useIntl } from "react-intl";
import { DrawStatePublisher } from "@/components/drawCore/extra";
import { OcrTranslateIcon } from "@/components/icons";
import { useStateSubscriber } from "@/hooks/useStateSubscriber";
import {
	type AppOcrResult,
	OcrResultType,
} from "@/pages/fixedContent/components/ocrResult";
import { DrawState } from "@/types/draw";
import { SubTools } from "../../subTools";
import { OcrToolModalSettings } from "./components/ocrToolModalSettings";

export const isOcrTool = (drawState: DrawState) => {
	return (
		drawState === DrawState.OcrDetect || drawState === DrawState.OcrTranslate
	);
};

const OcrTool: React.FC<{
	onSwitchOcrResult: (ocrResultType: OcrResultType) => void;
	onTranslate: () => void;
	currentOcrResult:
		| (AppOcrResult & { ocrResultType: OcrResultType })
		| undefined;
	ocrResult: AppOcrResult | undefined;
	translatedOcrResult: AppOcrResult | undefined;
	translateLoading: boolean;
}> = ({
	onSwitchOcrResult,
	onTranslate,
	currentOcrResult,
	ocrResult,
	translatedOcrResult,
	translateLoading,
}) => {
	const intl = useIntl();

	const [enabled, setEnabled] = useState(false);

	useStateSubscriber(
		DrawStatePublisher,
		useCallback((drawState: DrawState) => {
			if (isOcrTool(drawState)) {
				setEnabled(true);
			} else {
				setEnabled(false);
			}
		}, []),
	);

	if (!enabled) {
		return null;
	}

	return (
		<SubTools
			buttons={[
				<Button
					disabled={!currentOcrResult}
					loading={translateLoading}
					onClick={() => {
						if (ocrResult) {
							if (translatedOcrResult) {
								onSwitchOcrResult(
									currentOcrResult?.ocrResultType ===
										OcrResultType.Translated
										? OcrResultType.Ocr
										: OcrResultType.Translated,
								);
							} else {
								onTranslate();
							}
						}
					}}
					type={
						currentOcrResult?.ocrResultType === OcrResultType.Translated
							? "primary"
							: "text"
					}
					icon={<OcrTranslateIcon />}
					title={intl.formatMessage({ id: "draw.ocrDetect.translate" })}
					key="translate"
				/>,
				<OcrToolModalSettings
					key="ocrToolModalSettings"
					onFinish={async () => {
						onTranslate();
						return;
					}}
				/>,
			]}
		/>
	);
};

export default OcrTool;
