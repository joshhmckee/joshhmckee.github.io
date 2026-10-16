/**
 * Everything the office displays is read from the page's HTML, so the HTML stays
 * the single source of truth (and works on its own without JavaScript).
 */
export function readContent(root = document) {
  const text = (el, sel) => (el.querySelector(sel)?.textContent || '').trim();
  const href = (el, sel) => el.querySelector(sel)?.getAttribute('href') || '#';

  const reports = [...root.querySelectorAll('.report[data-id]')].map((el) => {
    const time = el.querySelector('time');
    const iso = time?.getAttribute('datetime') || '';
    const [y, m, d] = iso.split('-');
    return {
      id: el.dataset.id,
      ticker: el.dataset.ticker || '',
      exchange: el.dataset.exchange || '',
      company: el.dataset.company || text(el, '.report-title'),
      title: text(el, '.report-title'),
      dek: text(el, '.report-dek'),
      url: href(el, '.report-title a'),
      date: iso,
      dateText: (time?.textContent || '').trim(),
      dateShort: y ? `${m}-${d}-${y.slice(2)}` : '',
      image: el.dataset.image || el.querySelector('img')?.getAttribute('src') || '',
      el,
    };
  });

  const resource = (el) => ({
    id: el.dataset.id,
    title: text(el, '.item-title'),
    by: text(el, '.item-by'),
    desc: text(el, '.item-desc'),
    url: href(el, '.item-title a'),
    spine: el.dataset.spine || text(el, '.item-title').toUpperCase(),
    mark: el.dataset.mark || '',
    short: el.dataset.short || '',
    color: el.dataset.color || '',
    category: el.closest('[data-category]')?.dataset.category || '',
    el,
  });

  const library = [...root.querySelectorAll('.library .item[data-id]')].map(resource);
  const podcasts = [...root.querySelectorAll('.podcasts .item[data-id]')].map(resource);
  return { reports, library, podcasts };
}
