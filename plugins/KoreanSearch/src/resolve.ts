import { ftch } from "@luna/core";
import { MediaItem, TidalApi, type redux } from "@luna/lib";

import { komcaSearch, type KomcaWork } from "./komca.native";
import {
	hasHangul,
	isLatin,
	koreanTitleMatches,
	mbArtistHints,
	mbArtistNames,
	mbLatinArtist,
	mbLatinTitle,
	normKo,
	queryMentionsArtist,
	relatedToKoreanQuery,
	titleMatches,
	type MbRecording,
} from "./match";

/** 검색어에서 한글 낱말만 추린 것. 사용자가 실제로 찾는 제목임! */
const koreanPartOf = (phrase: string) =>
	phrase
		.split(/\s+/)
		.filter(hasHangul)
		.join(" ");
import { trace } from "./trace";

export { hasHangul };

export type KoreanSource = "itunes" | "musicbrainz" | "komca";

export type ResolvedTrack = {
	track: redux.Track;
	/** 어느 소스에서 나온 후보로 찾았는지 */
	source: KoreanSource;
	/** ISRC로 정확히 매칭됐는지 (텍스트 검색보다 신뢰도 UP) */
	exact: boolean;
	/** 후보의 한국어 제목  UI에 같이 보여준다 */
	koreanTitle: string;
	/** 검색어가 이 곡의 아티스트를 지목했는지 */
	artistMatch: boolean;
};

export type ResolveOptions = {
	useItunes: boolean;
	useMusicBrainz: boolean;
	useKomca: boolean;
	maxResults: number;
};

// #region Apple Music (iTunes Search API)

type ItunesTrack = {
	trackId?: number;
	trackName?: string;
	artistName?: string;
	trackTimeMillis?: number;
};

/**
 * ko 스토어는 한글 제목을, 미국 스토어는 국제 발매 제목을 줌 두 스토어가 rackId를 공유하므로
 * 그대로 ko 제목 -> 국제 제목 변환표가 된다. 다른 소스가 못 넘는 벽이 여기서 넘어감!
 *
 * 사랑으로 / wave to earth -> love.
 * 영원은 그렇듯 / 리도어    -> Forever Has Always Been / Redoor
 *
 */
const itunesCandidates = async (phrase: string): Promise<Candidate[]> => {
	const search = await ftch.json<{ results?: ItunesTrack[] }>(
		`https://itunes.apple.com/search?term=${encodeURIComponent(phrase)}&country=KR&media=music&entity=song&limit=15`,
	);
	const korean = (search?.results ?? []).filter((track) => track.trackId !== undefined);
	if (korean.length === 0) return [];

	// 같은 id를 미국 스토어에서 한 번에 되짚는다
	const lookup = await ftch.json<{ results?: ItunesTrack[] }>(
		`https://itunes.apple.com/lookup?id=${korean.map((track) => track.trackId).join(",")}&country=US`,
	);
	const international = new Map((lookup?.results ?? []).map((track) => [track.trackId, track]));

	return korean.flatMap((track, index) => {
		const intl = international.get(track.trackId);
		// 미국 스토어에 없는 곡은 넘어간다 (ko 한정 발매인 경우)
		const latinTitle = isLatin(intl?.trackName) ? intl.trackName : undefined;
		if (latinTitle === undefined || !track.trackName) return [];
		const latinArtist = isLatin(intl?.artistName) ? intl.artistName : isLatin(track.artistName) ? track.artistName : undefined;
		return [
			{
				source: "itunes" as const,
				koreanTitle: track.trackName,
				latinTitle,
				latinArtist,
				artistNames: [track.artistName, intl?.artistName].filter((name) => name !== undefined),
				isrcs: [],
				// 애플의 검색 순위를 그대로 씀
				score: 100 - index,
			},
		];
	});
};

// #endregion

// #region MusicBrainz

type Candidate = {
	source: KoreanSource;
	koreanTitle: string;
	latinTitle?: string;
	latinArtist?: string;
	artistNames: string[];
	isrcs: string[];
	score: number;
};

