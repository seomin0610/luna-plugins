import { ReactiveStore, Tracer, ftch, type LunaUnload } from "@luna/core";
import { MediaItem, redux } from "@luna/lib";

export const { trace } = Tracer("[Hunminjeongeum]");
export const unloads = new Set<LunaUnload>();

type ItemId = string | number;
type Track = {
	id: ItemId;
	title: string;
	isrc?: string | null;
	artist?: { name?: string | null };
	artists?: Array<{ name?: string | null }>;
};
type ReduxMediaItem = { type: "track" | "video"; item: Track };
type SearchTopHit = { type: "TRACKS"; value: Track } | { type: string; value: any };
type SearchResultPayload = {
	tracks: { items: Track[] };
	topHits?: SearchTopHit;
};
const isSameItemId = (a: ItemId | null | undefined, b: ItemId | null | undefined) => {
	if (a === undefined || a === null) return false;
	if (b === undefined || b === null) return false;
	return String(a) === String(b);
};

export type HunminjeongeumStorage = {
	enabled: boolean;
	testMode: boolean;
	/**
	 * IRSC 캐시된 번역 (대문자).
	 */
	cache: Record<string, string>;
	/**
	 * Cached "not found" ISRCs (대문자) with last miss timestamp (ms).
	 */
	misses: Record<string, number>;
	/**
	 * 수동 오버라이드.
	 * - ISRC override key: "ISRC:KRxxx..."
	 * - Title override key: "TITLE:lowercased title||lowercased artist"
	 */
	overrides: Record<string, string>;
};

const defaultStorage: HunminjeongeumStorage = {
	enabled: true,
	testMode: false,
	cache: {},
	misses: {},
	overrides: {
		// 예:
		// "ISRC:KRXXXXXX0001": "라일락",
		// "TITLE:lilac||iu": "라일락",
	},
};

export let storage: HunminjeongeumStorage = { ...defaultStorage };

const loadStorage = async () => {
	try {
		const saved = await ReactiveStore.getPluginStorage<Partial<HunminjeongeumStorage>>("Hunminjeongeum", defaultStorage);
		storage = {
			...defaultStorage,
			...saved,
			cache: saved?.cache ?? {},
			misses: saved?.misses ?? {},
			overrides: saved?.overrides ?? {},
		};
	} catch (err) {
		trace.err.withContext("getPluginStorage")(err);
		storage = { ...defaultStorage };
	}
};

await loadStorage();

const HANGUL_RE = /[\uac00-\ud7a3]/;
const hasHangul = (value?: string | null) => (value ? HANGUL_RE.test(value) : false);
const normalizeIsrc = (value?: string | null) => (value ?? "").trim().toUpperCase();
const trySetTrackTitle = (track: Track, title: string) => {
	if (track.title === title) return true;
	try {
		track.title = title;
		return track.title === title;
	} catch {
		return false;
	}
};

const normalizeKey = (title: string, artist?: string | null) => {
	const base = title.trim().toLowerCase();
	const artistPart = (artist ?? "").trim().toLowerCase();
	return `TITLE:${base}||${artistPart}`;
};

const getArtistName = (track: Track) => track.artist?.name ?? track.artists?.[0]?.name ?? "";

const getOverrideTitle = (track: Track) => {
	const isrc = (track.isrc ?? "").trim();
	if (isrc) {
		const byIsrc = storage.overrides[`ISRC:${isrc.toUpperCase()}`];
		if (byIsrc) return byIsrc;
	}
	const key = normalizeKey(track.title, getArtistName(track));
	return storage.overrides[key];
};

const getCachedTitle = (track: Track) => {
	const isrc = normalizeIsrc(track.isrc);
	if (!isrc) return undefined;
	return storage.cache[isrc];
};

const MISS_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const TRANSIENT_FAILURE_TTL_MS = 1000 * 60 * 10;
const SERVICE_COOLDOWN_MS = 1000 * 60 * 2;
const transientFailures = new Map<string, number>();
let serviceCooldownUntil = 0;
let lastServiceWarnAt = 0;

