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

  const { meta, labels, places, incidents } = data;
  const ICONS = {
    video: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M13.5 10 8 13.2V6.8z" fill="currentColor"/></svg>',
    article: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="2" width="14" height="16" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 6.5h8M6 9.5h8M6 12.5h5" stroke="currentColor" stroke-width="1.6"/></svg>',
  };
  const KIND_LABEL = { video: 'סרטון', article: 'כתבה' };

  // ---------- dates ----------
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const iso = (dt) => dt.toISOString().slice(0, 10);
  const fmtWeekday = new Intl.DateTimeFormat('he', { weekday: 'long', timeZone: 'UTC' });
  const fmtShort = new Intl.DateTimeFormat('he', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const fmtMonth = new Intl.DateTimeFormat('he', { month: 'long', timeZone: 'UTC' });

  const days = [];
  for (let d = parse(meta.campaign_start); iso(d) <= meta.latest_date; d = new Date(d.getTime() + 864e5)) days.push(iso(d));

  $('#updated').textContent = fmtShort.format(parse(meta.data_updated));
  $('#lede').textContent =
    `${incidents.length.toLocaleString('he')} אירועי אלימות של מתנחלים נגד פלסטינים בגדה המערבית מאז ${fmtShort.format(parse(meta.campaign_start))}, יום אחר יום.`;

  // ---------- filter controls ----------
  const offenceSel = $('#f-offence');
  for (const [k, v] of Object.entries(labels.offence)) offenceSel.insertAdjacentHTML('beforeend', `<option value="${esc(k)}">${esc(v)}</option>`);
  const placeNames = [...new Set(incidents.map((i) => places[i.place]?.name || i.place))].sort((a, b) => a.localeCompare(b, 'he'));
  $('#places-list').innerHTML = placeNames.map((p) => `<option value="${esc(p)}">`).join('');

  const params = new URLSearchParams(location.search);
  const state = {
    tab: ['harvest', 'other'].includes(params.get('tab')) ? params.get('tab') : 'all',
    offence: labels.offence[params.get('offence')] ? params.get('offence') : '',
    place: params.get('place') || '',
    mediaOnly: params.get('media') === '1',
  };
  offenceSel.value = state.offence;
  $('#f-place').value = state.place;
  $('#f-media').checked = state.mediaOnly;

  const syncUrl = () => {
    const p = new URLSearchParams();
    if (state.tab !== 'all') p.set('tab', state.tab);
    if (state.offence) p.set('offence', state.offence);
    if (state.place) p.set('place', state.place);
    if (state.mediaOnly) p.set('media', '1');
    const q = p.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
  };

  const matches = (i) =>
    (state.tab === 'all' || i.tab === state.tab) &&
    (!state.offence || i.offences.includes(state.offence)) &&
    (!state.place || (places[i.place]?.name || i.place).includes(state.place)) &&
    (!state.mediaOnly || (media[i.id] && media[i.id].length));

  // ---------- rendering ----------
  const strip = $('#strip');
  const axis = $('#strip-axis');

  function renderStrip(byDay) {
    const max = Math.max(1, ...days.map((d) => (byDay[d] || []).length));
    strip.innerHTML = days.map((d) => {
      const list = byDay[d] || [];
      const h = list.filter((i) => i.tab === 'harvest').length;
      const o = list.length - h;
      const killed = list.some((i) => i.killed);
      const label = `${fmtShort.format(parse(d))}: ${list.length} אירועים`;
      return `<button type="button" class="day-bar${list.length ? '' : ' is-empty'}" role="listitem" data-day="${d}" title="${esc(label)}" aria-label="${esc(label)}"${list.length ? '' : ' disabled'}>` +
        `<span class="b-harvest" style="height:${(h / max) * 100}%"></span>` +
        `<span class="b-other" style="height:${(o / max) * 100}%"></span>` +
        (killed ? '<span class="b-killed"></span>' : '') +
        '</button>';
    }).join('');
    // month ticks
    const ticks = [];
    days.forEach((d, idx) => { if (d.endsWith('-01')) ticks.push([idx, '1 ב' + fmtMonth.format(parse(d))]); });
    axis.innerHTML = ticks.map(([idx, t]) => `<span style="right:${(idx / days.length) * 100}%;transform:none">${esc(t)}</span>`).join('');
  }

  function incidentHtml(i) {
    const place = places[i.place]?.name || i.place;
    const tags = [];
    if (i.killed) tags.push(`<li class="t-killed">${i.killed === 1 ? 'נהרג אדם' : `נהרגו ${i.killed}`}</li>`);
    for (const o of i.offences) tags.push(`<li>${esc(labels.offence[o] || o)}</li>`);
    for (const t of i.traits) tags.push(`<li>${esc(labels.trait[t] || t)}</li>`);
    if (i.sf) tags.push('<li class="t-sf">בנוכחות כוחות ביטחון</li>');
    const links = (media[i.id] || []).map((m) =>
      `<li><a href="${esc(m.url)}" target="_blank" rel="noopener">${ICONS[m.kind] || ICONS.article}` +
      `<span><span class="sr-kind">${KIND_LABEL[m.kind] || 'כתבה'}: </span><span class="m-title">${esc(m.title)}</span>` +
      (m.source ? ` <span class="m-source">${esc(m.source)}</span>` : '') + '</span></a></li>'
    ).join('');
    const cls = ['inc', i.tab === 'other' ? 'is-other' : '', i.killed ? 'is-killed' : ''].filter(Boolean).join(' ');
    return `<li class="${cls}" id="${esc(i.id)}">` +
      `<p class="inc-place">${esc(place)}<a class="kind" href="#${esc(i.id)}" title="קישור לאירוע (מזהה לגיליון הכתבות)"><span class="sr-kind">${i.tab === 'harvest' ? 'אירוע מסיק' : 'אירוע אחר'}, מזהה </span>${esc(i.id)}</a></p>` +
      `<p class="inc-text">${esc(i.text)}</p>` +
      (tags.length ? `<ul class="tags">${tags.join('')}</ul>` : '') +
      (links ? `<ul class="media">${links}</ul>` : '') +
      '</li>';
  }

  function render() {
    const shown = incidents.filter(matches);
    const byDay = {};
    for (const i of shown) (byDay[i.date] ||= []).push(i);
    renderStrip(byDay);

    const nMedia = shown.filter((i) => media[i.id]?.length).length;
    $('#count').textContent = `${shown.length.toLocaleString('he')} אירועים` + (nMedia ? `, ${nMedia} מהם עם כתבות או סרטונים` : '');

    if (!shown.length) {
      timeline.innerHTML = '<div class="empty"><p>אין אירועים שמתאימים לסינון הזה.</p><button type="button" id="reset">הצגת כל האירועים</button></div>';
      $('#reset').onclick = reset;
      return;
    }
    const maxDay = Math.max(...Object.values(byDay).map((l) => l.length));
    timeline.innerHTML = days.filter((d) => byDay[d]).map((d) => {
      const list = byDay[d];
      const provisional = meta.provisional_from && d >= meta.provisional_from;
      const nH = list.filter((i) => i.tab === 'harvest').length;
      const nO = list.length - nH;
      const pct = (n) => ((n / maxDay) * 100).toFixed(1) + '%';
      const meterLabel = `${list.length} אירועים` + (nH && nO ? `: ${nH} מסיק, ${nO} אחרים` : '');
      return `<section class="day" id="d-${d}" data-day="${d}" aria-labelledby="h-${d}">` +
        `<div class="day-head"><h2 class="day-num" id="h-${d}" tabindex="-1">${parse(d).getUTCDate()} <small>${esc(fmtMonth.format(parse(d)))}</small></h2>` +
        `<p class="day-date">${esc(fmtWeekday.format(parse(d)))}</p>` +
        `<div class="meter" role="img" aria-label="${esc(meterLabel)}" title="${esc(meterLabel)}">` +
          `<span class="meter-track"><span class="m-h" style="width:${pct(nH)}"></span><span class="m-o" style="width:${pct(nO)}"></span></span>` +
          `<span class="meter-n" aria-hidden="true">${list.length}</span></div>` +
        (provisional ? '<p class="day-provisional">נתונים חלקיים</p>' : '') +
        `</div><ol class="incidents">${list.map(incidentHtml).join('')}</ol></section>`;
    }).join('');
    observeDays();
  }

  function reset() {
    Object.assign(state, { tab: 'all', offence: '', place: '', mediaOnly: false });
    offenceSel.value = ''; $('#f-place').value = ''; $('#f-media').checked = false;
    setSeg(); syncUrl(); render();
  }

  // ---------- events ----------
  const segButtons = [...document.querySelectorAll('.seg button')];
  const setSeg = () => segButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tab === state.tab)));
  segButtons.forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; setSeg(); syncUrl(); render(); }));
  setSeg();
  offenceSel.addEventListener('change', () => { state.offence = offenceSel.value; syncUrl(); render(); });
  let placeTimer;
  $('#f-place').addEventListener('input', (e) => {
    clearTimeout(placeTimer);
    placeTimer = setTimeout(() => { state.place = e.target.value.trim(); syncUrl(); render(); }, 200);
  });
  $('#f-media').addEventListener('change', (e) => { state.mediaOnly = e.target.checked; syncUrl(); render(); });

  strip.addEventListener('click', (e) => {
    const bar = e.target.closest('.day-bar');
    if (!bar || bar.disabled) return;
    const sec = document.getElementById('d-' + bar.dataset.day);
    if (sec) { sec.scrollIntoView(); sec.querySelector('.day-num').focus({ preventScroll: true }); }
  });

  // sticky offset = filter bar height
  const filters = $('.filters');
  new ResizeObserver(() => document.documentElement.style.setProperty('--filters-h', filters.offsetHeight + 'px')).observe(filters);

  // highlight the strip bar of the day being read
  let io;
  function observeDays() {
    io?.disconnect();
    io = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;
      const d = visible.target.dataset.day;
      strip.querySelectorAll('[aria-current]').forEach((b) => b.removeAttribute('aria-current'));
      strip.querySelector(`[data-day="${d}"]`)?.setAttribute('aria-current', 'true');
    }, { rootMargin: '-30% 0px -60% 0px' });
    document.querySelectorAll('.day').forEach((s) => io.observe(s));
  }

  render();

  // deep link to an incident (#h123)
  if (location.hash.length > 1) {
    const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'center' }));
  }
})();
