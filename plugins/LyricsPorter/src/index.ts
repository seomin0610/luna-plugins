import { ReactiveStore, type LunaUnload, Tracer } from "@luna/core";
import { MediaItem, PlayState } from "@luna/lib";

import {
	setLyrics,
	setMetadata,
	startMetadataServer,
	startServer,
	stopMetadataServer,
	stopServer,
	type LyricsMetadata,
} from "./lyricsServer.native";

export const { trace } = Tracer("[LyricsPorter]");

export const unloads = new Set<LunaUnload>();

export type OutputMode = "http" | "tcp" | "udp";

export type LyricsPorterStorage = {
	enabled: boolean;
	port: number;
	metadataPort: number;
	outputMode: OutputMode;
	udpHost: string;
};

const defaultStorage: LyricsPorterStorage = {
	enabled: true,
	port: 1608,
	metadataPort: 1609,
	outputMode: "http",
	udpHost: "127.0.0.1",
};

export let storage: LyricsPorterStorage = { ...defaultStorage };

const loadStorage = async () => {
	try {
		const saved = await ReactiveStore.getPluginStorage<Partial<LyricsPorterStorage>>("LyricsPorter", defaultStorage);
		storage = {
			...defaultStorage,
			...saved,
		};
	} catch (err) {
		trace.err.withContext("getPluginStorage")(err);
		storage = { ...defaultStorage };
	}
};

await loadStorage();

let lastLyric = "";
let lastMetadata: LyricsMetadata = {
	title: "",
	artist: "",
	maxLyricLength: 0,
	nextLyricLength: 0,
};
let updateQueued = false;
let timedLines: { time: number; text: string }[] = [];
let lastTimedIndex = -1;

const normalizeLyric = (value?: string | null) => (value ?? "").replace(/\u00a0/g, " ").trim();

type TrackArtist = { name?: string | null };
type TrackLike = {
	title?: string | null;
	artist?: TrackArtist | null;
	artists?: TrackArtist[] | null;
};

const normalizePlainLines = (raw: string) =>
	raw
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.split(/\r?\n/)
		.map((line) => normalizeLyric(line))
		.filter((line) => line.length > 0);

const extractLyricLines = (raw?: string | null) => {
	if (!raw) return [];
	const trimmed = raw.trim();
	if (!trimmed) return [];
	const timed = normalizeTimedLines(parseTimedLyrics(trimmed))
		.map((line) => line.text)
		.filter((line) => line.length > 0);
	if (timed.length > 0) return timed;
	return normalizePlainLines(trimmed);
};

const getMaxLyricLength = (...rawValues: Array<string | null | undefined>) => {
	let maxLength = 0;
	for (const raw of rawValues) {
		const lines = extractLyricLines(raw);
		for (const line of lines) {
			if (line.length > maxLength) maxLength = line.length;
		}
	}
	return maxLength;
};

const getTrackArtistName = (track?: TrackLike) => {
	const list = (track?.artists ?? [])
		.map((artist) => normalizeLyric(artist?.name))
		.filter((name) => name.length > 0);
	if (list.length > 0) return list.join(", ");
	return normalizeLyric(track?.artist?.name);
};

const pushMetadata = (value: LyricsMetadata) => {
	const next: LyricsMetadata = {
		title: normalizeLyric(value?.title),
		artist: normalizeLyric(value?.artist),
		maxLyricLength: Math.max(0, Math.trunc(value?.maxLyricLength ?? 0)),
		nextLyricLength: Math.max(0, Math.trunc(value?.nextLyricLength ?? 0)),
	};
	if (
		next.title === lastMetadata.title &&
		next.artist === lastMetadata.artist &&
		next.maxLyricLength === lastMetadata.maxLyricLength &&
		next.nextLyricLength === lastMetadata.nextLyricLength
	)
		return;
	lastMetadata = next;
	if (!storage.enabled) return;
	try {
		setMetadata(next);
	} catch (err) {
		trace.err.withContext("setMetadata")(err);
	}
};