const isFreshMiss = (isrc: string) => {
	const lastMiss = storage.misses[isrc];
	if (!lastMiss) return false;
	if (Date.now() - lastMiss < MISS_TTL_MS) return true;
	delete storage.misses[isrc];
	return false;
};

const isTransientFailureActive = (isrc: string) => {
	const until = transientFailures.get(isrc);
	if (!until) return false;
	if (Date.now() < until) return true;
	transientFailures.delete(isrc);
	return false;
};

const shouldAttemptLookup = (track: Track) => {
	if (!storage.enabled) return false;
	if (!track?.title) return false;
	if (hasHangul(track.title)) return false;
	const isrc = normalizeIsrc(track.isrc);
	if (!isrc) return false;
	if (isFreshMiss(isrc)) return false;
	if (isTransientFailureActive(isrc)) return false;
	if (Date.now() < serviceCooldownUntil) return false;
	if (hasHangul(getArtistName(track))) return true;
	return isrc.startsWith("KR");
};

const markTrackLocalized = (trackId: ItemId | null | undefined, isrc: string) => {
	if (trackId !== undefined && trackId !== null) localizedTrackIds.add(trackId);
	if (isrc) localizedTrackIsrcs.add(isrc);
	const idMatched = isSameItemId(trackId, currentPlaybackTrackId);
	const isrcMatched = !!isrc && isrc === currentPlaybackTrackIsrc;
	if (idMatched || isrcMatched) {
		setPlaybackDebugState({
			isrc: currentPlaybackTrackIsrc,
			localized: true,
		});
		scheduleLyricsBadgeRefresh();
	}
};

const isTrackLocalized = (track?: Track | null) => {
	if (!track) return false;
	if (track.id !== undefined && track.id !== null && localizedTrackIds.has(track.id)) return true;
	const isrc = normalizeIsrc(track.isrc);
	if (isrc && localizedTrackIsrcs.has(isrc)) return true;
	return !!getOverrideTitle(track) || !!getCachedTitle(track) || !!storage.overrides[`ISRC:${isrc}`];
};

type CacheApplyResult = {
	status: "none" | "unchanged" | "updated";
	title?: string;
};
const applyCachedTitle = (track: Track): CacheApplyResult => {
	const override = getOverrideTitle(track);
	if (override && override !== track.title) {
		markTrackLocalized(track.id, normalizeIsrc(track.isrc));
		const updated = trySetTrackTitle(track, override);
		return { status: updated ? "updated" : "unchanged", title: override };
	}
	if (override) {
		markTrackLocalized(track.id, normalizeIsrc(track.isrc));
		return { status: "unchanged", title: override };
	}
	const cached = getCachedTitle(track);
	if (cached && cached !== track.title) {
		markTrackLocalized(track.id, normalizeIsrc(track.isrc));
		const updated = trySetTrackTitle(track, cached);
		return { status: updated ? "updated" : "unchanged", title: cached };
	}
	if (cached) {
		markTrackLocalized(track.id, normalizeIsrc(track.isrc));
		return { status: "unchanged", title: cached };
	}
	return { status: "none" };
};

const observedTracksByIsrc = new Map<string, Set<Track>>();
const observedTracksById = new Map<ItemId, Set<Track>>();
const localizedTrackIds = new Set<ItemId>();
const localizedTrackIsrcs = new Set<string>();
const feedTrackIds = new Set<ItemId>();
const feedIsrcs = new Set<string>();
let lastFeedPayload: unknown | null = null;
let feedRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let isReplayingFeed = false;
let currentPlaybackTrackId: ItemId | null = null;
let currentPlaybackTrackIsrc = "";

export type HunminjeongeumPlaybackDebug = {
	isrc: string;
	localized: boolean;
};

let playbackDebugState: HunminjeongeumPlaybackDebug = {
	isrc: "",
	localized: false,
};
const playbackDebugSubscribers = new Set<() => void>();

