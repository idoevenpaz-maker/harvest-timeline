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
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d || 1)); };
  const fmtWeekday = new Intl.DateTimeFormat('he', { weekday: 'long', timeZone: 'UTC' });
  const fmtMonthYear = new Intl.DateTimeFormat('he', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const fmtMonth = new Intl.DateTimeFormat('he', { month: 'long', timeZone: 'UTC' });
  const fmtFull = new Intl.DateTimeFormat('he', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  const months = [];
  for (let d = parse(meta.start.slice(0, 7)); d <= parse(meta.latest.slice(0, 7)); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    months.push(d.toISOString().slice(0, 7));
  }
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
  };
  groupSel.value = state.group;
  $('#f-place').value = state.place;
  $('#f-media').checked = state.mediaOnly;

  const syncUrl = () => {
    const p = new URLSearchParams();
    if (state.group) p.set('group', state.group);
    if (state.place) p.set('place', state.place);
    if (state.mediaOnly) p.set('media', '1');
    const q = p.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
  };

  const matches = (i) =>
    (!state.group || i.groups.includes(state.group)) &&
    (!state.place || i.place.includes(state.place)) &&
    (!state.mediaOnly || (media[i.id] && media[i.id].length));

  // ---------- month chart ----------
  const chart = $('#strip');
  const axis = $('#strip-axis');

  function renderChart(byMonth) {
    const max = Math.max(1, ...months.map((m) => (byMonth[m] || []).length));
    chart.innerHTML = months.map((m) => {
      const list = byMonth[m] || [];
      const k = list.filter(isKilling).length;
      const label = `${fmtMonthYear.format(parse(m))}: ${list.length} אירועים` + (k ? `, ${k} מהם הריגה` : '');
      return `<button type="button" class="day-bar${list.length ? '' : ' is-empty'}" role="listitem" data-month="${m}" title="${esc(label)}" aria-label="${esc(label)}"${list.length ? '' : ' disabled'}>` +
        `<span class="b-killed-seg" style="height:${(k / max) * 100}%"></span>` +
        `<span class="b-all" style="height:${((list.length - k) / max) * 100}%"></span>` +
        '</button>';
    }).join('');
    // year ticks at each January (and the first month)
    axis.innerHTML = months.map((m, idx) => m.endsWith('-01')
      ? `<span style="right:${(idx / months.length) * 100}%">${m.slice(0, 4)}</span>` : ''
    ).join('');
    // where the data source changes (Zman -> Yesh Din): Yesh Din documents far more incidents per month
    const sw = months.indexOf(meta.yd_start.slice(0, 7));
    if (sw >= 0) {
      const frac = (Number(meta.yd_start.slice(8, 10)) - 1) / 30;
      axis.insertAdjacentHTML('beforeend', `<span class="src-switch" style="right:${((sw + frac) / months.length) * 100}%">מכאן: יש דין</span>`);
    }
  }

  // ---------- incidents ----------
  function incidentHtml(i) {
    const tags = [];
    if (i.src === 'yd' && i.killed) tags.push(`<li class="t-killed">${i.killed === 1 ? 'נהרג אדם' : `נהרגו ${i.killed}`}</li>`);
    for (const t of i.tags) {
      const cls = t === 'הריגה' ? ' class="t-killed"' : t === 'בנוכחות כוחות ביטחון' ? ' class="t-sf"' : '';
      tags.push(`<li${cls}>${esc(t)}</li>`);
    }
    const srcLinks = i.src === 'yd'
      ? [{ name: 'יש דין', url: YD_PAGE }]
      : i.links;
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
    const shown = incidents.filter(matches);
    const byDay = {}, byMonth = {};
    for (const i of shown) {
      (byDay[i.date] ||= []).push(i);
      (byMonth[i.date.slice(0, 7)] ||= []).push(i);
    }
    renderChart(byMonth);
    $('#count').textContent = `${shown.length.toLocaleString('he')} אירועים`;

    if (!shown.length) {
      timeline.innerHTML = '<div class="empty"><p>אין אירועים שמתאימים לסינון הזה.</p><button type="button" id="reset">הצגת כל האירועים</button></div>';
      $('#reset').onclick = reset;
      return;
    }
    const maxDay = Math.max(...Object.values(byDay).map((l) => l.length));
    const pct = (n) => ((n / maxDay) * 100).toFixed(1) + '%';
    const daysDesc = Object.keys(byDay).sort().reverse();
    const html = [];
    let curMonth = null;
    for (const d of daysDesc) {
      const m = d.slice(0, 7);
      if (m !== curMonth) {
        if (curMonth) html.push('</section>');
        curMonth = m;
        const n = byMonth[m].length;
        html.push(`<section class="month" id="m-${m}" data-month="${m}"><h2 class="month-head">${esc(fmtMonthYear.format(parse(m)))}<span>${n === 1 ? 'אירוע אחד' : `${n.toLocaleString('he')} אירועים`}</span></h2>`);
      }
      const list = byDay[d];
      const k = list.filter(isKilling).length;
      const provisional = meta.provisional_from && d >= meta.provisional_from;
      const meterLabel = `${list.length} אירועים` + (k ? `, ${k} מהם הריגה` : '');
      const dt = parse(d);
      html.push(`<section class="day" id="d-${d}" aria-labelledby="h-${d}">` +
        `<div class="day-head"><h3 class="day-num" id="h-${d}" tabindex="-1">${dt.getUTCDate()} <small>${esc(fmtMonth.format(dt))} ${dt.getUTCFullYear()}</small></h3>` +
        `<p class="day-date">${esc(fmtWeekday.format(dt))}</p>` +
        `<div class="meter" role="img" aria-label="${esc(meterLabel)}" title="${esc(meterLabel)}">` +
          `<span class="meter-track"><span class="m-k" style="width:${pct(k)}"></span><span class="m-a" style="width:${pct(list.length - k)}"></span></span>` +
          `<span class="meter-n" aria-hidden="true">${list.length}</span></div>` +
        (provisional ? '<p class="day-provisional">נתונים חלקיים</p>' : '') +
        `</div><ol class="incidents">${list.map(incidentHtml).join('')}</ol></section>`);
    }
    html.push('</section>');
    timeline.innerHTML = html.join('');
    observeMonths();
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

  chart.addEventListener('click', (e) => {
    const bar = e.target.closest('.day-bar');
    if (!bar || bar.disabled) return;
    const sec = document.getElementById('m-' + bar.dataset.month);
    if (sec) { sec.scrollIntoView(); sec.querySelector('.day-num')?.focus({ preventScroll: true }); }
  });

  const filters = $('.filters');
  new ResizeObserver(() => document.documentElement.style.setProperty('--filters-h', filters.offsetHeight + 'px')).observe(filters);

  // highlight the month being read
  let io;
  function observeMonths() {
    io?.disconnect();
    io = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting)[0];
      if (!visible) return;
      const m = visible.target.dataset.month;
      chart.querySelectorAll('[aria-current]').forEach((b) => b.removeAttribute('aria-current'));
      chart.querySelector(`[data-month="${m}"]`)?.setAttribute('aria-current', 'true');
    }, { rootMargin: '-40% 0px -55% 0px' });
    document.querySelectorAll('.month').forEach((s) => io.observe(s));
  }

  render();

  // deep link to an incident (#z123, #h12, #o7)
  if (location.hash.length > 1) {
    const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'center' }));
  }
})();