const parseTimeToSeconds = (value: string) => {
	const trimmed = value.trim().replace(",", ".");
	if (!trimmed) return null;
	if (/^\\d+(?:\\.\\d+)?s$/.test(trimmed)) return Number.parseFloat(trimmed.replace("s", ""));

	const parts = trimmed.split(":").map((part) => part.trim());
	if (parts.length === 0) return null;

	let seconds = 0;
	if (parts.length === 1) {
		const num = Number.parseFloat(parts[0]);
		return Number.isNaN(num) ? null : num;
	}
	if (parts.length === 2) {
		const minutes = Number.parseInt(parts[0], 10);
		const secs = Number.parseFloat(parts[1]);
		if (Number.isNaN(minutes) || Number.isNaN(secs)) return null;
		seconds = minutes * 60 + secs;
		return seconds;
	}
	if (parts.length >= 3) {
		const hours = Number.parseInt(parts[parts.length - 3], 10);
		const minutes = Number.parseInt(parts[parts.length - 2], 10);
		const secs = Number.parseFloat(parts[parts.length - 1]);
		if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(secs)) return null;
		seconds = hours * 3600 + minutes * 60 + secs;
		return seconds;
	}
	return null;
};

const parseTimedFromLrc = (raw: string) => {
	const lines: { time: number; text: string }[] = [];
	const rows = raw.split(/\r?\n/);
	for (const row of rows) {
		const matches = [...row.matchAll(/\[(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)\]/g)];
		if (matches.length === 0) continue;
		const text = row.replace(/\[.*?\]/g, "").trim();
		for (const match of matches) {
			const time = parseTimeToSeconds(match[1]);
			if (time === null) continue;
			lines.push({ time, text });
		}
	}
	return lines;
};

const parseTimedFromTtml = (raw: string) => {
	const lines: { time: number; text: string }[] = [];
	try {
		const doc = new DOMParser().parseFromString(raw, "text/xml");
		const nodes = Array.from(doc.getElementsByTagName("p"));
		for (const node of nodes) {
			const begin = node.getAttribute("begin") ?? node.getAttribute("start") ?? node.getAttribute("data-begin");
			if (!begin) continue;
			const time = parseTimeToSeconds(begin);
			if (time === null) continue;
			const text = (node.textContent ?? "").trim();
			lines.push({ time, text });
		}
	} catch {
		return [];
	}
	return lines;
};

const parseTimedFromJson = (data: any) => {
	const lines: { time: number; text: string }[] = [];
	const readEntry = (entry: any) => {
		if (!entry) return;
		const text = entry.text ?? entry.line ?? entry.lyric ?? entry.value ?? entry.content;
		if (text === undefined || text === null || typeof text !== "string") return;
		const rawTime = entry.time ?? entry.start ?? entry.begin ?? entry.startTime ?? entry.timestamp ?? entry.timeMs ?? entry.startTimeMs;
		let time: number | null = null;
		if (typeof rawTime === "number") time = rawTime > 1000 ? rawTime / 1000 : rawTime;
		if (typeof rawTime === "string") time = parseTimeToSeconds(rawTime);
		if (time === null || Number.isNaN(time)) return;
		lines.push({ time, text: text.trim() });
	};

	if (Array.isArray(data)) {
		data.forEach(readEntry);
		return lines;
	}
	if (Array.isArray(data?.lines)) {
		data.lines.forEach(readEntry);
		return lines;
	}
	if (Array.isArray(data?.lyrics)) {
		data.lyrics.forEach(readEntry);
		return lines;
	}
	return lines;
};

const parseTimedLyrics = (raw?: string | null) => {
	if (!raw) return [];
	const trimmed = raw.trim();
	if (!trimmed) return [];

	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			const data = JSON.parse(trimmed);
			const parsed = parseTimedFromJson(data);
			if (parsed.length) return parsed;
		} catch {
			// 무시
		}
	}
	if (/<tt|<body|<p[\s>]/i.test(trimmed)) {
		const parsed = parseTimedFromTtml(trimmed);
		if (parsed.length) return parsed;
	}
	if (/\[\d{1,2}:\d{2}/.test(trimmed)) {
		const parsed = parseTimedFromLrc(trimmed);
		if (parsed.length) return parsed;
	}
	return [];
};