export const getPlaybackDebugState = () => playbackDebugState;

export const subscribePlaybackDebugState = (listener: () => void) => {
	playbackDebugSubscribers.add(listener);
	return () => playbackDebugSubscribers.delete(listener);
};

const setPlaybackDebugState = (next: HunminjeongeumPlaybackDebug) => {
	if (playbackDebugState.isrc === next.isrc && playbackDebugState.localized === next.localized) return;
	playbackDebugState = next;
	playbackDebugSubscribers.forEach((listener) => listener());
};

const registerTrackRef = (track: Track) => {
	if (!track) return;
	const id = track.id;
	if (id !== undefined && id !== null) {
		const byId = observedTracksById.get(id) ?? new Set<Track>();
		byId.add(track);
		observedTracksById.set(id, byId);
	}
	const isrc = normalizeIsrc(track.isrc);
	if (!isrc) return;
	const byIsrc = observedTracksByIsrc.get(isrc) ?? new Set<Track>();
	byIsrc.add(track);
	observedTracksByIsrc.set(isrc, byIsrc);
};

const broadcastTitleUpdate = (trackId: ItemId | undefined, isrc: string | undefined, title: string) => {
	const seen = new Set<Track>();
	if (trackId !== undefined && trackId !== null) {
		const byId = observedTracksById.get(trackId);
		if (byId) for (const track of byId) seen.add(track);
	}
	if (isrc) {
		const byIsrc = observedTracksByIsrc.get(isrc);
		if (byIsrc) for (const track of byIsrc) seen.add(track);
	}
	seen.forEach((track) => {
		if (track.title !== title) trySetTrackTitle(track, title);
	});
	const inFeed = (trackId !== undefined && trackId !== null && feedTrackIds.has(trackId)) || (!!isrc && feedIsrcs.has(isrc));
	if (inFeed) scheduleFeedRefresh();
};

const scheduleFeedRefresh = () => {
	if (!lastFeedPayload || isReplayingFeed) return;
	if (feedRefreshTimer) return;
	feedRefreshTimer = setTimeout(() => {
		feedRefreshTimer = null;
		if (!lastFeedPayload || isReplayingFeed) return;
		isReplayingFeed = true;
		try {
			redux.actions["feed/LOAD_FEED_SUCCESS"](lastFeedPayload as any);
		} finally {
			isReplayingFeed = false;
		}
	}, 50);
};

const isTrackLike = (value: unknown): value is Track => {
	if (!value || typeof value !== "object") return false;
	const item = value as Record<string, unknown>;
	const hasId = typeof item.id === "string" || typeof item.id === "number";
	const hasTitle = typeof item.title === "string";
	if (!hasId || !hasTitle) return false;
	const type = String(item.type ?? item.itemType ?? item.mediaType ?? "").toLowerCase();
	if (type === "track") return true;
	const isrc = typeof item.isrc === "string" ? item.isrc.trim() : "";
	return isrc.length > 0;
};

const collectTracks = (root: unknown) => {
	const tracks: Track[] = [];
	const seen = new Set<unknown>();
	const seenIds = new Set<ItemId>();
	const queue: unknown[] = [root];
	let steps = 0;
	while (queue.length > 0 && steps < 3000) {
		const current = queue.shift();
		steps += 1;
		if (!current || typeof current !== "object") continue;
		if (seen.has(current)) continue;
		seen.add(current);
		if (isTrackLike(current)) {
			const track = current as Track;
			if (!seenIds.has(track.id)) {
				tracks.push(track);
				seenIds.add(track.id);
			}
		}
		if (Array.isArray(current)) {
			for (const value of current) queue.push(value);
			continue;
		}
		for (const value of Object.values(current as Record<string, unknown>)) {
			if (value && typeof value === "object") queue.push(value);
		}
	}
	return tracks;
};

