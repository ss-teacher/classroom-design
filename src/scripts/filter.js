// 목록 거르기 + 검색. 서버 없이 브라우저 안에서만 동작합니다.
// [data-filter-root] 안의 버튼 묶음([data-filter-group])과 검색칸([data-filter-search])으로
// 카드([data-item])를 보이거나 숨깁니다. 조건은 주소(?area=...&q=...)에도 남깁니다.

function tokens(q) {
  return q.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
}

// 검색어 낱말이 몇 개나 들어 있는지 셉니다. "전환이"처럼 조사가 붙은 낱말은 끝 글자를 떼고도 찾아봅니다.
function score(text, words) {
  let n = 0;
  for (const w of words) {
    if (text.includes(w) || (w.length >= 3 && text.includes(w.slice(0, -1)))) n++;
  }
  return n;
}

for (const root of document.querySelectorAll('[data-filter-root]')) {
  const params = new URLSearchParams(location.search);
  const search = root.querySelector('[data-filter-search]');
  const groups = [...root.querySelectorAll('[data-filter-group]')];
  const items = [...root.querySelectorAll('[data-item]')];
  const sections = [...root.querySelectorAll('[data-filter-section]')];
  const empty = root.querySelector('[data-filter-empty]');
  const count = root.querySelector('[data-filter-count]');
  const state = {};

  const setGroup = (g, value) => {
    const name = g.dataset.filterGroup;
    const buttons = [...g.querySelectorAll('button')];
    const valid = buttons.some((b) => b.dataset.value === value) ? value : '';
    state[name] = valid;
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.value === valid));
  };

  const apply = (updateUrl) => {
    const words = search ? tokens(search.value) : [];
    const need = Math.max(1, Math.ceil(words.length / 2));
    let shown = 0;
    for (const el of items) {
      let ok = Object.entries(state).every(([name, v]) => !v || (el.dataset[name] ?? '').split('|').includes(v));
      let s = 0;
      if (ok && words.length) {
        s = score(el.dataset.search ?? '', words);
        ok = s >= need;
      }
      el.hidden = !ok;
      el.style.order = words.length ? String(-s) : '';
      if (ok) shown++;
    }
    for (const sec of sections) sec.hidden = !sec.querySelector('[data-item]:not([hidden])');
    if (empty) empty.hidden = shown > 0;
    if (count) count.textContent = `${shown}개`;

    if (updateUrl) {
      const next = new URLSearchParams();
      for (const [name, v] of Object.entries(state)) if (v) next.set(name, v);
      if (search && search.value.trim()) next.set('q', search.value.trim());
      const qs = next.toString();
      history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
    }
  };

  for (const g of groups) {
    setGroup(g, params.get(g.dataset.filterGroup) ?? '');
    g.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      setGroup(g, b.dataset.value);
      apply(true);
    });
  }
  if (search) {
    search.value = params.get('q') ?? '';
    search.addEventListener('input', () => apply(true));
    search.form?.addEventListener('submit', (e) => {
      e.preventDefault();
      apply(true);
    });
  }
  apply(false);
}