const normalizeTimedLines = (lines: { time: number; text: string }[]) =>
	lines
		.map((line) => ({ time: line.time, text: normalizeLyric(line.text) }))
		.filter((line) => Number.isFinite(line.time))
		.sort((a, b) => a.time - b.time);

const LONG_GAP_THRESHOLD = 6;
const MAX_HOLD_SECONDS = 3;

const getTimedLyric = () => {
	if (timedLines.length === 0) return "";
	const currentTime = PlayState.currentTime ?? 0;
	if (currentTime < timedLines[0].time) return "";
	if (currentTime >= timedLines[timedLines.length - 1].time) return timedLines[timedLines.length - 1].text;

	let low = 0;
	let high = timedLines.length - 1;
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const midTime = timedLines[mid].time;
		if (midTime === currentTime) {
			lastTimedIndex = mid;
			return timedLines[mid].text;
		}
		if (midTime < currentTime) low = mid + 1;
		else high = mid - 1;
	}
	const idx = Math.max(0, low - 1);
	lastTimedIndex = idx;
	const current = timedLines[idx];
	const next = timedLines[idx + 1];
	if (!current) return "";
	if (current.text === "") return "";
	if (!next) return current.text;

	const gap = next.time - current.time;
	if (gap >= LONG_GAP_THRESHOLD) {
		const holdUntil = Math.min(current.time + MAX_HOLD_SECONDS, next.time - 0.1);
		if (currentTime > holdUntil) return "";
	}
	return current.text;
};

const getNextLyricLength = () => {
	if (timedLines.length === 0) return 0;
	const currentTime = PlayState.currentTime ?? 0;
	for (const line of timedLines) {
		if (line.time <= currentTime) continue;
		if (!line.text) continue;
		return line.text.length;
	}
	return 0;
};

const loadTimedLyrics = async (mediaItem?: MediaItem) => {
	try {
		const item = mediaItem ?? (await MediaItem.fromPlaybackContext());
		const track = item?.tidalItem as TrackLike | undefined;
		let subtitleRaw = "";
		let lyricRaw = "";
		try {
			const lyricData = await item?.lyrics();
			subtitleRaw = lyricData?.subtitles ?? "";
			lyricRaw = lyricData?.lyrics ?? "";
		} catch (err) {
			trace.warn.withContext("loadTimedLyrics.lyrics")(err);
		}
		const timedRaw = subtitleRaw || lyricRaw;
		const parsed = normalizeTimedLines(parseTimedLyrics(timedRaw));
		timedLines = parsed;
		lastTimedIndex = -1;
		pushMetadata({
			title: normalizeLyric(track?.title),
			artist: getTrackArtistName(track),
			maxLyricLength: getMaxLyricLength(subtitleRaw, lyricRaw),
			nextLyricLength: getNextLyricLength(),
		});
		// 타이밍가사없? dom에 없으면 그냥 빈칸으로 표시
	} catch (err) {
		trace.err.withContext("loadTimedLyrics")(err);
		timedLines = [];
		lastTimedIndex = -1;
		pushMetadata({
			title: "",
			artist: "",
			maxLyricLength: 0,
			nextLyricLength: 0,
		});
	}
};

const scoreCurrentLine = (el: HTMLElement, includeTabIndex: boolean) => {
	let score = 0;
	const className = (el.getAttribute("class") ?? "").toLowerCase();
	if (className.includes("__current") || className.includes("current")) score += 5;
	if (className.includes("active") || className.includes("playing") || className.includes("focus") || className.includes("selected")) score += 3;

	const ariaCurrent = el.getAttribute("aria-current");
	if (ariaCurrent !== null && ariaCurrent !== "false") score += 4;
	const ariaSelected = el.getAttribute("aria-selected");
	if (ariaSelected !== null && ariaSelected !== "false") score += 3;

	const dataCurrent =
		el.getAttribute("data-current") ?? el.getAttribute("data-state") ?? el.getAttribute("data-status") ?? el.getAttribute("data-active");
	if (dataCurrent && /current|active|playing|selected/i.test(dataCurrent)) score += 3;

	if (includeTabIndex) {
		const tabIndex = el.getAttribute("tabindex");
		if (tabIndex === "0") score += 2;
		else if (tabIndex && tabIndex !== "-1") score += 1;
	}

	return score;
};

