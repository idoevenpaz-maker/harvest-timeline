(async function () {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const timeline = $('#timeline');
  let data, media;
  try {
    const bust = '?v=' + Math.floor(Date.now() / 36e5); // hourly cache-bust
    [data, media] = await Promise.all([
      fetch('data/incidents.json' + bust).then((r) => { if (!r.ok) throw r.status; return r.json(); }),
      fetch('data/media.json' + bust).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
  } catch (e) {
    timeline.innerHTML = '<p class="empty">לא הצלחנו לטעון את הנתונים. רעננו את הדף כדי לנסות שוב.</p>';
    return;
  }

  const { meta, groups, incidents } = data;
  const YD_PAGE = 'https://www.yesh-din.org/settler-violence-during-the-olive-harvest/';
  const ICONS = {
    video: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M13.5 10 8 13.2V6.8z" fill="currentColor"/></svg>',
    article: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="2" width="14" height="16" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 6.5h8M6 9.5h8M6 12.5h5" stroke="currentColor" stroke-width="1.6"/></svg>',
  };
  const KIND_LABEL = { video: 'סרטון', article: 'כתבה' };

  // ---------- dates ----------
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, d || 1)); };
  const iso = (dt) => dt.toISOString().slice(0, 10);
  const fmtWeekday = new Intl.DateTimeFormat('he', { weekday: 'long', timeZone: 'UTC' });
  const fmtMonthYear = new Intl.DateTimeFormat('he', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const fmtMonth = new Intl.DateTimeFormat('he', { month: 'long', timeZone: 'UTC' });
  const fmtFull = new Intl.DateTimeFormat('he', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  const allDays = [];
  for (let d = parse(meta.start); iso(d) <= meta.latest; d = new Date(d.getTime() + 864e5)) allDays.push(iso(d));
  const BUCKETS = {
    year: [...new Set(allDays.map((d) => d.slice(0, 4)))],
    month: [...new Set(allDays.map((d) => d.slice(0, 7)))],
    day: allDays,
  };
  const keyOf = { year: (d) => d.slice(0, 4), month: (d) => d.slice(0, 7), day: (d) => d };
  const bucketLabel = {
    year: (k) => `שנת ${k}`,
    month: (k) => fmtMonthYear.format(parse(k)),
    day: (k) => `${fmtWeekday.format(parse(k))}, ${fmtFull.format(parse(k))}`,
  };
  const KEY_TEXT = { year: 'אירועים בשנה', month: 'אירועים בחודש', day: 'אירועים ביום' };
  const isKilling = (i) => i.groups.includes('killing');

  $('#updated').textContent = fmtFull.format(parse(meta.updated));
  $('#zman-date').textContent = fmtFull.format(parse(meta.zman_extracted));
  $('#lede').textContent =
    `${incidents.length.toLocaleString('he')} אירועי אלימות של מתנחלים נגד פלסטינים בגדה המערבית ובמזרח ירושלים מאז ${fmtFull.format(parse(meta.start))}, יום אחר יום.`;

  // ---------- filter controls ----------
  const groupSel = $('#f-group');
  for (const [k, v] of Object.entries(groups)) groupSel.insertAdjacentHTML('beforeend', `<option value="${esc(k)}">${esc(v)}</option>`);
  const placeCounts = {};
  incidents.forEach((i) => { placeCounts[i.place] = (placeCounts[i.place] || 0) + 1; });
  $('#places-list').innerHTML = Object.keys(placeCounts).filter((p) => placeCounts[p] > 1)
    .sort((a, b) => a.localeCompare(b, 'he')).map((p) => `<option value="${esc(p)}">`).join('');

  const params = new URLSearchParams(location.search);
  const state = {
    group: groups[params.get('group')] ? params.get('group') : '',
    place: params.get('place') || '',
    mediaOnly: params.get('media') === '1',
    chart: BUCKETS[params.get('chart')] ? params.get('chart') : 'day',
  };
  groupSel.value = state.group;
  $('#f-place').value = state.place;
  $('#f-media').checked = state.mediaOnly;

  const syncUrl = () => {
    const p = new URLSearchParams();
    if (state.group) p.set('group', state.group);
    if (state.place) p.set('place', state.place);
    if (state.mediaOnly) p.set('media', '1');
    if (state.chart !== 'day') p.set('chart', state.chart);
    const q = p.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
  };

  const matches = (i) =>
    (!state.group || i.groups.includes(state.group)) &&
    (!state.place || i.place.includes(state.place)) &&
    (!state.mediaOnly || (media[i.id] && media[i.id].length));

  // ---------- chart ----------
  const chartBox = $('.chart');
  const scroller = $('#chart-scroll');
  const inner = $('#chart-inner');
  const strip = $('#strip');
  const axis = $('#strip-axis');
  const btnOlder = $('.scroll-older');
  const btnNewer = $('.scroll-newer');
  let shown = incidents;

  function renderChart() {
    const mode = state.chart;
    const keys = BUCKETS[mode];
    const key = keyOf[mode];
    const counts = {}, kills = {}, dead = {}, deadMin = {}, vids = {};
    for (const i of shown) {
      const k = key(i.date);
      counts[k] = (counts[k] || 0) + 1;
      if (isKilling(i)) kills[k] = (kills[k] || 0) + 1;
      if (i.killed) {
        dead[k] = (dead[k] || 0) + i.killed;
        if (i.src === 'zm') deadMin[k] = true; // Zman lists fatal incidents, not the number killed
      }
      for (const m of media[i.id] || []) {
        if (m.kind !== 'video') continue;
        const list = (vids[k] ||= []);
        if (!list.some((v) => v.url === m.url)) list.push({ ...m, place: i.place, date: i.date });
      }
    }
    barInfo = { mode, counts, dead, deadMin, vids };
    const max = Math.max(1, ...keys.map((k) => counts[k] || 0));
    chartBox.classList.toggle('is-days', mode === 'day');
    $('#key-all').textContent = KEY_TEXT[mode];
    $('#key-video').hidden = !Object.keys(vids).length;

    strip.innerHTML = keys.map((k) => {
      const n = counts[k] || 0, kl = kills[k] || 0;
      const label = tipLines(k).join(', ');
      const nv = (vids[k] || []).length;
      return `<button type="button" class="day-bar${n ? '' : ' is-empty'}${nv ? ' has-video' : ''}" role="listitem" data-key="${k}" aria-label="${esc(label + (nv ? `, ${nv} סרטונים` : ''))}"${n ? '' : ' aria-disabled="true"'}>` +
        `<span class="b-killed-seg" style="height:${(kl / max) * 100}%"></span>` +
        `<span class="b-all" style="height:${((n - kl) / max) * 100}%"></span>` +
        (nv ? '<span class="b-vid" aria-hidden="true"></span>' : '') + '</button>';
    }).join('');

    // axis labels
    const pos = (idx) => `right:${(idx / keys.length) * 100}%`;
    let ticks = '';
    keys.forEach((k, idx) => {
      if (mode === 'year') ticks += `<span style="${pos(idx)}">${k}</span>`;
      else if (mode === 'month' && k.endsWith('-01')) ticks += `<span style="${pos(idx)}">${k.slice(0, 4)}</span>`;
      else if (mode === 'day' && k.endsWith('-01')) {
        const dt = parse(k);
        ticks += `<span style="${pos(idx)}">${esc(fmtMonth.format(dt))}${k.slice(5, 7) === '01' ? ' ' + k.slice(0, 4) : ''}</span>`;
      }
    });
    // where the data source changes (Zman -> Yesh Din): Yesh Din documents far more incidents per period
    const sw = meta.yd_start;
    let swPos = -1;
    if (mode === 'day') swPos = keys.indexOf(sw);
    else if (mode === 'month') swPos = keys.indexOf(sw.slice(0, 7)) + (Number(sw.slice(8, 10)) - 1) / 30;
    else swPos = keys.indexOf(sw.slice(0, 4)) + (parse(sw) - parse(sw.slice(0, 4))) / (365 * 864e5);
    if (swPos >= 0) ticks += `<span class="src-switch" style="right:${(swPos / keys.length) * 100}%">מכאן: יש דין</span>`;
    axis.innerHTML = ticks;

    updateScrollButtons();
  }

  // ---------- hover tooltip ----------
  let barInfo = null;
  function tipLines(k) {
    const { mode, counts, dead, deadMin } = barInfo;
    const lines = [];
    if (mode === 'day') {
      lines.push(`${k.slice(8, 10)}/${k.slice(5, 7)}/${k.slice(0, 4)}`, fmtWeekday.format(parse(k)));
    } else if (mode === 'month') {
      lines.push(fmtMonthYear.format(parse(k)));
    } else {
      lines.push(k);
    }
    const n = counts[k] || 0, d = dead[k] || 0;
    lines.push(`מספר אירועים: ${n.toLocaleString('he')}`);
    lines.push(`מספר הרוגים: ${deadMin[k] ? 'לפחות ' : ''}${d.toLocaleString('he')}`);
    return lines;
  }
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('aria-hidden', 'true');
  tip.hidden = true;
  document.body.appendChild(tip);
  let tipKey = null, pinned = false, hideTimer = null;
  const MAX_TIP_VIDEOS = 3;
  function tipVideosHtml(k) {
    const list = barInfo.vids[k] || [];
    if (!list.length) return '';
    const items = list.slice(0, MAX_TIP_VIDEOS).map((v) =>
      `<a class="tip-vid" href="${esc(v.url)}" target="_blank" rel="noopener" tabindex="-1">` +
        (v.thumb ? `<img src="${esc(v.thumb)}" alt="" width="128" height="72" decoding="async">` : '<span class="tv-noimg">▶</span>') +
        `<span class="tv-text"><span class="tv-title" dir="auto">${esc(v.title)}</span>` +
        `<span class="tv-meta">${esc([v.source, barInfo.mode === 'day' ? v.place : `${v.place}, ${v.date.slice(8, 10)}/${v.date.slice(5, 7)}`].filter(Boolean).join(' | '))}</span></span></a>`
    ).join('');
    const extra = list.length - MAX_TIP_VIDEOS;
    const more = extra > 0
      ? `<span class="tv-more">${extra === 1 ? 'ועוד סרטון אחד' : `ועוד ${extra} סרטונים`}. לחצו על העמודה כדי לראות את כולם.</span>` : '';
    return `<div class="tip-vids">${items}${more}</div>`;
  }
  function showTip(bar, x, y) {
    clearTimeout(hideTimer);
    const k = bar.dataset.key;
    if (k !== tipKey) {
      tipKey = k;
      const [first, ...rest] = tipLines(k);
      const videos = tipVideosHtml(k);
      tip.innerHTML = `<strong>${esc(first)}</strong>` + rest.map((l) => `<span>${esc(l)}</span>`).join('') + videos;
      pinned = !!videos;
      tip.classList.toggle('is-pinned', pinned);
    }
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight, gap = 14;
    let left, top;
    if (pinned) {
      // anchored just under the bar, so the pointer can move straight down into the box
      const b = bar.getBoundingClientRect(), s = strip.getBoundingClientRect();
      left = b.left + b.width / 2 - w / 2;
      top = s.bottom + 4;
      if (top + h > innerHeight - 8) top = Math.max(8, s.top - h - 4);
    } else {
      left = x - w - gap;                       // RTL: prefer the box to the left of the pointer
      if (left < 8) left = x + gap;
      top = y + gap;
      if (top + h > innerHeight - 8) top = y - h - gap;
    }
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function hideTip() { clearTimeout(hideTimer); tip.hidden = true; tipKey = null; pinned = false; }
  const hideSoon = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hideTip, pinned ? 400 : 0); };
  strip.addEventListener('mousemove', (e) => {
    const bar = e.target.closest('.day-bar');
    if (bar) showTip(bar, e.clientX, e.clientY); else if (!pinned) hideTip();
  });
  strip.addEventListener('mouseleave', hideSoon);
  tip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  tip.addEventListener('mouseleave', hideSoon);
  window.addEventListener('scroll', () => { if (!tip.hidden) hideTip(); }, { passive: true });
  strip.addEventListener('focusin', (e) => {
    const bar = e.target.closest('.day-bar');
    if (!bar || !bar.matches(':focus-visible')) return;
    const r = bar.getBoundingClientRect();
    showTip(bar, r.left + r.width / 2, r.top + r.height / 2);
  });
  strip.addEventListener('focusout', hideTip);
  scroller.addEventListener('scroll', hideTip, { passive: true });

  function scrollToNewest() {
    // RTL: the newest dates are at the left end
    scroller.style.scrollBehavior = 'auto';
    scroller.scrollLeft = -(scroller.scrollWidth - scroller.clientWidth);
    scroller.style.scrollBehavior = '';
    updateScrollButtons();
  }
  function updateScrollButtons() {
    const overflow = scroller.scrollWidth - scroller.clientWidth;
    const atRight = scroller.scrollLeft >= -2;              // oldest end
    const atLeft = -scroller.scrollLeft >= overflow - 2;    // newest end
    btnOlder.hidden = overflow <= 2 || atRight;
    btnNewer.hidden = overflow <= 2 || atLeft;
  }
  scroller.addEventListener('scroll', updateScrollButtons, { passive: true });
  // full-bleed chart: 100vw includes the page scrollbar, so subtract it
  const setSbw = () => document.documentElement.style.setProperty('--sbw', (innerWidth - document.documentElement.clientWidth) + 'px');
  setSbw();
  window.addEventListener('resize', () => { setSbw(); updateScrollButtons(); });
  // mouse wheel over the chart scrolls it sideways: wheel down -> right (earlier dates), wheel up -> left.
  // At either end the wheel goes back to scrolling the page.
  scroller.addEventListener('wheel', (e) => {
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // pinch-zoom / horizontal trackpad: native
    const overflow = scroller.scrollWidth - scroller.clientWidth;
    if (overflow <= 2) return;
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scroller.clientWidth : 1);
    const canRight = scroller.scrollLeft < -1;
    const canLeft = -scroller.scrollLeft < overflow - 1;
    if ((dy > 0 && !canRight) || (dy < 0 && !canLeft)) return;
    e.preventDefault();
    hideTip();
    scroller.scrollBy({ left: dy, behavior: 'instant' });
  }, { passive: false });
  btnOlder.addEventListener('click', () => scroller.scrollBy({ left: scroller.clientWidth * 0.8 }));
  btnNewer.addEventListener('click', () => scroller.scrollBy({ left: -scroller.clientWidth * 0.8 }));

  // keep the bar of the day being read visible inside the chart (horizontal only)
  function revealBar(bar) {
    if (scroller.scrollWidth <= scroller.clientWidth) return;
    const b = bar.getBoundingClientRect(), c = scroller.getBoundingClientRect();
    if (b.left < c.left + 20 || b.right > c.right - 20) {
      scroller.scrollBy({ left: (b.left + b.width / 2) - (c.left + c.width / 2) });
    }
  }

  const segButtons = [...document.querySelectorAll('.seg button')];
  const setSeg = () => segButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.chart === state.chart)));
  segButtons.forEach((b) => b.addEventListener('click', () => {
    if (state.chart === b.dataset.chart) return;
    state.chart = b.dataset.chart; setSeg(); syncUrl(); renderChart(); scrollToNewest(); markCurrent();
  }));
  setSeg();

  strip.addEventListener('click', (e) => {
    const bar = e.target.closest('.day-bar');
    if (!bar || bar.getAttribute('aria-disabled') === 'true') return;
    const k = bar.dataset.key;
    let target;
    if (state.chart === 'day') target = document.getElementById('d-' + k);
    else if (state.chart === 'month') target = document.getElementById('m-' + k);
    else target = document.querySelector(`.month[data-month^="${k}-"]`); // newest month of that year
    if (target) { target.scrollIntoView(); target.querySelector('.day-num')?.focus({ preventScroll: true }); }
  });

  // ---------- incidents ----------
  function incidentHtml(i) {
    const tags = [];
    if (i.src === 'yd' && i.killed) tags.push(`<li class="t-killed">${i.killed === 1 ? 'נהרג אדם' : `נהרגו ${i.killed}`}</li>`);
    for (const t of i.tags) {
      const cls = t === 'הריגה' ? ' class="t-killed"' : t === 'בנוכחות כוחות ביטחון' ? ' class="t-sf"' : '';
      tags.push(`<li${cls}>${esc(t)}</li>`);
    }
    const srcLinks = i.src === 'yd' ? [{ name: 'יש דין', url: YD_PAGE }] : i.links;
    const seen = {};
    const srcs = srcLinks.map((l) => {
      seen[l.name] = (seen[l.name] || 0) + 1;
      const n = seen[l.name] > 1 ? ` (${seen[l.name]})` : '';
      return `<a href="${esc(l.url)}" target="_blank" rel="noopener">${l.video ? '<span class="vid" aria-label="וידאו">▶</span> ' : ''}${esc(l.name)}${n}</a>`;
    }).join(', ');
    const links = (media[i.id] || []).map((m) =>
      `<li><a href="${esc(m.url)}" target="_blank" rel="noopener">${ICONS[m.kind] || ICONS.article}` +
      `<span><span class="sr-kind">${KIND_LABEL[m.kind] || 'כתבה'}: </span><span class="m-title">${esc(m.title)}</span>` +
      (m.source ? ` <span class="m-source">${esc(m.source)}</span>` : '') + '</span></a></li>'
    ).join('');
    return `<li class="inc${isKilling(i) ? ' is-killed' : ''}" id="${esc(i.id)}">` +
      `<p class="inc-place">${esc(i.place || 'מיקום לא ידוע')}<a class="kind" href="#${esc(i.id)}" title="קישור לאירוע (מזהה לגיליון הכתבות)"><span class="sr-kind">מזהה </span>${esc(i.id)}</a></p>` +
      `<p class="inc-text">${esc(i.text)}</p>` +
      (tags.length ? `<ul class="tags">${tags.join('')}</ul>` : '') +
      (links ? `<ul class="media">${links}</ul>` : '') +
      (srcs ? `<p class="srcs">${srcLinks.length > 1 ? 'מקורות' : 'מקור'}: ${srcs}</p>` : '') +
      '</li>';
  }

  function render() {
    shown = incidents.filter(matches);
    renderChart();
    $('#count').textContent = `${shown.length.toLocaleString('he')} אירועים`;

    if (!shown.length) {
      timeline.innerHTML = '<div class="empty"><p>אין אירועים שמתאימים לסינון הזה.</p><button type="button" id="reset">הצגת כל האירועים</button></div>';
      $('#reset').onclick = reset;
      return;
    }
    const byDay = {}, byMonth = {};
    for (const i of shown) {
      (byDay[i.date] ||= []).push(i);
      byMonth[i.date.slice(0, 7)] = (byMonth[i.date.slice(0, 7)] || 0) + 1;
    }
    const maxDay = Math.max(...Object.values(byDay).map((l) => l.length));
    const pct = (n) => ((n / maxDay) * 100).toFixed(1) + '%';
    const html = [];
    let curMonth = null;
    for (const d of Object.keys(byDay).sort().reverse()) {
      const m = d.slice(0, 7);
      if (m !== curMonth) {
        if (curMonth) html.push('</section>');
        curMonth = m;
        const n = byMonth[m];
        html.push(`<section class="month" id="m-${m}" data-month="${m}"><h3 class="month-head">${esc(fmtMonthYear.format(parse(m)))}<span>${n === 1 ? 'אירוע אחד' : `${n.toLocaleString('he')} אירועים`}</span></h3>`);
      }
      const list = byDay[d];
      const k = list.filter(isKilling).length;
      const provisional = meta.provisional_from && d >= meta.provisional_from;
      const meterLabel = `${list.length} אירועים` + (k ? `, ${k} מהם הריגה` : '');
      const dt = parse(d);
      html.push(`<section class="day" id="d-${d}" data-day="${d}" aria-labelledby="h-${d}">` +
        `<div class="day-head"><h4 class="day-num" id="h-${d}" tabindex="-1">${dt.getUTCDate()} <small>${esc(fmtMonth.format(dt))} ${dt.getUTCFullYear()}</small></h4>` +
        `<p class="day-date">${esc(fmtWeekday.format(dt))}</p>` +
        `<div class="meter" role="img" aria-label="${esc(meterLabel)}" title="${esc(meterLabel)}">` +
          `<span class="meter-track"><span class="m-k" style="width:${pct(k)}"></span><span class="m-a" style="width:${pct(list.length - k)}"></span></span>` +
          `<span class="meter-n" aria-hidden="true">${list.length}</span></div>` +
        (provisional ? '<p class="day-provisional">נתונים חלקיים</p>' : '') +
        `</div><ol class="incidents">${list.map(incidentHtml).join('')}</ol></section>`);
    }
    html.push('</section>');
    timeline.innerHTML = html.join('');
    observeDays();
  }

  function reset() {
    Object.assign(state, { group: '', place: '', mediaOnly: false });
    groupSel.value = ''; $('#f-place').value = ''; $('#f-media').checked = false;
    syncUrl(); render();
  }

  // ---------- events ----------
  groupSel.addEventListener('change', () => { state.group = groupSel.value; syncUrl(); render(); });
  let placeTimer;
  $('#f-place').addEventListener('input', (e) => {
    clearTimeout(placeTimer);
    placeTimer = setTimeout(() => { state.place = e.target.value.trim(); syncUrl(); render(); }, 250);
  });
  $('#f-media').addEventListener('change', (e) => { state.mediaOnly = e.target.checked; syncUrl(); render(); });

  const filters = $('.filters');
  new ResizeObserver(() => document.documentElement.style.setProperty('--filters-h', filters.offsetHeight + 'px')).observe(filters);

  // highlight the chart bar of the day being read
  let io, currentDay = null;
  function markCurrent() {
    if (!currentDay) return;
    const k = keyOf[state.chart](currentDay);
    strip.querySelectorAll('[aria-current]').forEach((b) => b.removeAttribute('aria-current'));
    const bar = strip.querySelector(`[data-key="${k}"]`);
    if (bar) { bar.setAttribute('aria-current', 'true'); revealBar(bar); }
  }
  function observeDays() {
    io?.disconnect();
    io = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting)[0];
      if (!visible || visible.target.dataset.day === currentDay) return;
      currentDay = visible.target.dataset.day;
      markCurrent();
    }, { rootMargin: '-40% 0px -55% 0px' });
    document.querySelectorAll('.day').forEach((s) => io.observe(s));
  }

  // back-to-top button, shown once the reader has scrolled down a screen
  const toTop = $('#to-top');
  const updateToTop = () => { toTop.hidden = scrollY < innerHeight; };
  window.addEventListener('scroll', updateToTop, { passive: true });
  toTop.addEventListener('click', () => { scrollTo({ top: 0 }); $('.title').setAttribute('tabindex', '-1'); $('.title').focus({ preventScroll: true }); });
  updateToTop();

  render();
  scrollToNewest();

  // deep link to an incident (#z123, #h12, #o7)
  if (location.hash.length > 1) {
    const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'center' }));
  }
})();
