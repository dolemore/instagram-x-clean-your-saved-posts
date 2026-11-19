/* Instagram: parsing of the saved-posts feed, plus the functions injected into the page.
 *
 * The three `page*` functions are serialized by chrome.scripting.executeScript and run in the
 * page, so each must stay self-contained: no references to anything outside its own body. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./common.js'));
  else root.SA = Object.assign(root.SA || {}, factory(root.SA || {}));
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  const SITE = 'https://www.instagram.com/';

  /** Best media of one post or carousel slide: first video version, else the largest image. */
  function pickMedia(part) {
    if (!part) return null;
    const video = Array.isArray(part.video_versions) && part.video_versions[0];
    if (video && video.url) return { url: video.url, ext: 'mp4' };
    const candidates = part.image_versions2 && part.image_versions2.candidates;
    if (Array.isArray(candidates) && candidates.length) {
      let best = candidates[0];
      for (const c of candidates) {
        if ((c.width || 0) * (c.height || 0) > (best.width || 0) * (best.height || 0)) best = c;
      }
      if (best.url) return { url: best.url, ext: C.extFromUrl(best.url, 'jpg') };
    }
    return null;
  }

  /** One feed item to { site, code, user, date, link, caption, media: [{ n, url, ext }] }.
   * `n` is the slide's position, so file names stay stable when a slide has no media. */
  function parseSavedItem(item) {
    const media = item && (item.media || item);
    if (!media) return null;
    const code = String(media.code || media.pk || '');
    if (!code) return null;
    const parts = Array.isArray(media.carousel_media) && media.carousel_media.length ? media.carousel_media : [media];
    const files = [];
    parts.forEach((part, i) => {
      const m = pickMedia(part);
      if (m) files.push({ n: i + 1, url: m.url, ext: m.ext });
    });
    return {
      site: 'instagram',
      code,
      user: (media.user && media.user.username) || 'unknown',
      date: C.localDate(media.taken_at),
      link: SITE + 'p/' + code + '/',
      caption: String((media.caption && media.caption.text) || '').replace(/\r\n|\r|\n/g, ' '),
      media: files
    };
  }

  /** Result of one feed request: { kind: 'ok', posts, moreAvailable, nextMaxId } or
   * { kind: 'login' | 'rate' } or { kind: 'http', status }. */
  function parseSavedPage(status, text) {
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) { /* an HTML page (login wall, challenge) is handled below */ }
    if (status === 401 || (data && (data.message === 'login_required' || data.require_login))) return { kind: 'login' };
    if (status === 429) return { kind: 'rate' };
    if (status !== 200 || !data) return { kind: 'http', status };
    const posts = [];
    for (const item of data.items || []) {
      const post = parseSavedItem(item);
      if (post) posts.push(post);
    }
    return { kind: 'ok', posts, moreAvailable: !!data.more_available, nextMaxId: data.next_max_id || null };
  }

  // ---- Injected into the page ----------------------------------------------------------------

  /** Fetches one page of the saved feed with the page's own session. */
  async function pageFetchSaved(maxId) {
    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
    const url = '/api/v1/feed/saved/posts/' + (maxId ? '?max_id=' + encodeURIComponent(maxId) : '');
    try {
      const r = await fetch(url, {
        credentials: 'include',
        headers: { 'X-IG-App-ID': '936619743392459', 'X-CSRFToken': csrf, 'X-Requested-With': 'XMLHttpRequest' }
      });
      return { status: r.status, text: await r.text() };
    } catch (_) {
      return { status: 0, text: '' };
    }
  }

  /** 'saved', 'unsaved', or null while the page has not drawn the save icon yet. The icon's
   * accessible name tells its state; English and Turkish interfaces are recognized. */
  function pageSaveState() {
    const isSaved = (n) => /kaldır|remove|kaydedildi|saved/.test(n) && !/kaydedilenler$/.test(n);
    const name = (s) => (s.getAttribute('aria-label') || '').trim().toLowerCase();
    const icons = Array.from(document.querySelectorAll('svg[aria-label]'));
    if (icons.some((s) => isSaved(name(s)))) return 'saved';
    if (icons.some((s) => /^(save|kaydet)$/.test(name(s)))) return 'unsaved';
    return null;
  }

  /** Clicks the button around the "saved" icon; false when no such icon is on the page. */
  function pageClickUnsave() {
    const isSaved = (n) => /kaldır|remove|kaydedildi|saved/.test(n) && !/kaydedilenler$/.test(n);
    const name = (s) => (s.getAttribute('aria-label') || '').trim().toLowerCase();
    const icon = Array.from(document.querySelectorAll('svg[aria-label]')).find((s) => isSaved(name(s)));
    if (!icon) return false;
    (icon.closest('[role="button"], button') || icon.parentElement).click();
    return true;
  }

  return { pickMedia, parseSavedItem, parseSavedPage, pageFetchSaved, pageSaveState, pageClickUnsave };
});
