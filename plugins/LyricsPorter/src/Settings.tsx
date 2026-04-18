import React from "react";

import type { SelectChangeEvent } from "@mui/material/Select";
import { LunaNumberSetting, LunaSelectItem, LunaSelectSetting, LunaSettings, LunaSwitchSetting, LunaTextSetting } from "@luna/ui";
import type { OutputMode } from ".";
import { startLyricsServer, startMetadataPorter, stopLyricsServer, stopMetadataPorter, storage } from ".";

const clampPort = (value: number) => Math.min(65535, Math.max(1, value));

export const Settings = () => {
	const [enabled, setEnabled] = React.useState(storage.enabled);
	const [port, setPort] = React.useState(storage.port);
	const [metadataPort, setMetadataPort] = React.useState(storage.metadataPort);
	const [outputMode, setOutputMode] = React.useState<OutputMode>(storage.outputMode);
	const [udpHost, setUdpHost] = React.useState(storage.udpHost);

	const applyPort = React.useCallback(
		async (value: number) => {
			const next = clampPort(value);
			setPort(next);
			storage.port = next;
			if (storage.enabled) {
				await startLyricsServer();
				setPort(storage.port);
			}
		},
		[setPort],
	);

	const onToggle = React.useCallback(async (_: React.ChangeEvent<HTMLInputElement>, checked?: boolean) => {
		const next = checked ?? false;
		setEnabled(next);
		storage.enabled = next;
		if (next) {
			await startLyricsServer();
			await startMetadataPorter();
			setPort(storage.port);
			setMetadataPort(storage.metadataPort);
		} else {
			await stopLyricsServer();
			await stopMetadataPorter();
		}
	}, []);

	const applyMetadataPort = React.useCallback(
		async (value: number) => {
			const next = clampPort(value);
			setMetadataPort(next);
			storage.metadataPort = next;
			if (storage.enabled) {
				await startMetadataPorter();
				setMetadataPort(storage.metadataPort);
			}
		},
		[setMetadataPort],
	);

	const onOutputModeChange = React.useCallback(
		async (event: SelectChangeEvent<OutputMode>) => {
			const next = event.target.value as OutputMode;
			setOutputMode(next);
			storage.outputMode = next;
			if (storage.enabled) await startLyricsServer();
		},
		[setOutputMode],
	);

	const onUdpHostChange = React.useCallback(
		async (event: React.ChangeEvent<HTMLInputElement>) => {
			const next = event.target.value.trim() || "127.0.0.1";
			setUdpHost(next);
			storage.udpHost = next;
			if (storage.enabled && storage.outputMode === "udp") await startLyricsServer();
		},
		[setUdpHost],
	);

	return (
		<>
			<LunaSettings title="LyricsPorter">
				<LunaSwitchSetting
					title="Enable Server"
					desc="Expose the current lyric line on a local HTTP port."
					checked={enabled}
					onChange={onToggle}
				/>
				<LunaNumberSetting
					title="Port"
					desc="Port used by the selected output mode."
					min={1}
					max={65535}
					value={port}
					disabled={!enabled}
					onNumber={applyPort}
				/>
				<LunaNumberSetting
					title="Metadata Port"
					desc="Separate HTTP port used for track metadata."
					min={1}
					max={65535}
					value={metadataPort}
					disabled={!enabled}
					onNumber={applyMetadataPort}
				/>
				<LunaSelectSetting
					title="Output"
					desc="Choose how the current lyric line is exported."
					value={outputMode}
					disabled={!enabled}
					onChange={onOutputModeChange}
				>
					<LunaSelectItem value="http">HTTP (Browser/SSE)</LunaSelectItem>
					<LunaSelectItem value="tcp">TCP Server</LunaSelectItem>
					<LunaSelectItem value="udp">UDP Send</LunaSelectItem>
				</LunaSelectSetting>
				{outputMode === "udp" && (
					<LunaTextSetting
						title="UDP Host"
						desc="Destination host for UDP packets."
						value={udpHost}
						disabled={!enabled}
						onChange={onUdpHostChange}
					/>
				)}
				<LunaTextSetting
					title={outputMode === "http" ? "URL" : "Target"}
					desc={
						outputMode === "http"
							? "Open this in a browser or OBS browser source."
							: "Use this address in your TCP/UDP client."
					}
					value={
						outputMode === "udp"
							? `udp://${udpHost}:${port}`
							: outputMode === "tcp"
								? `tcp://127.0.0.1:${port}`
								: `http://127.0.0.1:${port}`
					}
					InputProps={{ readOnly: true }}
				/>
				<LunaTextSetting
					title="Metadata URL"
					desc="JSON metadata (title, artist, max lyric length, next lyric length)."
					value={`http://127.0.0.1:${metadataPort}/metadata.json`}
					InputProps={{ readOnly: true }}
				/>
			</LunaSettings>
		</>
	);
};
