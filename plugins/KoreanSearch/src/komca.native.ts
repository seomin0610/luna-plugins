/**
 * KOMCA (한국음악저작권협회) 저작물 검색
 *
 * 공개 API가 없음 srch2/srch_01.jsp 폼을 그대로 POST 하고 HTML을 파싱
 */

const SEARCH_URL = "https://www.komca.or.kr/srch2/srch_01.jsp";
/** KOMCA가 여러 값을 한 문자열에 넣을 때 쓰는 구분자 */
const MULTI_SEP = "|^#";
const TIMEOUT_MS = 12_000;

export type KomcaWork = {
	title: string;
	altTitles: string[];
	artists: string[];
};

const decodeEntities = (value: string) =>
	value
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");

const clean = (value: string) => decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

const splitMulti = (value: string) =>
	value
		.split(MULTI_SEP)
		.map((part) => clean(part))
		.filter(Boolean);

/** 외 3 개,외 2 명 같은 꼬리표 제거 */
const stripMoreSuffix = (value: string) => value.replace(/외\s*\d+\s*[개명]$/, "").trim();

const parseTitle = (block: string) => {
	const raw = block.match(/<dt class="tit2">([\s\S]*?)<\/dt>/)?.[1];
	if (!raw) return "";
	// 맨 뒤 작품코드만 자르기
	return clean(raw)
		.replace(/^\[[^\]]*\]\s*/, "")
		.replace(/\s*-\s*\d+\s*$/, "")
		.trim();
};

const parseMultiField = (block: string, fieldId: string, inlinePattern: RegExp) => {
	const fromScript = block.match(new RegExp(`commaToTable\\('([^']*)','${fieldId}'`))?.[1];
	if (fromScript) return splitMulti(fromScript);
	const inline = block.match(inlinePattern)?.[1];
	if (!inline) return [];
	const value = stripMoreSuffix(clean(inline));
	return value ? [value] : [];
};

export const parseWorks = (html: string): KomcaWork[] => {
	const works: KomcaWork[] = [];
	for (const [, block] of html.matchAll(/<dl class="works_info">([\s\S]*?)<\/dl>/g)) {
		const title = parseTitle(block);
		if (!title) continue;
		works.push({
			title,
			altTitles: parseMultiField(block, "assttttl", /<strong>부제목\s*:<\/strong>([^<]*)/),
			artists: parseMultiField(block, "sinaNm", /\[가수명\s*:([^\]<]*)/),
		});
	}
	return works;
};

/**
 * @param title 저작물명 (ko)
 * @param artist
 * @param exact true면 완전일치 false면 포함 검색
 */
export const komcaSearch = async (title: string, artist?: string, exact = false): Promise<KomcaWork[]> => {
	if (!title.trim()) return [];
	const body = new URLSearchParams({
		S_PAGENUMBER: "1",
		PAGE_INIT: "1",
		SLCT_SORT_FLDS: "basic",
		S_HNAB_GBN: "I",
		S_PROD_TTL: title.trim().toUpperCase(),
		S_PROD_TTL_GB: exact ? "0" : "3",
		S_SINA_NM: (artist ?? "").trim().toUpperCase(),
		S_DISCTITLE_NM: "",
		S_RIGHTPRES_NM: "",
		S_RIGHTPRES_CD: "",
		S_RIGHTPRES_GB: "1",
		S_SECT_CD: "",
		S_LIB_YN: "N",
		S_START_DAY: "",
		S_END_DAY: "",
	});

	const res = await fetch(SEARCH_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
	return parseWorks(await res.text());
};