const findLyricsContainer = (lines: HTMLElement[]) => {
	if (lines.length === 0) return null;
	let candidate: HTMLElement | null = null;
	let candidateCount = 0;

	let node = lines[0].parentElement;
	while (node && node !== document.body) {
		const rect = node.getBoundingClientRect();
		const count = node.querySelectorAll("[data-test='lyrics-line']").length;
		if (count >= candidateCount && rect.height > 0) {
			candidate = node;
			candidateCount = count;
		}
		const style = window.getComputedStyle(node);
		if ((style.overflowY === "auto" || style.overflowY === "scroll") && rect.height > 0) return node;
		if (node.scrollHeight > node.clientHeight + 1 && rect.height > 0) return node;
		node = node.parentElement;
	}
	return candidate ?? document.body;
};

const pickClosestToCenter = (lines: HTMLElement[], container: HTMLElement | null) => {
	const containerRect = container?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight, height: window.innerHeight };
	const centerY = containerRect.top + containerRect.height / 2;
	let best: HTMLElement | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	let bestOpacity = -1;
	let bestWeight = -1;

	for (const line of lines) {
		const rect = line.getBoundingClientRect();
		if (rect.height === 0) continue;
		const visible = rect.bottom >= containerRect.top && rect.top <= containerRect.bottom;
		if (!visible) continue;
		const distance = Math.abs(rect.top + rect.height / 2 - centerY);

		const style = window.getComputedStyle(line);
		const opacity = Number.parseFloat(style.opacity || "1");
		const fontWeight = Number.parseInt(style.fontWeight || "400", 10) || 400;

		if (distance < bestDistance - 0.5) {
			best = line;
			bestDistance = distance;
			bestOpacity = opacity;
			bestWeight = fontWeight;
			continue;
		}
		if (Math.abs(distance - bestDistance) <= 0.5) {
			if (opacity > bestOpacity + 0.05 || (opacity >= bestOpacity && fontWeight > bestWeight)) {
				best = line;
				bestOpacity = opacity;
				bestWeight = fontWeight;
			}
		}
	}

	if (best) return best;
	// 대안이긴한데 거리기준으로 가장 가까운 것 표시
	for (const line of lines) {
		const rect = line.getBoundingClientRect();
		const distance = Math.abs(rect.top + rect.height / 2 - centerY);
		if (distance < bestDistance) {
			best = line;
			bestDistance = distance;
		}
	}
	return best;
};

const findCurrentLine = () => {
	const lines = Array.from(document.querySelectorAll<HTMLElement>("[data-test='lyrics-line']"));
	if (lines.length === 0) return null;

	// 일치하는 항목 우선
	const direct = document.querySelector<HTMLElement>(
		"[data-test='lyrics-line'][class*='__current'], [data-test='lyrics-line'][class*='current'], [data-test='lyrics-line'][aria-current], [data-test='lyrics-line'][aria-selected], [data-test='lyrics-line'][data-current], [data-test='lyrics-line'][data-state], [data-test='lyrics-line'][data-status], [data-test='lyrics-line'][data-active]",
	);
	if (direct) return direct;

	// 위로이동
	const nestedCurrent = document.querySelector<HTMLElement>(
		"[data-test='lyrics-line'] [class*='__current'], [data-test='lyrics-line'] [class*='current'], [data-test='lyrics-line'] [aria-current], [data-test='lyrics-line'] [aria-selected], [data-test='lyrics-line'] [data-current], [data-test='lyrics-line'] [data-state], [data-test='lyrics-line'] [data-status], [data-test='lyrics-line'] [data-active]",
	);
	if (nestedCurrent) {
		const closest = nestedCurrent.closest<HTMLElement>("[data-test='lyrics-line']");
		if (closest) return closest;
	}

	// 점수가가장높은행선택
	let best: HTMLElement | null = null;
	let bestScore = 0;
	const includeTabIndex = !lines.every((line) => line.getAttribute("tabindex") === "0" || line.getAttribute("tabindex") === null);
	for (const line of lines) {
		const score = scoreCurrentLine(line, includeTabIndex);
		if (score > bestScore) {
			bestScore = score;
			best = line;
		}
	}
	if (bestScore > 0) return best;

	// 중심가까운선 선택
	const container = findLyricsContainer(lines);
	return pickClosestToCenter(lines, container);
};

