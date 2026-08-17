import { ReactiveStore, type LunaUnload } from "@luna/core";
import { redux } from "@luna/lib";

import { hasHangul, resolveKoreanQuery, type ResolvedTrack } from "./resolve";
import { trace } from "./trace";
import { initUi, setSection } from "./ui";

export { trace };
export const unloads = new Set<LunaUnload>();

export type KoreanSearchStorage = {
	enabled: boolean;
	useItunes: boolean;
	useMusicBrainz: boolean;
	useKomca: boolean;
	maxResults: number;
};

const defaultStorage: KoreanSearchStorage = {
	enabled: true,
	useItunes: true,
	useMusicBrainz: true,
	useKomca: true,
	maxResults: 8,
};

export let storage: KoreanSearchStorage = { ...defaultStorage };
try {
	storage = { ...defaultStorage, ...(await ReactiveStore.getPluginStorage<Partial<KoreanSearchStorage>>("KoreanSearch", defaultStorage)) };
} catch (err) {
	trace.err.withContext("getPluginStorage")(err);
}

initUi(unloads);

const cache = new Map<string, { tracks: ResolvedTrack[]; at: number }>();
const CACHE_MAX = 100;

const EMPTY_TTL_MS = 60_000;

const cached = (phrase: string) => {
	const entry = cache.get(phrase);
	if (entry === undefined) return;
	if (entry.tracks.length === 0 && Date.now() - entry.at > EMPTY_TTL_MS) {
		cache.delete(phrase);
		return;
	}
	return entry.tracks;
};

let currentPath = location.pathname;
const onSearchPage = () => currentPath.startsWith("/search");

const currentPhrase = () => redux.store.getState().search?.searchPhrase ?? "";

let activePhrase = "";

let requestId = 0;
const run = async (phrase: string) => {
	phrase = phrase.trim();
	if (!storage.enabled || !hasHangul(phrase)) return setSection({ kind: "hidden" });
	if (!onSearchPage()) return;

	const show = (tracks: ResolvedTrack[]) =>
		setSection(tracks.length > 0 ? { kind: "results", phrase, tracks } : { kind: "hidden" });

	const hit = cached(phrase);
	if (hit !== undefined) return show(hit);

	const id = ++requestId;
	setSection({ kind: "loading", phrase });
	const tracks = (await resolveKoreanQuery(phrase, storage).catch(trace.err.withContext("resolveKoreanQuery"))) ?? [];
	if (id !== requestId) return; 

	if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
	cache.set(phrase, { tracks, at: Date.now() });
	show(tracks);
};

let debounce: ReturnType<typeof setTimeout> | undefined;
const schedule = (phrase: string) => {
	activePhrase = phrase.trim();
	clearTimeout(debounce);
	debounce = setTimeout(() => run(phrase), 250);
};
const cancel = () => {
	activePhrase = "";
	clearTimeout(debounce);
	requestId++;
	setSection({ kind: "hidden" });
};
unloads.add(() => clearTimeout(debounce));

redux.intercept("search/SEARCH_COMMIT", unloads, (phrase) => schedule(typeof phrase === "string" ? phrase : currentPhrase()));
redux.intercept("router/NAVIGATED", unloads, (payload) => {
	currentPath = payload.path ?? currentPath;
	if (!onSearchPage()) return cancel();
	schedule(currentPhrase());
});

redux.intercept("search/SET_SEARCH_PHRASE", unloads, (payload) => {
	if ((payload.searchPhrase ?? "").trim() !== activePhrase) cancel();
});

if (onSearchPage()) schedule(currentPhrase());

export { Settings } from "./Settings";
