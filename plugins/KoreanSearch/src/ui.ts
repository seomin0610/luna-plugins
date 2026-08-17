import type { LunaUnloads } from "@luna/core";
import { MediaItem, observe, redux, StyleTag } from "@luna/lib";

import type { KoreanSource, ResolvedTrack } from "./resolve";
import { trace } from "./trace";

const ROOT_ID = "luna-korean-search";

export type SectionState =
	| { kind: "hidden" }
	| { kind: "loading"; phrase: string }
	| { kind: "results"; phrase: string; tracks: ResolvedTrack[] };

let state: SectionState = { kind: "hidden" };
let root: HTMLElement | undefined;

const css = `
#${ROOT_ID} {
	--ks-line: rgba(255, 255, 255, 0.09);
	--ks-ink: rgba(255, 255, 255, 0.95);
	--ks-dim: rgba(255, 255, 255, 0.52);
	--ks-faint: rgba(255, 255, 255, 0.26);
	--ks-accent: #6fd3b4;
	--ks-ko: "Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif;
	--ks-num: ui-monospace, "SF Mono", Menlo, Consolas, monospace;

	display: block;
	margin: 24px 0 28px 0;
	position: relative;
	padding: 14px 16px 10px;
	border: 1px solid var(--ks-line);
	border-radius: 10px;
	background: rgba(255, 255, 255, 0.016);
}

#${ROOT_ID} .ks-head {
	display: flex;
	align-items: center;
	gap: 12px;
	margin-bottom: 8px;
}
#${ROOT_ID} .ks-eyebrow {
	display: flex;
	align-items: center;
	gap: 8px;
	flex: none;
	font-family: var(--ks-ko);
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.04em;
	color: var(--ks-ink);
}
#${ROOT_ID} .ks-eyebrow::before {
	content: "";
	width: 2px;
	height: 12px;
	border-radius: 1px;
	background: var(--ks-accent);
}
#${ROOT_ID} .ks-rule {
	flex: 1;
	height: 1px;
	background: var(--ks-line);
}
#${ROOT_ID} .ks-meta {
	flex: none;
	font-size: 11px;
	color: var(--ks-faint);
	font-variant-numeric: tabular-nums;
}

#${ROOT_ID} .ks-rows {
	display: flex;
	flex-direction: column;
}
#${ROOT_ID} .ks-row {
	display: grid;
	grid-template-columns: 40px minmax(0, 1fr) minmax(0, 0.62fr) 52px;
	align-items: center;
	gap: 14px;
	width: 100%;
	margin: 0 -8px;
	padding: 7px 8px;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
	animation: ks-in 0.28s cubic-bezier(0.2, 0.7, 0.3, 1) both;
}
#${ROOT_ID} .ks-row:hover,
#${ROOT_ID} .ks-row:focus-visible {
	background: rgba(255, 255, 255, 0.055);
}
#${ROOT_ID} .ks-row:focus-visible {
	outline: 1px solid var(--ks-accent);
	outline-offset: -1px;
}
#${ROOT_ID} .ks-art {
	width: 40px;
	height: 40px;
	border-radius: 4px;
	object-fit: cover;
	background: rgba(255, 255, 255, 0.06);
}

#${ROOT_ID} .ks-map {
	display: flex;
	align-items: center;
	gap: 10px;
	min-width: 0;
}
#${ROOT_ID} .ks-ko {
	flex: 0 1 auto;
	min-width: 0;
	font-family: var(--ks-ko);
	font-size: 14px;
	font-weight: 600;
	color: var(--ks-ink);
}
#${ROOT_ID} .ks-la {
	flex: 0 1 auto;
	min-width: 0;
	font-size: 13px;
	color: var(--ks-dim);
}
#${ROOT_ID} .ks-link {
	flex: 1 1 18px;
	min-width: 14px;
	height: 0;
	border-top: 1px solid var(--ks-faint);
}
#${ROOT_ID} .ks-link[data-match="title"] {
	border-top-style: dashed;
}
#${ROOT_ID} .ks-row:hover .ks-link {
	border-color: var(--ks-accent);
}

#${ROOT_ID} .ks-artist {
	min-width: 0;
	font-size: 13px;
	color: var(--ks-dim);
}
#${ROOT_ID} .ks-time {
	font-family: var(--ks-num);
	font-size: 12px;
	color: var(--ks-faint);
	text-align: right;
	font-variant-numeric: tabular-nums;
}

#${ROOT_ID} .ks-ko,
#${ROOT_ID} .ks-la,
#${ROOT_ID} .ks-artist {
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

#${ROOT_ID} .ks-skeleton {
	height: 40px;
	margin: 7px 0;
	border-radius: 8px;
	background: rgba(255, 255, 255, 0.045);
	animation: ks-pulse 1.4s ease-in-out infinite;
}

@keyframes ks-in {
	from {
		opacity: 0;
		transform: translateY(4px);
	}
}
@keyframes ks-pulse {
	50% {
		opacity: 0.45;
	}
}
@media (prefers-reduced-motion: reduce) {
	#${ROOT_ID} .ks-row,
	#${ROOT_ID} .ks-skeleton {
		animation: none;
	}
}
`;

