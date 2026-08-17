/**
 * 한국어 -> 라틴 표기 추출 자체 점검.
 * 실행: `pnpm tsx plugins/KoreanSearch/test/match.test.ts`
 */
import assert from "node:assert/strict";

import {
	hasHangul,
	isLatin,
	mbArtistHints,
	mbArtistNames,
	mbLatinArtist,
	koreanTitleMatches,
	mbLatinTitle,
	normKo,
	relatedToKoreanQuery,
	queryMentionsArtist,
	titleMatches,
	unsortName,
	type MbRecording,
} from "../src/match";

// 소스마다 띄어쓰기가 다르다: MB "남이 될 수 있을까" vs KOMCA "남이될수있을까"
assert.equal(normKo("남이 될 수 있을까"), normKo("남이될수있을까"));
assert.equal(normKo("주저하는 연인들을 위해"), "주저하는연인들을위해");
assert.notEqual(normKo("남이될수있을까"), normKo("남이될수없을까"));

assert.equal(hasHangul("라일락"), true);
assert.equal(hasHangul("LILAC"), false);
assert.equal(isLatin("LILAC"), true);
assert.equal(isLatin("라일락 (LILAC)"), false); // 한글이 섞이면 TIDAL 검색어로 못 쓴다

// 활동명 IU가 별칭 목록에서 본명 Lee Ji-eun 뒤에 있다 - 크레딧 표기명을 써야 한다
const iu: MbRecording = {
	id: "x",
	title: "라일락",
	isrcs: ["KRA382102077"],
	"artist-credit": [
		{
			name: "IU",
			artist: {
				name: "IU",
				"sort-name": "IU",
				aliases: [
					{ name: "Lee Ji-eun", locale: "en" },
					{ name: "아이유", locale: "ko" },
					{ name: "IU", locale: "en" },
				],
			},
		},
	],
	releases: [
		{ title: "LILAC", media: [{ track: [{ title: "라일락" }] }] },
		{ title: "LILAC", media: [{ track: [{ title: "LILAC" }] }] },
	],
};
assert.equal(mbLatinArtist(iu), "IU");
// 녹음 제목이 한글이면 라틴 표기 릴리스의 트랙 제목을 찾아낸다
assert.equal(mbLatinTitle(iu), "LILAC");

// 아티스트명이 전부 한글이면 정렬용 이름이 유일한 라틴 표기다
const jang: MbRecording = {
	id: "y",
	title: "라일락",
	"artist-credit": [{ name: "장범준", artist: { name: "장범준", "sort-name": "Jang Beom-june" } }],
	releases: [{ title: "월말 장범준 - 라일락", media: [{ track: [{ title: "lilac" }] }] }],
};
assert.equal(mbLatinArtist(jang), "Jang Beom-june");
assert.equal(mbLatinTitle(jang), "lilac");

assert.equal(unsortName("Kim, Dong Hee"), "Dong Hee Kim");
assert.equal(unsortName("Loptimist"), "Loptimist");

// 아무 라틴 표기도 없으면 후보에서 빠져야 한다
assert.equal(mbLatinTitle({ id: "z", title: "라일락", releases: [{ title: "라일락" }] }), undefined);

// 릴리스(앨범) 제목은 트랙 제목이 아니다. 백예린 "우주를 건너"의 앨범 `FRANK EP`를
// 제목으로 집으면 TIDAL 검색이 통째로 헛돈다.
const yerin: MbRecording = {
	id: "w",
	title: "우주를 건너",
	"artist-credit": [
		{
			name: "백예린",
			artist: {
				name: "백예린",
				"sort-name": "Baek, Yerin",
				aliases: [{ name: "백예린", locale: null }, { name: "Yerin Baek", locale: "en" }, { name: "Baek Ye-rin", locale: null }],
			},
		},
	],
	releases: [{ title: "FRANK EP", media: [{ track: [{ title: "우주를 건너" }] }] }],
};
assert.equal(mbLatinTitle(yerin), undefined);
// 한글 가수명 -> 라틴 표기. KOMCA가 "백예린"만 갖고 있을 때 TIDAL 검색어를 만들어준다.
assert.deepEqual(mbArtistHints(yerin), [
	["백예린", "Yerin Baek"],
	["백예린", "Yerin Baek"],
	["백예린", "Yerin Baek"],
]);

