
import assert from "node:assert/strict";

import { parseWorks } from "../src/komca.native";

const HTML = `
<dl class="works_info"><!--S0727-->
	<dt class="tit2"> [대중] 라일락 - 100003416141</dt>
	<dd>
		<p><strong>부제목 :</strong>LILAC 외 1 개 <img src="/images/common/bt_more.gif" onclick="commaToTable('LILAC|^#RA IL RAG ','assttttl','1')"><span id="assttttl1"></span></p>
		<p>
			<strong class="tag">가사첫소절</strong> 나리는꽃가루에눈이따끔해
			[가수명 :아이유]
		</p>
	</dd>
</dl>
<dl class="works_info"><!--S0727-->
	<dt class="tit2"> [대중] 나의라일락 - 100004263055</dt>
	<dd>
		<p><strong>부제목 :</strong>MY LILAC 외 1 개 <img src="/images/common/bt_more.gif" onclick="commaToTable('MY LILAC|^#NA EUI RA IL RAG ','assttttl','3')"><span id="assttttl3"></span></p>
		<p>
			[가수명 :김대건 외 1 명 <img src="/images/common/bt_more.gif" onclick="commaToTable('김대건|^#KIM DAE GEON','sinaNm','3')"><span id="sinaNm3"></span>]
		</p>
	</dd>
</dl>
`;

const works = parseWorks(HTML);
assert.equal(works.length, 2);

assert.deepEqual(works[0], {
	title: "라일락",
	altTitles: ["LILAC", "RA IL RAG"],
	artists: ["아이유"],
});

assert.deepEqual(works[1], {
	title: "나의라일락",
	altTitles: ["MY LILAC", "NA EUI RA IL RAG"],
	artists: ["김대건", "KIM DAE GEON"],
});

assert.deepEqual(parseWorks("<html><body>총 <span>0</span>건</body></html>"), []);

console.log("komca parse: ok");