const coverUrl = (track: redux.Track) => {
	const cover = track.album?.cover;
	return cover ? `https://resources.tidal.com/images/${cover.replace(/-/g, "/")}/80x80.jpg` : undefined;
};

const durationText = (seconds?: number) => {
	if (!seconds) return "";
	return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
};

const artistText = (track: redux.Track) =>
	track.artists?.map((artist) => artist.name).join(", ") || track.artist?.name || "";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

const SOURCE_LABEL: Record<KoreanSource, string> = { itunes: "Apple Music", musicbrainz: "MusicBrainz", komca: "KOMCA" };

const buildRow = ({ track, exact, koreanTitle }: ResolvedTrack, index: number) => {
	const row = el("button", "ks-row");
	row.type = "button";
	row.style.animationDelay = `${Math.min(index, 8) * 24}ms`;

	const cover = el("img", "ks-art") as HTMLImageElement;
	const src = coverUrl(track);
	if (src) cover.src = src;
	cover.alt = "";
	row.append(cover);

	const map = el("div", "ks-map");
	const showsMapping = !!koreanTitle && koreanTitle !== track.title;
	map.append(el("span", "ks-ko", showsMapping ? koreanTitle : track.title));
	if (showsMapping) {
		const link = el("span", "ks-link");
		link.dataset.match = exact ? "isrc" : "title";
		link.title = exact ? "ISRC가 같은 녹음" : "제목으로 찾음";
		map.append(link, el("span", "ks-la", track.title));
	}
	row.append(map);

	row.append(el("span", "ks-artist", artistText(track)));
	row.append(el("span", "ks-time", durationText(track.duration)));

	row.title = showsMapping ? `${koreanTitle} · ${track.title} — ${artistText(track)}` : `${track.title} — ${artistText(track)}`;

	row.addEventListener("click", async () => {
		const item = await MediaItem.fromId(track.id).catch(trace.warn.withContext("MediaItem.fromId"));
		if (item === undefined) return trace.warn(`재생할 수 없는 트랙: ${track.title} (${track.id})`);
		redux.actions["playQueue/ADD_NOW"]({
			context: { id: "search", type: "UNKNOWN" },
			mediaItemIds: [track.id],
			overwritePlayQueue: true,
		});
		redux.actions["playQueue/SET_SOURCE_PROPERTIES"]({
			name: "Search",
			trackListName: "search",
			entityType: "item",
			entityId: track.id,
			entityItemsType: "track",
			limit: 1,
			url: `/search?q=${state.kind === "hidden" ? "" : state.phrase}`,
		});
		redux.actions["playbackControls/PLAY"]();
	});
	row.addEventListener("contextmenu", (event) => {
		event.preventDefault();
		redux.actions["contextMenu/OPEN_MEDIA_ITEM"]({
			type: "MEDIA_ITEM",
			id: track.id,
			position: [event.clientX, event.clientY],
			canBlock: false,
			contextMenuLocation: "trackList",
			sourceContext: { type: "search" },
		});
	});
	return row;
};

