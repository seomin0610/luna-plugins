import React from "react";

import { LunaSettings, LunaSwitchSetting, LunaTextSetting } from "@luna/ui";
import { getPlaybackDebugState, storage, subscribePlaybackDebugState } from ".";

export const Settings = () => {
	const [enabled, setEnabled] = React.useState(storage.enabled);
	const [testMode, setTestMode] = React.useState(storage.testMode);
	const [debugState, setDebugState] = React.useState(getPlaybackDebugState());

	React.useEffect(() => subscribePlaybackDebugState(() => setDebugState(getPlaybackDebugState())), []);

	const onToggleEnabled = React.useCallback((_: React.ChangeEvent<HTMLInputElement>, checked?: boolean) => {
		const next = checked ?? false;
		setEnabled(next);
		storage.enabled = next;
	}, []);

	const onToggleTestMode = React.useCallback((_: React.ChangeEvent<HTMLInputElement>, checked?: boolean) => {
		const next = checked ?? false;
		setTestMode(next);
		storage.testMode = next;
	}, []);

	return (
		<LunaSettings title="Hunminjeongeum">
			<LunaSwitchSetting
				title="Enable"
				desc="한글 제목 자동 변환 기능을 켭니다."
				checked={enabled}
				onChange={onToggleEnabled}
			/>
			<LunaSwitchSetting
				title="Test Mode"
				desc="현재 재생 중인 곡의 ISRC를 설정 화면에 표시합니다."
				checked={testMode}
				onChange={onToggleTestMode}
			/>
			<LunaTextSetting
				title="현재 재생 ISRC"
				desc="테스트 모드가 꺼져 있으면 값이 숨겨집니다."
				value={testMode ? debugState.isrc || "-" : "테스트 모드를 켜면 표시됩니다"}
				InputProps={{ readOnly: true }}
			/>
			<LunaTextSetting
				title="한글화 상태"
				desc="현재 재생 곡이 플러그인에 의해 한글화됐는지 표시합니다."
				value={debugState.localized ? "한글화됨" : "미적용"}
				InputProps={{ readOnly: true }}
			/>
		</LunaSettings>
	);
};
