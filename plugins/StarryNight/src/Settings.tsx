import React from "react";

import { LunaSelectItem, LunaSelectSetting, LunaSettings, LunaSwitchSetting } from "@luna/ui";

import { PALETTES, type PaletteName, render, storage } from ".";

type SelectEvent = { target: { value: unknown } };

export const Settings = () => {
	const [enabled, setEnabled] = React.useState(storage.enabled);
	const [palette, setPalette] = React.useState(storage.palette);
	const [nowPlayingSky, setNowPlayingSky] = React.useState(storage.nowPlayingSky);

	return (
		<LunaSettings title="StarryNight">
			<LunaSwitchSetting
				title="Enable"
				desc="Starry-sky background with twinkling stars and shooting stars."
				checked={enabled}
				onChange={(_: React.ChangeEvent<HTMLInputElement>, checked?: boolean) => {
					const next = checked ?? false;
					setEnabled((storage.enabled = next));
					render();
				}}
			/>
			<LunaSelectSetting
				title="Palette"
				desc="Colour theme for the sky and stars."
				value={palette}
				onChange={(event: SelectEvent) => {
					const next = String(event.target.value) as PaletteName;
					setPalette((storage.palette = next));
					render();
				}}
			>
				{Object.keys(PALETTES).map((name) => (
					<LunaSelectItem key={name} value={name}>
						{name}
					</LunaSelectItem>
				))}
			</LunaSelectSetting>
			<LunaSwitchSetting
				title="Apply to now-playing view"
				desc="Hides the album-art backdrop in the now-playing / lyrics panel so the sky shows there too."
				checked={nowPlayingSky}
				onChange={(_: React.ChangeEvent<HTMLInputElement>, checked?: boolean) => {
					const next = checked ?? false;
					setNowPlayingSky((storage.nowPlayingSky = next));
					render();
				}}
			/>
		</LunaSettings>
	);
};