const ensureRoot = () => {
	root ??= (document.getElementById(ROOT_ID) as HTMLElement | null) ?? el("section", undefined);
	root.id = ROOT_ID;
	return root;
};

const TOP_RESULTS = '[data-test="search-results-top"]';
const NORMAL_RESULTS = '[data-test="search-results-normal"]';

/**
 * 검색결과 탭 바("Top results / Tracks / Albums") 바로 아래.
 *
 * 주의할 것 두 가지:
 * - `[data-test="search-results-*"]`는 섹션이 아니라 탭 패널 전체다. 그 *뒤에* 붙이면 페이지 맨 아래로 간다.
 * - 패널 안의 `[class*="container"]`는 탭 바 + 구분선만 담은 헤더고 높이가 고정이라, 그 *안에* 넣으면 잘려서 안 보인다.
 *
 * 그래서 헤더의 다음 형제로 넣는다.
 */
const insertIntoPage = () => {
	const node = ensureRoot();

	const panel = document.querySelector<HTMLElement>(TOP_RESULTS) ?? document.querySelector<HTMLElement>(NORMAL_RESULTS);
	if (panel) {
		const header = panel.querySelector<HTMLElement>('[class*="pillsScrollArea"]')?.parentElement;
		if (header?.parentElement === panel) {
			if (header.nextElementSibling !== node) header.after(node);
		} else if (panel.firstElementChild !== node) {
			// 탭 바가 없는 필터 탭이면 패널 맨 위
			panel.prepend(node);
		}
		return;
	}

	const content = document.querySelector<HTMLElement>("#main .mainContent") ?? document.getElementById("main");
	if (!content) return;
	if (node.parentElement === content && node.isConnected) return;
	const anchor = [...content.children].find((child) => child !== node && !child.classList.contains("global-background-container")) ?? null;
	content.insertBefore(node, anchor);
};

const render = () => {
	if (state.kind === "hidden") {
		root?.remove();
		return;
	}
	const node = ensureRoot();
	node.replaceChildren();

	// 검색어는 바로 위 검색창에 그대로 있으므로 헤더에서 되풀이하지 않는다.
	const head = el("div", "ks-head");
	head.append(el("span", "ks-eyebrow", "한국어 검색 결과"), el("span", "ks-rule"));
	head.append(
		el(
			"span",
			"ks-meta",
			state.kind === "loading"
				? "찾는 중"
				: [`${state.tracks.length}곡`, ...new Set(state.tracks.map((item) => SOURCE_LABEL[item.source]))].join(" · "),
		),
	);
	node.append(head);

	const rows = el("div", "ks-rows");
	if (state.kind === "loading") for (let i = 0; i < 3; i++) rows.append(el("div", "ks-skeleton"));
	else state.tracks.forEach((resolved, index) => rows.append(buildRow(resolved, index)));
	node.append(rows);

	insertIntoPage();
};

export const setSection = (next: SectionState) => {
	state = next;
	render();
};

export const initUi = (unloads: LunaUnloads) => {
	new StyleTag(ROOT_ID + "-style", unloads, css);
	for (const selector of ["#main .mainContent", TOP_RESULTS, NORMAL_RESULTS]) {
		observe(unloads, selector, () => {
			if (state.kind !== "hidden") insertIntoPage();
		});
	}
	unloads.add(() => {
		root?.remove();
		root = undefined;
		state = { kind: "hidden" };
	});
};