const mbSearch = async (phrase: string): Promise<MbRecording[]> => {
	const query = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(phrase)}&fmt=json&limit=25`;
	const data = await ftch
		.json<{ recordings?: MbRecording[] }>(`${query}&dismax=true`)
		.catch(() => ftch.json<{ recordings?: MbRecording[] }>(query));
	return data?.recordings ?? [];
};

/** 한글 아티스트명 -> 라틴 표기. KOMCA는 가수명을 한글로만 갖고 있는 경우가 많아서 MB로 채우기 */
export type ArtistHints = Map<string, string>;

const mbLookup = async (phrase: string): Promise<{ candidates: Candidate[]; artistHints: ArtistHints }> => {
	const recordings = await mbSearch(phrase);
	const best = recordings[0]?.score ?? 0;
	// 최고점 대비 너무 떨어지는 건 버린다 (MB는 무관한 것도 늘 돌려준다)
	const relevant = recordings.filter((recording) => (recording.score ?? 0) >= Math.max(60, best - 20));

	const artistHints: ArtistHints = new Map();
	for (const recording of recordings) {
		for (const [korean, latin] of mbArtistHints(recording)) {
			if (!artistHints.has(normKo(korean))) artistHints.set(normKo(korean), latin);
		}
	}

	const candidates = relevant
		.map((recording) => ({
			source: "musicbrainz" as const,
			koreanTitle: recording.title ?? phrase,
			latinTitle: mbLatinTitle(recording),
			latinArtist: mbLatinArtist(recording),
			artistNames: mbArtistNames(recording),
			isrcs: recording.isrcs ?? [],
			score: recording.score ?? 0,
		}))
		.filter((candidate) => candidate.isrcs.length > 0 || candidate.latinTitle !== undefined)
		.filter((candidate) => relatedToKoreanQuery(koreanPartOf(phrase), candidate.koreanTitle));

	return { candidates, artistHints };
};

// #endregion

// #region KOMCA

/**
 * 부제목에는 영문 제목과 로마자 표기가 섞여 들어있다 ("남이될수있을까" -> `WE LOVED`, `NAM I DOIL SU ISS EUL KA`).
 * 어느 쪽이 TIDAL에 등록된 제목인지 알 수 없으므로 전부 후보로 만들어 각각 검색해본다.
 */
const komcaToCandidates = (work: KomcaWork, searchedTitle: string, artistHints: ArtistHints): Candidate[] => {
	const searched = normKo(searchedTitle);
	const title = normKo(work.title);
	// KOMCA는 "포함" 검색이라 `라일락` 하나에 `나의라일락`까지 딸려온다. 제목이 얼마나 붙는지로 순서를 준다.
	const base = title === searched ? 100 : title.startsWith(searched) ? 85 : 70;
	const latinArtist = work.artists.find(isLatin) ?? work.artists.map((name) => artistHints.get(normKo(name))).find(Boolean);

	return work.altTitles.filter(isLatin).map((latinTitle, index) => ({
		source: "komca" as const,
		koreanTitle: work.title,
		latinTitle,
		latinArtist,
		artistNames: latinArtist ? [...work.artists, latinArtist] : work.artists,
		isrcs: [],
		score: base - index,
	}));
};

/**
 * 붙여 친 검색어를 KOMCA의 (저작물명, 가수명) 칸으로 쪼갠다.
 * 통째로 한 번 넣어보는 게 먼저다  "주저하는 연인들을 위해"처럼 제목 자체가 여러 낱말인 경우가 있다.
 */
const komcaSplits = (phrase: string): Array<[title: string, artist?: string]> => {
	const words = phrase.split(/\s+/).filter(Boolean);
	const splits: Array<[string, string | undefined]> = [[phrase, undefined]];
	if (words.length < 2) return splits;

	const latin = words.filter((word) => !hasHangul(word));
	const korean = words.filter(hasHangul);
	// "wave to earth 사랑으로"  아티스트가 여러 낱말이어도 언어로 가르면 한 번에 갈린다
	if (latin.length > 0 && korean.length > 0) splits.push([korean.join(" "), latin.join(" ")]);
	else {
		splits.push([words.slice(1).join(" "), words[0]]);
		splits.push([words.slice(0, -1).join(" "), words.at(-1)!]);
	}
	return splits;
};

const komcaCandidates = async (phrase: string, artistHints: ArtistHints): Promise<Candidate[]> => {
	const search = async (title: string, artist?: string) =>
		(await komcaSearch(title, artist).catch(trace.warn.withContext("komcaSearch"))) ?? [];

	for (const [title, artist] of komcaSplits(phrase)) {
		let works: KomcaWork[] = [];
		// 가수명 필터가 먹으면 결과가 확 줄어든다 ("사랑으로" 45건 -> wave to earth 1건).
		// 1페이지만 읽으니 이게 중요하다  넓게 뒤지면 정작 찾는 곡이 뒷 페이지로 밀린다.
		if (artist !== undefined) works = await search(title, artist);
		if (works.length === 0) {
			// 가수명 필터는 합작을 한 칸에 몰아넣은 표기를 못 걸러낸다 ("래원(LAYONE),이영지").
			// 제목으로만 찾고 가수는 여기서 대조한다.
			const found = await search(title);
			works = artist === undefined ? found : found.filter((work) => queryMentionsArtist(artist, work.artists));
		}
		if (works.length > 0) return works.flatMap((work) => komcaToCandidates(work, title, artistHints));
	}
	return [];
};

// #endregion

// #region TIDAL

const tidalSearchTracks = async (query: string, limit: number): Promise<redux.Track[]> => {
	const url = `https://desktop.tidal.com/v1/search/tracks?${TidalApi.queryArgs()}&query=${encodeURIComponent(query)}&limit=${limit}`;
	const res = await TidalApi.fetch<{ items?: redux.Track[] }>(url).catch(trace.warn.withContext("tidalSearchTracks"));
	return res?.items ?? [];
};

