// 노션을 한 번 읽어 사이트가 쓸 자료 파일(src/data/notion.json)을 만듭니다.
//   일반:      node scripts/fetch-notion.mjs            → '공개' 켜진 줄만
//   미리보기:  node scripts/fetch-notion.mjs --preview  → 꺼진 줄도 포함 (내 컴퓨터에서만)
// 실패하면 0이 아닌 값으로 끝나서, 뒤따르는 '사이트 만들기'가 진행되지 않습니다.

import { mkdir, rm, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTION } from '../site.config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = path.join(ROOT, 'src', 'data', 'notion.json');
const FILES_DIR = path.join(ROOT, 'public', 'files');

const PREVIEW = process.argv.includes('--preview');
const TOKEN = process.env.NOTION_TOKEN?.trim();
const report = []; // 만들기 기록

function log(line) {
  report.push(line);
  console.log(line);
}

if (PREVIEW && (process.env.CI || process.env.GITHUB_ACTIONS)) {
  console.error('중단: 미리보기 모드는 인터넷에 올리는 과정에서 쓸 수 없습니다.');
  process.exit(1);
}
if (!TOKEN) {
  console.error('중단: NOTION_TOKEN 이 없습니다. (.env 파일 또는 저장소 비밀값을 확인하세요)');
  process.exit(1);
}

// ── 노션 호출 (초당 3회 제한을 넘지 않게 간격을 둡니다) ──
let last = 0;
async function notion(pathname, body) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const gap = 350 - (Date.now() - last);
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    last = Date.now();
    const res = await fetch(`https://api.notion.com/v1/${pathname}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Notion-Version': NOTION.version,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after')) || 2 * (attempt + 1);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const json = await res.json();
    if (!res.ok) throw new Error(`노션 응답 ${res.status} ${json.code ?? ''}: ${json.message ?? ''}`);
    return json;
  }
  throw new Error('노션이 계속 응답하지 않습니다.');
}

async function queryAll(id) {
  const rows = [];
  let cursor;
  do {
    const page = await notion(`data_sources/${id}/query`, {
      page_size: 100,
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
      // 일반 모드에서는 '공개'가 꺼진 줄을 아예 가져오지 않습니다.
      ...(PREVIEW ? {} : { filter: { property: '공개', checkbox: { equals: true } } }),
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    rows.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return rows;
}

async function blockChildren(id) {
  const blocks = [];
  let cursor;
  do {
    const page = await notion(`blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    blocks.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

// ── 속성 읽기 도우미 ──
const plain = (rich) => (rich ?? []).map((t) => t.plain_text).join('').trim();
const P = (row, name) => row.properties?.[name];
const title = (row) => plain(Object.values(row.properties).find((p) => p.type === 'title')?.title);
const text = (row, name) => plain(P(row, name)?.rich_text);
const select = (row, name) => P(row, name)?.select?.name ?? null;
const multi = (row, name) => (P(row, name)?.multi_select ?? []).map((o) => o.name);
const check = (row, name) => P(row, name)?.checkbox === true;
const relation = (row, name) => (P(row, name)?.relation ?? []).map((r) => r.id);
// 노션 페이지 아이콘(이모지)을 카드 그림으로 씁니다.
const icon = (row) => (row.icon?.type === 'emoji' ? row.icon.emoji : null);
const url = (row, name) => {
  const u = P(row, name)?.url?.trim();
  return u && /^https?:\/\//i.test(u) ? u : null;
};

// 적용 아이디어 한 줄: "**제목** — 한 줄 설명"
function parseIdea(rich) {
  let i = 0;
  let head = '';
  while (i < rich.length && (rich[i].annotations?.bold || (head && !rich[i].plain_text.trim()))) {
    head += rich[i].plain_text;
    i++;
  }
  let rest = rich.slice(i).map((t) => t.plain_text).join('');
  if (!head.trim()) {
    const m = plain(rich).match(/^(.+?)\s+[—–-]\s+(.+)$/s);
    if (m) [head, rest] = [m[1], m[2]];
    else [head, rest] = [plain(rich), ''];
  }
  head = head.trim();
  rest = rest.replace(/^[\s—–\-:]+/, '').trim();
  const teacher = /^\(선생님\)/.test(head);
  if (teacher) head = head.replace(/^\(선생님\)\s*/, '');
  return head ? { title: head, desc: rest, teacher } : null;
}

// ── 주소 이름 검사: 비었거나, 겹치거나, 주소에 못 쓰는 글자가 있으면 건너뜁니다 ──
function validSlugs(kind, items) {
  const count = new Map();
  for (const it of items) if (it.slug) count.set(it.slug, (count.get(it.slug) ?? 0) + 1);
  return items.filter((it) => {
    let why = null;
    if (!it.slug) why = "'주소 이름'이 비어 있음";
    else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(it.slug)) why = `'주소 이름'에 쓸 수 없는 글자 (${it.slug})`;
    else if (count.get(it.slug) > 1) why = `'주소 이름'이 겹침 (${it.slug})`;
    if (why) log(`  건너뜀 [${kind}] ${it.title || '(제목 없음)'} — ${why}`);
    return !why;
  });
}

const safeName = (name) => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim() || 'file';

