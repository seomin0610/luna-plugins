import React from "react";

import { LunaNumberSetting, LunaSettings, LunaSwitchSetting } from "@luna/ui";

import { storage } from ".";

type SwitchHandler = (event: React.ChangeEvent<HTMLInputElement>, checked?: boolean) => void;

export const Settings = () => {
	const [enabled, setEnabled] = React.useState(storage.enabled);
	const [useItunes, setUseItunes] = React.useState(storage.useItunes);
	const [useMusicBrainz, setUseMusicBrainz] = React.useState(storage.useMusicBrainz);
	const [useKomca, setUseKomca] = React.useState(storage.useKomca);
	const [maxResults, setMaxResults] = React.useState(storage.maxResults);

	const onEnabled: SwitchHandler = (_, checked) => setEnabled((storage.enabled = checked ?? false));
	const onItunes: SwitchHandler = (_, checked) => setUseItunes((storage.useItunes = checked ?? false));
	const onMusicBrainz: SwitchHandler = (_, checked) => setUseMusicBrainz((storage.useMusicBrainz = checked ?? false));
	const onKomca: SwitchHandler = (_, checked) => setUseKomca((storage.useKomca = checked ?? false));
	const onMaxResults = (num: number) => setMaxResults((storage.maxResults = num));

	return (
		<LunaSettings title="KoreanSearch">
			<LunaSwitchSetting
				title="Enable"
				desc="검색어에 한글이 들어있으면 원곡을 찾아 검색결과 맨 위에 따로 표시합니다."
				checked={enabled}
				onChange={onEnabled}
			/>
			<LunaSwitchSetting
				title="Apple Music"
				desc="한국/미국 스토어의 제목을 대조해 국제 발매명을 알아냅니다. 가장 넓습니다."
				checked={useItunes}
				onChange={onItunes}
			/>
			<LunaSwitchSetting
				title="MusicBrainz"
				desc="MusicBrainz에서 한국어 제목으로 녹음을 찾습니다. ISRC가 있으면 정확히 매칭됩니다."
				checked={useMusicBrainz}
				onChange={onMusicBrainz}
			/>
			<LunaSwitchSetting
				title="KOMCA (한국음악저작권협회)"
				desc="MusicBrainz에서 못 찾았을 때만 사용합니다. 부제목에 등록된 영문 제목으로 TIDAL을 검색합니다."
				checked={useKomca}
				onChange={onKomca}
			/>
			<LunaNumberSetting title="최대 표시 곡수" desc="한국어 검색 결과 섹션에 보여줄 곡 수입니다." min={1} max={25} value={maxResults} onNumber={onMaxResults} />
		</LunaSettings>
	);
};
