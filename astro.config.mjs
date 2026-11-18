import { defineConfig } from 'astro/config';

// 사이트 주소 정하기
//  · GitHub에서 만들 때: 저장소 이름으로 자동 계산합니다. (예: https://아이디.github.io/저장소이름/)
//  · 나중에 내 도메인을 쓰게 되면: SITE_URL, BASE_PATH 값을 직접 정해 덮어씁니다.
//  · 내 컴퓨터에서는 비어 있어도 됩니다.
const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
const onGitHub = Boolean(process.env.GITHUB_ACTIONS && owner && repo);
const userSite = `${owner}.github.io`.toLowerCase();

const site = process.env.SITE_URL || (onGitHub ? `https://${userSite}` : undefined);
const base = process.env.BASE_PATH || (onGitHub && repo.toLowerCase() !== userSite ? `/${repo}` : '/');

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
});
