/**
 * 한국어 검색어를 TIDAL 라틴 문자 제목/아티스트로 바꾸는 순수 함수
 * luna에 의존하지 않음 바로 테스트할 수 있음(test/match.test.ts)
 */

export type MbArtistCredit = {
	name?: string;
	artist?: {
		name?: string;
		"sort-name"?: string;
		aliases?: Array<{ name?: string; locale?: string | null }>;
	};
};
export type MbRecording = {
	id: string;
	score?: number;
	title?: string;
	isrcs?: string[];
	"artist-credit"?: MbArtistCredit[];
	releases?: Array<{
		title?: string;
		media?: Array<{ track?: Array<{ title?: string }> }>;
	}>;
};

/** 한글 자모 + 음절 */
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;
export const hasHangul = (value?: string | null) => (value ? HANGUL.test(value) : false);

export const isLatin = (value?: string | null): value is string => !!value && /[A-Za-z]/.test(value) && !HANGUL.test(value);

/** 비교용 정규화: 소문자 + 영숫자만 */
export const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * 한국어 제목 비교용 정규화. 띄어쓰기가 소스마다 달라서 (MB "남이 될 수 있을까" vs
 * KOMCA "남이될수있을까") 공백/문장부호를 다 죽이기
 */
export const normKo = (value: string) => value.replace(/[\s\p{P}\p{S}]+/gu, "");

/** 괄호 안의 버전 표기를 떼어낸 본 제목. "BASHFULNESS(2022 FESTIVAL LIVE)" -> "bashfulness" */
const baseTitle = (value: string) => norm(value.replace(/[(\[{][^)\]}]*[)\]}]/g, " "));

/**
 * 텍스트 검색은 엉뚱한 곡도 물고 오므로 제목이 실제로 겹치는지 확인하기
 *
 * 부분 문자열 비교는 쓰지 말기 "Invitation"이 "Invitation from Me"에 걸려서
 * 멜로망스 "초대"가 정동하 "나에게로의 초대" 후보로 잡히던 원인임
 */
export const titleMatches = (trackTitle: string, latinTitle: string) => {
	const a = baseTitle(trackTitle);
	const b = baseTitle(latinTitle);
	return a.length > 0 && a === b;
};

/** 한글 제목끼리 비교. TIDAL은 영문 병기를 괄호로 붙여둔다: "사랑으로 (love.)" == "사랑으로" */
const baseKo = (value: string) => normKo(value.replace(/[(\[{][^)\]}]*[)\]}]/g, " "));
export const koreanTitleMatches = (trackTitle: string, koreanTitle: string) => {
	const a = baseKo(trackTitle);
	const b = baseKo(koreanTitle);
	return a.length > 0 && a === b;
};

/**
 * 검색어의 한글 부분이 이 제목과 관계가 있는가?
 *
 * MusicBrainz dismax는 "wave to earth 사랑으로"에 아티스트만 맞는 곡(`wave`, `play with earth!`)을
 * 높은 점수로 돌려준다. 한글 제목을 쳤으면 제목이 상관없는 후보는 버려야 함!
 */
export const relatedToKoreanQuery = (koreanPart: string, koreanTitle: string) => {
	const query = normKo(koreanPart);
	if (query.length === 0) return true;
	const title = normKo(koreanTitle);
	return title.length > 0 && (title.includes(query) || query.includes(title));
};

export const unsortName = (name: string) => {
	const [last, first] = name.split(/,\s*/, 2);
	return first ? `${first} ${last}` : name;
};

/**
 * 한국 발매는 녹음 제목이 한글이고, 영문/국제 발매 릴리스의 트랙 제목에 라틴 표기가 들어있음
 *
 * 릴리스(앨범) 제목은 쓰지 않는다. 백예린 "우주를 건너"의 릴리스는 `FRANK EP`라서,
 * 그걸 트랙 제목으로 착각하면 TIDAL 검색이 통째로 헛돈다.
 */
export const mbLatinTitle = (recording: MbRecording) => {
	if (isLatin(recording.title)) return recording.title;
	for (const release of recording.releases ?? []) {
		for (const media of release.media ?? []) {
			for (const track of media.track ?? []) if (isLatin(track.title)) return track.title;
		}
	}
};

const latinNameOf = (credit: MbArtistCredit) => {
	const artist = credit.artist ?? {};
	// 크레딧 표기명이 제일 정확하다.
	if (isLatin(credit.name)) return credit.name;
	if (isLatin(artist.name)) return artist.name;
	const aliases = artist.aliases ?? [];
	const english = aliases.find((alias) => isLatin(alias.name) && (alias.locale ?? "").toLowerCase().startsWith("en"));
	if (english?.name) return english.name;
	if (isLatin(artist["sort-name"])) return unsortName(artist["sort-name"]);
	return aliases.find((alias) => isLatin(alias.name))?.name;
};

export const mbLatinArtist = (recording: MbRecording) => {
	for (const credit of recording["artist-credit"] ?? []) {
		const latin = latinNameOf(credit);
		if (latin) return latin;
	}
};

/** 한 녹음에 걸린 아티스트 이름 전부 (한글/라틴/별칭). 검색어가 아티스트를 지목했는지 볼 때 쓴다 */
export const mbArtistNames = (recording: MbRecording): string[] => {
	const names: string[] = [];
	for (const credit of recording["artist-credit"] ?? []) {
		names.push(credit.name!, credit.artist?.name!, ...(credit.artist?.aliases ?? []).map((alias) => alias.name!));
	}
	return names.filter(Boolean);
};

/**
 * 검색어가 이 아티스트를 지목하고 있는가. MusicBrainz는 "멜로망스 초대"를 줘도 "초대"라는 제목의
 * 모든 녹음에 똑같이 100점을 매기므로, 입력한 아티스트는 우리가 직접 반영해야 한다
 */
export const queryMentionsArtist = (phrase: string, names: string[]) => {
	const words = phrase.split(/\s+/).filter(Boolean);
	const koWords = words.map(normKo).filter((word) => word.length >= 2);
	// 두 글자짜리 라틴 이름은 아무 데나 걸리므로 제외
	const latinWords = words.map(norm).filter((word) => word.length >= 3);
	// 양방향으로 본다. KOMCA는 합작을 한 칸에 몰아넣어서 (래원(LAYONE),이영지)
	// 검색어가 이름을 통째로 담고 있는지만 봐서는 안 걸린다
	const hit = (name: string, word: string) => name.includes(word) || word.includes(name);
	return names.some((name) => {
		if (hasHangul(name)) return normKo(name).length > 0 && koWords.some((word) => hit(normKo(name), word));
		return norm(name).length >= 3 && latinWords.some((word) => hit(norm(name), word));
	});
};

/**
 * 한글 아티스트명 -> 라틴 표기  KOMCA는 가수명을 한글로만 갖고 있는 경우가 많아서
 * ("백예린") MusicBrainz로 라틴 표기를 채워야 TIDAL 검색어가 된다 ("Yerin Baek")
 */
export const mbArtistHints = (recording: MbRecording): Array<[korean: string, latin: string]> => {
	const hints: Array<[string, string]> = [];
	for (const credit of recording["artist-credit"] ?? []) {
		const latin = latinNameOf(credit);
		if (!latin) continue;
		for (const name of [credit.name, credit.artist?.name, ...(credit.artist?.aliases ?? []).map((alias) => alias.name)]) {
			if (hasHangul(name)) hints.push([name!, latin]);
		}
	}
	return hints;
};