// sort-name을 되돌리면 망가지는 이름은 영어 별칭을 써야 한다
assert.equal(
	mbLatinArtist({
		id: "v",
		title: "우주를 건너",
		"artist-credit": [
			{ name: "윤석철 트리오", artist: { name: "윤석철 트리오", "sort-name": "Yun, Seok Cheol, Trio", aliases: [{ name: "YUNSEOKCHEOL TRIO", locale: "en" }] } },
		],
	}),
	"YUNSEOKCHEOL TRIO",
);

// MusicBrainz는 "멜로망스 초대"를 줘도 "초대"라는 제목의 8곡에 전부 100점을 준다.
// 입력한 아티스트는 우리가 직접 반영해야 멜로망스 곡이 위로 온다.
const melomance = ["멜로망스", "MeloMance"];
const brownEyedGirls = ["브라운아이드걸스", "Brown Eyed Girls"];
assert.equal(queryMentionsArtist("멜로망스 초대", melomance), true);
assert.equal(queryMentionsArtist("melomance 초대", melomance), true);
assert.equal(queryMentionsArtist("멜로망스 초대", brownEyedGirls), false);
assert.equal(queryMentionsArtist("초대", melomance), false);
// 짧은 라틴 이름이 아무 검색어에나 걸리면 안 된다
assert.equal(queryMentionsArtist("초대 remix", ["U;nee"]), false);
assert.equal(queryMentionsArtist("초대", ["Can"]), false);
// KOMCA는 합작을 한 칸에 몰아넣는다. 검색어가 이름을 통째로 담고 있는지만 봐서는 안 걸린다.
assert.equal(queryMentionsArtist("이영지 프리지아", ["래원(LAYONE),이영지"]), true);
assert.equal(queryMentionsArtist("이영지 프리지아", ["볼빨간사춘기", "Bolbbalgan4"]), false);

assert.deepEqual(mbArtistNames(yerin), ["백예린", "백예린", "백예린", "Yerin Baek", "Baek Ye-rin"]);

assert.equal(titleMatches("LILAC", "Lilac"), true);
assert.equal(titleMatches("LILAC (Remix)", "Lilac"), true);
assert.equal(titleMatches("Palette", "Lilac"), false);
assert.equal(titleMatches("라일락", "Lilac"), false);
// KOMCA는 버전 표기를 제목에 붙여둔다. 멜로망스 "부끄럼"의 영문 제목은 라이브 버전 저작물에만 있다.
assert.equal(titleMatches("Bashfulness", "BASHFULNESS(2022 FESTIVAL LIVE)"), true);
// 부분 문자열로 비교하면 멜로망스 "초대"가 정동하 "나에게로의 초대" 후보로 잡힌다
assert.equal(titleMatches("Invitation", "Invitation from Me"), false);
assert.equal(titleMatches("Love", "Love Story"), false);

// TIDAL은 영문 병기를 괄호로 붙여둔다
assert.equal(koreanTitleMatches("사랑으로 (love.)", "사랑으로"), true);
assert.equal(koreanTitleMatches("사랑으로", "사랑으로"), true);
assert.equal(koreanTitleMatches("사랑으로 그대에게", "사랑으로"), false);

// dismax는 "wave to earth 사랑으로"에 아티스트만 맞는 곡을 100점으로 올려보낸다
assert.equal(relatedToKoreanQuery("사랑으로", "wave"), false);
assert.equal(relatedToKoreanQuery("사랑으로", "play with earth!"), false);
assert.equal(relatedToKoreanQuery("사랑으로", "사랑으로"), true);
assert.equal(relatedToKoreanQuery("라일락", "라일락 (inst.)"), true);
assert.equal(relatedToKoreanQuery("초대", "나에게로의 초대"), true); // 부분 포함은 남긴다
// 한글을 안 친 검색어면 거를 근거가 없다
assert.equal(relatedToKoreanQuery("", "wave"), true);

console.log("match: ok");
