import { useCallback, useState } from "react";
import { DrawStatePublisher } from "@/components/drawCore/extra";
import { useStateSubscriber } from "@/hooks/useStateSubscriber";
import { DrawState } from "@/types/draw";
import { SubTools } from "../../subTools";
import { OcrToolModalSettings } from "./components/ocrToolModalSettings";

export const isOcrTool = (drawState: DrawState) => {
	return drawState === DrawState.OcrDetect;
};

const OcrTool: React.FC = () => {
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
				<OcrToolModalSettings
					key="ocrToolModalSettings"
					onFinish={async () => {
						return;
					}}
				/>,
			]}
		/>
	);
};

export default OcrTool;