async function main() {
  log(`노션 읽기 시작 (${PREVIEW ? '미리보기 모드: 꺼진 줄 포함' : "일반 모드: '공개' 켜진 줄만"})`);

  const [sceneRows, conceptRows, resourceRows] = [
    await queryAll(NOTION.sources.scenes),
    await queryAll(NOTION.sources.concepts),
    await queryAll(NOTION.sources.resources),
  ];

  let scenes = sceneRows.map((r) => ({
    id: r.id,
    slug: text(r, '주소 이름'),
    title: title(r),
    icon: icon(r),
    empathy: text(r, '공감 문장'),
    why: text(r, '왜 그럴까'),
    area: select(r, '영역'),
    seasons: multi(r, '시기'),
    published: check(r, '공개'),
    _concepts: relation(r, '관련 개념'),
    _resources: relation(r, '관련 자료'),
  }));
  let concepts = conceptRows.map((r) => ({
    id: r.id,
    slug: text(r, '주소 이름'),
    title: title(r),
    icon: icon(r),
    summary: text(r, '한 문장 설명'),
    inClass: text(r, '교실에서는'),
    principles: multi(r, '원리'),
    field: select(r, '분야'),
    core: check(r, '핵심 개념'),
    published: check(r, '공개'),
    ideas: [],
    _scenes: relation(r, '관련 장면'),
    _resources: relation(r, '관련 자료'),
  }));
  let resources = resourceRows.map((r) => ({
    id: r.id,
    slug: text(r, '주소 이름'),
    title: title(r),
    icon: icon(r),
    intro: text(r, '한 줄 소개'),
    type: select(r, '유형'),
    area: select(r, '영역'),
    seasons: multi(r, '시기'),
    grades: multi(r, '대상 학년'),
    runUrl: url(r, '실행 링크'),
    published: check(r, '공개'),
    files: [],
    _files: P(r, '파일')?.files ?? [],
    _concepts: relation(r, '근거 개념'),
    _scenes: relation(r, '관련 장면'),
  }));

  // 이중 안전장치: 일반 모드에서는 혹시라도 꺼진 줄이 섞이면 버립니다.
  if (!PREVIEW) {
    scenes = scenes.filter((x) => x.published);
    concepts = concepts.filter((x) => x.published);
    resources = resources.filter((x) => x.published);
  }

  scenes = validSlugs('장면', scenes);
  concepts = validSlugs('개념', concepts);
  resources = validSlugs('자료', resources);

  // 개념 본문에서 적용 아이디어 읽기
  for (const c of concepts) {
    const blocks = await blockChildren(c.id);
    c.ideas = blocks
      .filter((b) => b.type === 'bulleted_list_item')
      .map((b) => parseIdea(b.bulleted_list_item.rich_text ?? []))
      .filter(Boolean);
  }

  // 자료 파일 내려받기 (노션 파일 주소는 1시간 뒤 만료되므로 사이트 안에 넣습니다)
  await rm(FILES_DIR, { recursive: true, force: true });
  for (const r of resources) {
    const used = new Set();
    for (const f of r._files) {
      const src = f.file?.url ?? f.external?.url;
      if (!src) continue;
      if (f.type === 'external') {
        r.files.push({ name: f.name || '파일', href: src, external: true });
        continue;
      }
      let name = safeName(f.name || 'file');
      while (used.has(name)) name = `_${name}`;
      used.add(name);
      const res = await fetch(src);
      if (!res.ok) throw new Error(`파일 내려받기 실패 (${r.title} / ${f.name}): ${res.status}`);
      const dir = path.join(FILES_DIR, r.slug);
      await mkdir(dir, { recursive: true });
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(path.join(dir, name), buf);
      r.files.push({ name: f.name || name, path: `files/${r.slug}/${encodeURIComponent(name)}`, size: buf.length });
    }
  }

  // 연결(관계형) 정리: 사이트에 나오는 줄끼리만, 양쪽 방향을 합쳐서 연결합니다.
  const slugOf = new Map([...scenes, ...concepts, ...resources].map((x) => [x.id, x.slug]));
  const link = (a, aKey, b, bKey, aOut, bOut) => {
    const pairs = new Set();
    for (const x of a) for (const id of x[aKey]) if (b.some((y) => y.id === id)) pairs.add(`${x.id}|${id}`);
    for (const y of b) for (const id of y[bKey]) if (a.some((x) => x.id === id)) pairs.add(`${id}|${y.id}`);
    for (const x of a) x[aOut] = [...pairs].filter((p) => p.startsWith(x.id + '|')).map((p) => slugOf.get(p.split('|')[1]));
    for (const y of b) y[bOut] = [...pairs].filter((p) => p.endsWith('|' + y.id)).map((p) => slugOf.get(p.split('|')[0]));
  };
  link(scenes, '_concepts', concepts, '_scenes', 'concepts', 'scenes');
  link(scenes, '_resources', resources, '_scenes', 'resources', 'scenes');
  link(concepts, '_resources', resources, '_concepts', 'resources', 'concepts');

  const clean = (list) => list.map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !k.startsWith('_') && k !== 'id')));
  const data = {
    preview: PREVIEW,
    fetchedAt: new Date().toISOString(),
    scenes: clean(scenes),
    concepts: clean(concepts),
    resources: clean(resources),
  };

  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');

  log(`완료: 장면 ${scenes.length}개, 개념 ${concepts.length}개, 자료 ${resources.length}개`);
  const noIdeas = concepts.filter((c) => !c.ideas.length).map((c) => c.title);
  if (noIdeas.length) log(`  참고: 적용 아이디어가 없는 개념 — ${noIdeas.join(', ')}`);
}

async function writeSummary(ok) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const head = ok ? '### 노션 반영 기록' : '### 노션 반영 실패 — 기존 사이트를 그대로 둡니다';
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${head}\n\n\`\`\`\n${report.join('\n')}\n\`\`\`\n`);
}

try {
  await main();
  await writeSummary(true);
} catch (e) {
  log(`실패: ${e.message}`);
  await writeSummary(false);
  process.exit(1);
}
