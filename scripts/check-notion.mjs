// 노션 읽기 확인용 스크립트 (3단계)
// 실행: node --env-file=.env scripts/check-notion.mjs
// 세 공개용 데이터베이스만 읽습니다. 키는 화면에 출력하지 않습니다.

const TOKEN = process.env.NOTION_TOKEN?.trim();
const VERSION = '2026-03-11';
const PUBLIC_PAGE = '41b2d3fd8c64815e92dad63bd19bf9e9';
const SOURCES = {
  장면: '41b2d3fd-8c64-81cd-92b4-000b6efcb662',
  개념: '41b2d3fd-8c64-8166-9860-000bcb7ff5e8',
  자료: '41b2d3fd-8c64-8100-8e9a-000bd352043a',
};

if (!TOKEN) {
  console.error('실패: .env 파일의 NOTION_TOKEN 이 비어 있습니다.');
  process.exit(1);
}

async function notion(path, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://api.notion.com/v1/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Notion-Version': VERSION,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 || res.status === 529) {
      const wait = Number(res.headers.get('retry-after') ?? 2);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const json = await res.json();
    if (!res.ok) throw new Error(`${res.status} ${json.code ?? ''}: ${json.message ?? ''}`);
    return json;
  }
  throw new Error('노션이 계속 바쁘다고 응답합니다. 잠시 후 다시 시도하세요.');
}

async function queryAll(id) {
  const rows = [];
  let cursor;
  do {
    const page = await notion(`data_sources/${id}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    rows.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return rows;
}

const text = (prop) =>
  (prop?.title ?? prop?.rich_text ?? []).map((t) => t.plain_text).join('').trim();
const titleOf = (row) => text(Object.values(row.properties).find((p) => p.type === 'title'));
const norm = (id) => (id ?? '').replaceAll('-', '');

let failed = false;
for (const [name, id] of Object.entries(SOURCES)) {
  try {
    const rows = await queryAll(id);
    const items = rows.map((r) => ({
      title: titleOf(r),
      slug: text(r.properties['주소 이름']),
      pub: r.properties['공개']?.checkbox === true,
    }));
    const pub = items.filter((i) => i.pub);
    console.log(`\n■ ${name}: 전체 ${items.length}개 / 공개 ${pub.length}개`);
    console.log('  [실제 사이트에 나올 줄]');
    console.log(pub.length ? pub.map((i) => `   - ${i.title}`).join('\n') : '   (없음)');
    console.log('  [미리보기 모드에서만 보이는 줄]');
    for (const i of items.filter((x) => !x.pub)) console.log(`   - ${i.title}  (${i.slug || '주소 이름 없음'})`);

    const empty = items.filter((i) => !i.slug);
    const seen = new Map();
    for (const i of items) if (i.slug) seen.set(i.slug, [...(seen.get(i.slug) ?? []), i.title]);
    const dup = [...seen].filter(([, t]) => t.length > 1);
    const bad = items.filter((i) => i.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(i.slug));
    if (empty.length) console.log(`  ! 주소 이름이 빈 줄: ${empty.map((i) => i.title).join(', ')}`);
    for (const [s, t] of dup) console.log(`  ! 주소 이름 겹침 "${s}": ${t.join(', ')}`);
    if (bad.length) console.log(`  ! 주소 이름에 영문 소문자·숫자·하이픈 외 글자: ${bad.map((i) => `${i.title}(${i.slug})`).join(', ')}`);
  } catch (e) {
    failed = true;
    console.log(`\n■ ${name}: 읽기 실패 — ${e.message}`);
  }
}

// 권한 범위 점검: 이 연결이 볼 수 있는 것이 공개용 페이지 아래뿐인지 확인합니다.
try {
  const all = [];
  let cursor;
  do {
    const page = await notion('search', { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    all.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor && all.length < 2000);

  const known = new Set([PUBLIC_PAGE, ...Object.values(SOURCES).map(norm)]);
  const parentId = (o) => {
    const p = o.parent ?? {};
    return norm(p.data_source_id ?? p.database_id ?? p.page_id ?? p.block_id ?? '');
  };
  // 공개용 페이지에서 내려오는 것들을 반복해서 넓혀 갑니다.
  let grew = true;
  while (grew) {
    grew = false;
    for (const o of all) {
      if (!known.has(norm(o.id)) && known.has(parentId(o))) {
        known.add(norm(o.id));
        grew = true;
      }
    }
  }
  const outside = all.filter((o) => !known.has(norm(o.id)));
  console.log(`\n■ 권한 범위: 이 연결이 볼 수 있는 항목 ${all.length}개 중 공개용 페이지 밖 ${outside.length}개`);
  if (outside.length) console.log('  ! 공개용 페이지 밖의 내용에도 권한이 있습니다. 노션 연결의 접근 범위를 줄여 주세요.');
} catch (e) {
  console.log(`\n■ 권한 범위 점검 실패 — ${e.message}`);
}

process.exit(failed ? 1 : 0);