const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
	const results: R[] = [];
	let index = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (index < items.length) results.push(await fn(items[index++]));
		}),
	);
	return results;
};

// #endregion

/**
 * 한국어 검색어를 TIDAL 트랙으로 바꾼다.
 *
 * 1. MusicBrainz / KOMCA에서 "한국어 제목 -> 라틴 문자 제목 + ISRC" 후보를 뽑고
 * 2. ISRC / 라틴 제목 / 아티스트 / 한국어 원제 순으로 TIDAL에 맞춰본다.
 */
export const resolveKoreanQuery = async (phrase: string, options: ResolveOptions): Promise<ResolvedTrack[]> => {
	const resolved = new Map<string, ResolvedTrack>();
	const koreanQuery = koreanPartOf(phrase);

	// 1. Apple Music 한/미 스토어 제목 대조 국제 발매명이 원제와 아예 다른 곡까지 잡아내 커버리지가 가장 넓음
	if (options.useItunes) {
		const candidates = (await itunesCandidates(phrase).catch(trace.warn.withContext("itunesCandidates"))) ?? [];
		await collectTracks(resolved, phrase, candidates.filter((candidate) => relatedToKoreanQuery(koreanQuery, candidate.koreanTitle)), options);
	}

	// 2. MusicBrainz ISRC를 주므로 표기와 무관하게 정확히 같은 녹음을 집어준다
	const mb = options.useMusicBrainz ? await mbLookup(phrase).catch(trace.warn.withContext("mbLookup")) : undefined;
	await collectTracks(resolved, phrase, mb?.candidates ?? [], options);

	// MusicBrainz는 한국 신곡/합작 커버리지가 얇다. MB가 뭔가 찾아왔더라도 그게 찾던 곡이 아닐 수 있으므로
	// 아래 두 경우엔 KOMCA도 봄
	// - 아티스트를 같이 쳤는데 그 아티스트가 하나도 안 걸림 (이영지·래원 "프리지아" -> 볼빨간사춘기 동명곡만)
	// - 한글로 친 제목과 같은 제목이 하나도 안 걸림 ("wave to earth 사랑으로" -> 같은 아티스트의 "wave"만)
	const items = () => [...resolved.values()];
	const missedArtist = phrase.trim().split(/\s+/).length > 1 && !items().some((item) => item.artistMatch);
	const missedTitle = koreanQuery.length > 0 && !items().some((item) => koreanTitleMatches(koreanQuery, item.koreanTitle));
	if (options.useKomca && (resolved.size === 0 || missedArtist || missedTitle)) {
		await collectTracks(resolved, phrase, await komcaCandidates(phrase, mb?.artistHints ?? new Map()), options);
	}

	// 검색어가 지목한 아티스트 먼저, 그다음 유명한 순.
	return [...resolved.values()]
		.sort(
			(a, b) =>
				Number(b.artistMatch) - Number(a.artistMatch) ||
				(b.track.popularity ?? 0) - (a.track.popularity ?? 0) ||
				Number(b.exact) - Number(a.exact),
		)
		.slice(0, options.maxResults);
};

