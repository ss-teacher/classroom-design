// 사이트 화면들이 함께 쓰는 자료와 도우미.
// 자료는 scripts/fetch-notion.mjs 가 노션에서 읽어 만든 notion.json 에서 옵니다.
import { createHash } from 'node:crypto';
import raw from '../data/notion.json';
import {
  SEASON_MONTHS,
  SEASON_DEFAULT,
  SEASON_ALWAYS,
  SEASON_RESOURCE_COUNT,
  AREAS,
  HOME_SCENE_COUNT,
  EMOJI,
} from '../../site.config.mjs';

// 안전장치: 미리보기 자료(꺼진 줄 포함)로는 실제 사이트를 만들 수 없습니다.
if (import.meta.env.PROD && raw.preview) {
  throw new Error('미리보기 자료로는 사이트를 만들 수 없습니다. "npm run build" 로 다시 만드세요.');
}

export const preview = raw.preview === true;
export const scenes = raw.scenes;
export const concepts = raw.concepts;
export const resources = raw.resources;

const bySlug = (list) => new Map(list.map((x) => [x.slug, x]));
const sceneMap = bySlug(scenes);
const conceptMap = bySlug(concepts);
const resourceMap = bySlug(resources);
const pick = (map, slugs) => (slugs ?? []).map((s) => map.get(s)).filter(Boolean);

export const scenesOf = (item) => pick(sceneMap, item.scenes);
export const conceptsOf = (item) => pick(conceptMap, item.concepts);
export const resourcesOf = (item) => pick(resourceMap, item.resources);

// 주소 만들기 — 사이트가 하위 주소(예: /저장소이름/)에 올라가도 링크가 맞도록 합니다.
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
export const href = (path) => `${base}${path}`;

// 시기 규칙
export function seasonOfMonth(month) {
  for (const [season, months] of Object.entries(SEASON_MONTHS)) if (months.includes(month)) return season;
  return SEASON_DEFAULT;
}
export function currentSeason(date = new Date()) {
  const month = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: 'numeric' }).format(date));
  return seasonOfMonth(month);
}
export function seasonResources(season) {
  const main = resources.filter((r) => r.seasons.includes(season));
  const always = resources.filter((r) => !main.includes(r) && r.seasons.includes(SEASON_ALWAYS));
  const fill = main.length < SEASON_RESOURCE_COUNT ? always : [];
  return [...main, ...fill].slice(0, SEASON_RESOURCE_COUNT);
}

// 첫 화면 장면 카드: 영역이 골고루 섞이도록 돌아가며 고릅니다.
export function homeScenes() {
  const groups = AREAS.map((a) => scenes.filter((s) => s.area === a));
  groups.push(scenes.filter((s) => !AREAS.includes(s.area)));
  const out = [];
  for (let i = 0; out.length < Math.min(HOME_SCENE_COUNT, scenes.length); i++) {
    for (const g of groups) if (g[i] && out.length < HOME_SCENE_COUNT) out.push(g[i]);
  }
  return out;
}

// 비슷한 장면: 같은 개념을 공유하거나 같은 영역인 장면 2~3개
export function similarScenes(scene, max = 3) {
  return scenes
    .filter((s) => s.slug !== scene.slug)
    .map((s) => ({
      s,
      score: s.concepts.filter((c) => scene.concepts.includes(c)).length * 2 + (s.area && s.area === scene.area ? 1 : 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.s);
}

const slugKey = (slug) => createHash('sha256').update(slug).digest('hex').slice(0, 8);
// 그림(이모지) 고르기: 노션 아이콘 → 기본 그림 → 영역·원리·유형 그림
export const sceneEmoji = (s) => s.icon || EMOJI.scene[slugKey(s.slug)] || EMOJI.area[s.area] || EMOJI.fallback.scene;
export const conceptEmoji = (c) => c.icon || EMOJI.principle[c.principles[0]] || EMOJI.fallback.concept;
export const resourceEmoji = (r) => r.icon || EMOJI.type[r.type] || EMOJI.fallback.resource;

export const searchText =(...parts) => parts.filter(Boolean).join(' ').toLowerCase();