const updateMediaItemTitleInStore = (trackId: ItemId, title: string) => {
	const mediaItem = redux.store.getState().content.mediaItems[String(trackId)];
	if (!mediaItem || mediaItem.type !== "track") return;
	if (mediaItem.item.title === title) return;
	const updated: ReduxMediaItem = {
		...mediaItem,
		item: { ...mediaItem.item, title },
	};
	redux.actions["content/LOAD_SINGLE_MEDIA_ITEM_SUCCESS"]({ mediaItem: updated });
};

let lastSearchPayload: SearchResultPayload | null = null;
const updateSearchResultsTitle = (trackId: ItemId, title: string) => {
	if (!lastSearchPayload) return;
	let changed = false;
	const nextTracks = lastSearchPayload.tracks.items.map((track) => {
		if (track.id !== trackId) return track;
		if (track.title === title) return track;
		changed = true;
		return { ...track, title };
	});
	if (!changed) return;
	const nextPayload: SearchResultPayload = {
		...lastSearchPayload,
		tracks: { ...lastSearchPayload.tracks, items: nextTracks },
	};
	lastSearchPayload = nextPayload;
	redux.actions["search/SEARCH_RESULT_SUCCESS"](nextPayload);
};

type MusicBrainzIsrcResponse = {
	recordings?: Array<{
		id: string;
		title: string;
		aliases?: Array<{ name: string; locale?: string | null; primary?: boolean }>;
	}>;
};

const pickHangulTitle = (titles: Array<string | undefined>) => titles.find((title) => title && hasHangul(title)) ?? null;

let requestQueue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
const enqueueRequest = async <T>(run: () => Promise<T>) => {
	const task = async () => {
		const now = Date.now();
		const waitMs = Math.max(0, 1100 - (now - lastRequestAt));
		if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
		lastRequestAt = Date.now();
		return run();
	};
	const queued = requestQueue.then(task, task);
	requestQueue = queued.then(
		() => undefined,
		() => undefined,
	);
	return queued;
};

const fetchTitleFromMusicBrainz = async (isrc: string): Promise<string | null> => {
	const url = `https://musicbrainz.org/ws/2/isrc/${encodeURIComponent(isrc)}?fmt=json`;
	const data = await enqueueRequest(() => ftch.json<MusicBrainzIsrcResponse>(url));
	const recordings = data?.recordings ?? [];
	if (recordings.length === 0) return null;

	const direct = pickHangulTitle(recordings.map((rec) => rec.title));
	if (direct) return direct;

	const aliasTitle = pickHangulTitle(
		recordings.flatMap((rec) => rec.aliases?.map((alias) => alias.name) ?? []),
	);
	if (aliasTitle) return aliasTitle;
	return null;
};

const getHttpStatus = (err: unknown) => {
	if (!(err instanceof Error)) return null;
	const match = err.message.match(/^(\d{3})\b/);
	if (!match) return null;
	const status = Number.parseInt(match[1], 10);
	return Number.isNaN(status) ? null : status;
};
const isNotFoundError = (err: unknown) => getHttpStatus(err) === 404;
const isTemporaryHttpError = (err: unknown) => {
	const status = getHttpStatus(err);
	return status === 429 || (status !== null && status >= 500);
};

const pendingLookups = new Map<string, Promise<string | null>>();
const scheduleLookup = (track: Track) => {
	if (!shouldAttemptLookup(track)) return;
	const isrc = normalizeIsrc(track.isrc);
	if (!isrc) return;
	if (pendingLookups.has(isrc)) return;
	const task = (async () => {
		try {
			const title = await fetchTitleFromMusicBrainz(isrc);
			if (!title) return null;
			if (!storage.cache[isrc]) storage.cache[isrc] = title;
			markTrackLocalized(track.id, isrc);
			broadcastTitleUpdate(track.id, isrc, title);
			updateMediaItemTitleInStore(track.id, title);
			updateSearchResultsTitle(track.id, title);
			return title;
		} catch (err) {
			if (isNotFoundError(err)) {
				storage.misses[isrc] = Date.now();
				return null;
			}
			if (isTemporaryHttpError(err)) {
				const now = Date.now();
				transientFailures.set(isrc, now + TRANSIENT_FAILURE_TTL_MS);
				serviceCooldownUntil = Math.max(serviceCooldownUntil, now + SERVICE_COOLDOWN_MS);
				if (now - lastServiceWarnAt > 30_000) {
					lastServiceWarnAt = now;
					trace.warn.withContext("musicbrainz")("temporary unavailable; retry later");
				}
				return null;
			}
			trace.warn.withContext("musicbrainz")(err);
			return null;
		}
	})();
	pendingLookups.set(isrc, task);
	task.finally(() => pendingLookups.delete(isrc));
};