/** 검색어가 아티스트를 지목한 후보에 얹는 가산점. 어떤 원본 점수보다도 커야 한다. */
const ARTIST_BOOST = 1000;

const collectTracks = async (resolved: Map<string, ResolvedTrack>, phrase: string, candidates: Candidate[], options: ResolveOptions) => {
	if (candidates.length === 0) return;

	for (const candidate of candidates) {
		if (queryMentionsArtist(phrase, candidate.artistNames)) candidate.score += ARTIST_BOOST;
	}
	candidates.sort((a, b) => b.score - a.score);

	const wantsArtist = candidates.some((candidate) => candidate.score >= ARTIST_BOOST);
	const needsMore = () =>
		resolved.size < options.maxResults || (wantsArtist && ![...resolved.values()].some((item) => item.artistMatch));

	const rank = (item: ResolvedTrack) => (item.artistMatch ? 2 : 0) + (item.exact ? 1 : 0);
	const add = (track: redux.Track | undefined, candidate: Candidate, exact: boolean) => {
		if (track?.id === undefined) return;
		// ISRC 조회는 지역을 안 가려서 여기서 못 트는 트랙이 섞여 나옴 눌러도 안 나오느니 안 보여주는 게 낫다.
		if (track.allowStreaming === false) return;
		const next: ResolvedTrack = {
			track,
			source: candidate.source,
			exact,
			koreanTitle: candidate.koreanTitle,
			artistMatch: candidate.score >= ARTIST_BOOST,
		};
		const key = String(track.id);
		const current = resolved.get(key);
		if (current !== undefined && rank(current) >= rank(next)) return;
		resolved.set(key, next);
	};

	const isrcJobs = candidates.flatMap((candidate) => candidate.isrcs.map((isrc) => ({ isrc, candidate }))).slice(0, 15);
	await mapLimit(isrcJobs, 4, async ({ isrc, candidate }) => {
		const mediaItem = await MediaItem.fromIsrc(isrc).catch(trace.warn.withContext("fromIsrc"));
		add(mediaItem?.tidalItem, candidate, true);
	});

	if (needsMore()) {
		const textJobs: Array<{ candidate: Candidate; query: string }> = [];
		const seen = new Set<string>();
		for (const candidate of candidates) {
			if (candidate.latinTitle === undefined) continue;
			const query = [candidate.latinTitle, candidate.latinArtist].filter(Boolean).join(" ");
			const key = query.toLowerCase().replace(/[^a-z0-9]+/g, "");
			if (seen.has(key)) continue;
			seen.add(key);
			textJobs.push({ candidate, query });
			if (textJobs.length >= 6) break;
		}
		await mapLimit(textJobs, 3, async ({ candidate, query }) => {
			for (const track of await tidalSearchTracks(query, 10)) {
				if (titleMatches(track.title, candidate.latinTitle!)) add(track, candidate, false);
			}
		});
	}

	if (needsMore()) {
		// 같은 아티스트의 후보를 묶는다. 한 곡의 영문 제목이 다른 버전 저작물에만 등록된 경우가 있어서
		// (멜로망스 "부끄럼"의 `BASHFULNESS`는 2022 라이브 버전에만 붙어있다) 묶어놔야 서로 건져준다.
		const byArtist = new Map<string, Candidate[]>();
		for (const candidate of candidates) {
			if (candidate.latinArtist === undefined) continue;
			const key = candidate.latinArtist.toLowerCase();
			let group = byArtist.get(key);
			if (group === undefined) byArtist.set(key, (group = []));
			group.push(candidate);
		}
		await mapLimit([...byArtist.values()].slice(0, 3), 3, async (group) => {
			for (const track of await tidalSearchTracks(group[0].latinArtist!, 50)) {
				const candidate = group.find(
					({ koreanTitle, latinTitle }) =>
						koreanTitleMatches(track.title, koreanTitle) || (latinTitle !== undefined && titleMatches(track.title, latinTitle)),
				);
				if (candidate !== undefined) add(track, candidate, false);
			}
		});
	}

};