const pushLyric = async (value?: string | null) => {
	const next = normalizeLyric(value);
	if (next === lastLyric) return;
	lastLyric = next;
	if (!storage.enabled) return;
	try {
		await setLyrics(next);
	} catch (err) {
		trace.err.withContext("setLyrics")(err);
	}
};

const readCurrentLine = () => {
	pushMetadata({
		...lastMetadata,
		nextLyricLength: getNextLyricLength(),
	});
	if (!PlayState.playing) return pushLyric("");
	if (timedLines.length > 0) return pushLyric(getTimedLyric());
	const currentLine = findCurrentLine();
	if (!currentLine) return pushLyric("");
	const domLyric = normalizeLyric(currentLine.textContent);
	if (domLyric) return pushLyric(domLyric);
	return pushLyric("");
};

const scheduleRead = () => {
	if (updateQueued) return;
	updateQueued = true;
	requestAnimationFrame(() => {
		updateQueued = false;
		readCurrentLine();
	});
};

const observer = new MutationObserver(scheduleRead);
const startObserver = () => {
	if (!document.body) return;
	observer.observe(document.body, {
		subtree: true,
		childList: true,
		attributes: true,
		characterData: true,
		attributeFilter: ["class", "aria-current", "aria-selected", "tabindex", "data-current", "data-state", "data-status", "data-active"],
	});
};
if (document.body) {
	startObserver();
} else {
	const onReady = () => startObserver();
	window.addEventListener("DOMContentLoaded", onReady, { once: true });
	unloads.add(() => window.removeEventListener("DOMContentLoaded", onReady));
}
unloads.add(() => observer.disconnect());

const pollId = window.setInterval(readCurrentLine, 250);
unloads.add(() => window.clearInterval(pollId));

export const startLyricsServer = async () => {
	if (!storage.enabled) return;
	try {
		const actualPort = await startServer(storage.outputMode, storage.port, storage.udpHost);
		if (storage.port !== actualPort) storage.port = actualPort;
		const target = storage.outputMode === "udp" ? storage.udpHost : "127.0.0.1";
		const protocol = storage.outputMode === "http" ? "http" : storage.outputMode;
		trace.msg.log(`LyricsPorter output ready: ${protocol}://${target}:${actualPort}`);
		await setLyrics(lastLyric);
	} catch (err) {
		trace.err.withContext("startLyricsServer")(err);
	}
};

export const stopLyricsServer = async () => {
	try {
		await stopServer();
	} catch (err) {
		trace.err.withContext("stopLyricsServer")(err);
	}
};

export const startMetadataPorter = async () => {
	if (!storage.enabled) return;
	try {
		const actualPort = await startMetadataServer(storage.metadataPort);
		if (storage.metadataPort !== actualPort) storage.metadataPort = actualPort;
		trace.msg.log(`LyricsPorter metadata ready: http://127.0.0.1:${actualPort}`);
		setMetadata(lastMetadata);
	} catch (err) {
		trace.err.withContext("startMetadataPorter")(err);
	}
};

export const stopMetadataPorter = async () => {
	try {
		await stopMetadataServer();
	} catch (err) {
		trace.err.withContext("stopMetadataPorter")(err);
	}
};
unloads.add(stopLyricsServer);
unloads.add(stopMetadataPorter);

await startLyricsServer();
await startMetadataPorter();
await loadTimedLyrics();
readCurrentLine();

MediaItem.onMediaTransition(unloads, async () => {
	await loadTimedLyrics();
	await pushLyric("");
	scheduleRead();
});

export { Settings } from "./Settings";