const handleTrack = (track: Track) => {
	if (!track || !storage.enabled) return;
	registerTrackRef(track);
	const cacheResult = applyCachedTitle(track);
	if (cacheResult.title) {
		const isrc = normalizeIsrc(track.isrc);
		broadcastTitleUpdate(track.id, isrc || undefined, cacheResult.title);
		updateMediaItemTitleInStore(track.id, cacheResult.title);
		updateSearchResultsTitle(track.id, cacheResult.title);
	}
	if (cacheResult.status === "none") scheduleLookup(track);
};

const getTrackFromStateById = (trackId: ItemId | null | undefined): Track | null => {
	if (trackId === undefined || trackId === null) return null;
	const mediaItem = redux.store.getState().content?.mediaItems?.[String(trackId)] as ReduxMediaItem | undefined;
	if (!mediaItem || mediaItem.type !== "track") return null;
	return mediaItem.item as Track;
};

const handleMediaItem = (mediaItem: ReduxMediaItem) => {
	if (!mediaItem || mediaItem.type !== "track") return;
	const track = mediaItem.item as Track;
	handleTrack(track);
	if (isSameItemId(track.id, currentPlaybackTrackId)) updateCurrentPlaybackTrack(track);
};

const handleFeedPayload = (payload: unknown, markAsFeed = false) => {
	if (markAsFeed) lastFeedPayload = payload;
	const tracks = collectTracks(payload);
	if (tracks.length === 0) {
		if (markAsFeed) {
			feedTrackIds.clear();
			feedIsrcs.clear();
		}
		return;
	}
	if (markAsFeed) {
		feedTrackIds.clear();
		feedIsrcs.clear();
		tracks.forEach((track) => {
			feedTrackIds.add(track.id);
			const isrc = normalizeIsrc(track.isrc);
			if (isrc) feedIsrcs.add(isrc);
		});
	}
	tracks.forEach(handleTrack);
};

const HUNMIN_STYLE_ID = "hunminjeongeum-style";
const HUNMIN_LYRICS_BADGE_ID = "hunminjeongeum-lyrics-badge";
let lyricsBadgeQueued = false;

const ensureHunminStyle = () => {
	if (document.getElementById(HUNMIN_STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = HUNMIN_STYLE_ID;
	style.textContent = `
		.hunminjeongeum-lyrics-badge-host {
			display: flex;
			justify-content: flex-end;
			padding: 4px 0;
		}
		.hunminjeongeum-lyrics-badge {
			display: inline-flex;
			align-items: center;
			padding: 2px 8px;
			border-radius: 999px;
			font-size: 11px;
			font-weight: 600;
			letter-spacing: 0.02em;
			color: #063a0d;
			background: rgba(101, 224, 128, 0.22);
			border: 1px solid rgba(101, 224, 128, 0.52);
		}
	`;
	document.head.appendChild(style);
};

const removeLyricsLocalizedBadge = () => {
	const badge = document.getElementById(HUNMIN_LYRICS_BADGE_ID);
	if (!badge) return;
	const host = badge.parentElement;
	badge.remove();
	if (host && host.classList.contains("hunminjeongeum-lyrics-badge-host") && host.childElementCount === 0) host.remove();
};

const findLyricsBadgeHost = () => {
	const line = document.querySelector<HTMLElement>("[data-test='lyrics-line']");
	if (!line || !line.parentElement) return null;
	const container = line.parentElement;
	const existingHost = container.querySelector<HTMLElement>(".hunminjeongeum-lyrics-badge-host");
	if (existingHost) return existingHost;
	const host = document.createElement("div");
	host.className = "hunminjeongeum-lyrics-badge-host";
	container.prepend(host);
	return host;
};

const renderLyricsLocalizedBadge = () => {
	if (!document.body) return;
	if (!storage.enabled || !playbackDebugState.localized) {
		removeLyricsLocalizedBadge();
		return;
	}
	const host = findLyricsBadgeHost();
	if (!host) {
		removeLyricsLocalizedBadge();
		return;
	}
	ensureHunminStyle();
	let badge = document.getElementById(HUNMIN_LYRICS_BADGE_ID) as HTMLSpanElement | null;
	if (!badge) {
		badge = document.createElement("span");
		badge.id = HUNMIN_LYRICS_BADGE_ID;
		badge.className = "hunminjeongeum-lyrics-badge";
		badge.textContent = "한글화됨";
	}
	if (badge.parentElement !== host) host.appendChild(badge);
};

const scheduleLyricsBadgeRefresh = () => {
	if (lyricsBadgeQueued) return;
	lyricsBadgeQueued = true;
	requestAnimationFrame(() => {
		lyricsBadgeQueued = false;
		renderLyricsLocalizedBadge();
	});
};

export const refreshHunminUi = () => {
	scheduleLyricsBadgeRefresh();
};

const updateCurrentPlaybackTrack = (track?: Track | null) => {
	currentPlaybackTrackId = track?.id ?? null;
	const trackInState = getTrackFromStateById(currentPlaybackTrackId);
	currentPlaybackTrackIsrc = normalizeIsrc(track?.isrc) || normalizeIsrc(trackInState?.isrc);
	const resolvedTrack = trackInState ?? track ?? null;
	setPlaybackDebugState({
		isrc: currentPlaybackTrackIsrc,
		localized: isTrackLocalized(resolvedTrack),
	});
	scheduleLyricsBadgeRefresh();
};

const initializeCurrentPlaybackTrack = async () => {
	try {
		const item = await MediaItem.fromPlaybackContext();
		updateCurrentPlaybackTrack((item?.tidalItem as Track | undefined) ?? null);
	} catch (err) {
		trace.warn.withContext("initPlaybackTrack")(err);
		updateCurrentPlaybackTrack(null);
	}
};

const initializeExistingTracks = () => {
	const state = redux.store.getState();

	// 1. content.mediaItems (앨범, 플레이리스트 등 이미 로드된 것들)
	const mediaItems = state.content?.mediaItems ?? {};
	Object.values(mediaItems).forEach((mediaItem) => {
		handleMediaItem(mediaItem as ReduxMediaItem);
	});

	// 2. feed (홈 피드)
	const feed = state.feed;
	if (feed) handleFeedPayload(feed, true);

	// 3. search 결과
	const searchResults = state.search?.searchResults;
	if (searchResults) {
		lastSearchPayload = searchResults;
		searchResults.tracks?.items?.forEach(handleTrack);
		if (searchResults.topHits?.type === "TRACKS") {
			handleTrack(searchResults.topHits.value);
		}
	}
};

initializeExistingTracks();
await initializeCurrentPlaybackTrack();
scheduleLyricsBadgeRefresh();

const lyricsBadgeObserver = new MutationObserver(() => scheduleLyricsBadgeRefresh());
const startLyricsBadgeObserver = () => {
	if (!document.body) return;
	lyricsBadgeObserver.observe(document.body, {
		subtree: true,
		childList: true,
		attributes: false,
	});
};
if (document.body) {
	startLyricsBadgeObserver();
} else {
	const onReady = () => startLyricsBadgeObserver();
	window.addEventListener("DOMContentLoaded", onReady, { once: true });
	unloads.add(() => window.removeEventListener("DOMContentLoaded", onReady));
}
unloads.add(() => lyricsBadgeObserver.disconnect());
unloads.add(() => removeLyricsLocalizedBadge());

redux.intercept(
	[
		"content/LOAD_SINGLE_MEDIA_ITEM_SUCCESS",
		"content/LOAD_ALL_ALBUM_MEDIA_ITEMS_SUCCESS",
		"content/LOAD_ALL_ALBUM_MEDIA_ITEMS_WITH_CREDITS_SUCCESS",
		"content/LOAD_PLAYLIST_SUGGESTED_MEDIA_ITEMS_SUCCESS",
		"content/LOAD_PLAYLIST_SUCCESS",
		"content/LOAD_LIST_ITEMS_PAGE_SUCCESS",
		"content/LOAD_SUGGESTIONS_SUCCESS",
		"content/RECEIVED_FULL_TRACK_LIST_MEDIA_ITEMS",
		"content/LAZY_LOAD_MEDIA_ITEMS_SUCCESS",
		"content/LOAD_RECENT_ACTIVITY_SUCCESS",
		"content/LOAD_DYNAMIC_PAGE_SUCCESS",
		"route/LOADER_DATA__HOME--SUCCESS",
		"feed/LOAD_FEED_SUCCESS",
	],
	unloads,
	(payload, type) => {
		switch (type) {
			case "content/LOAD_SINGLE_MEDIA_ITEM_SUCCESS":
				handleMediaItem(payload.mediaItem);
				break;
			case "content/LOAD_ALL_ALBUM_MEDIA_ITEMS_SUCCESS":
			case "content/LOAD_ALL_ALBUM_MEDIA_ITEMS_WITH_CREDITS_SUCCESS":
				payload.mediaItems.forEach(handleMediaItem);
				break;
			case "content/LOAD_PLAYLIST_SUGGESTED_MEDIA_ITEMS_SUCCESS":
			case "content/LOAD_SUGGESTIONS_SUCCESS":
				payload.mediaItems.forEach(handleMediaItem);
				break;
			case "content/LOAD_PLAYLIST_SUCCESS":
			case "content/LOAD_LIST_ITEMS_PAGE_SUCCESS":
				handleFeedPayload(payload);
				break;
			case "content/RECEIVED_FULL_TRACK_LIST_MEDIA_ITEMS":
				payload.items.forEach(handleMediaItem);
				break;
			case "content/LAZY_LOAD_MEDIA_ITEMS_SUCCESS":
				if (payload?.items) Object.values(payload.items).forEach(handleMediaItem);
				break;
			case "content/LOAD_RECENT_ACTIVITY_SUCCESS":
			case "content/LOAD_DYNAMIC_PAGE_SUCCESS":
			case "route/LOADER_DATA__HOME--SUCCESS":
				handleFeedPayload(payload);
				break;
			case "feed/LOAD_FEED_SUCCESS":
				handleFeedPayload(payload, true);
				break;
			default:
				break;
		}
	},
);

redux.intercept("search/SEARCH_RESULT_SUCCESS", unloads, (payload) => {
	lastSearchPayload = payload;
	payload.tracks.items.forEach(handleTrack);
	if (payload.topHits?.type === "TRACKS") handleTrack(payload.topHits.value);
});

MediaItem.onMediaTransition(unloads, async (item) => {
	const track = item?.tidalItem as Track | undefined;
	updateCurrentPlaybackTrack(track);
	if (!track) return;
	registerTrackRef(track);
	const cacheResult = applyCachedTitle(track);
	if (cacheResult.title) {
		const isrc = normalizeIsrc(track.isrc);
		broadcastTitleUpdate(track.id, isrc || undefined, cacheResult.title);
		updateMediaItemTitleInStore(track.id, cacheResult.title);
		updateSearchResultsTitle(track.id, cacheResult.title);
	}
	if (cacheResult.status === "none") {
		scheduleLookup(track);
	}
	scheduleLyricsBadgeRefresh();
});

export { Settings } from "./Settings.tsx";

//,,