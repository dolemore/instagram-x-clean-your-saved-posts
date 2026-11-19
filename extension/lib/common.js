/* Shared pure helpers: constants, file naming, CSV and Markdown output, record bookkeeping.
 *
 * Loaded by the service worker (importScripts), by the X relay content script and by the node
 * tests, so it must not touch chrome.* or the DOM. In the browser it fills the global `SA`
 * namespace; under node it is a CommonJS module. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SA = Object.assign(root.SA || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROOT_DIR = 'instagram-x-saved'; // folder under the browser's Downloads folder
  const SEP = ' | '; // separates file names inside the `files` CSV column
  const CSV_FIELDS = ['date', 'user', 'link', 'files', 'caption'];
  const WORDS_PER_PART = 300000; // NotebookLM accepts up to 500,000 words per source
  const DEFAULT_CLEAN_LIMIT = 150; // posts cleaned per run when "First N" is empty
  const MAX_CONSECUTIVE_ERRORS = 3;

  // [min, max] milliseconds. Requests to the sites keep the 2-5 s spacing. Media files come from
  // the CDNs, not the sites' APIs, so they use the shorter pause the Python scripts use.
  const DELAY = { page: [2000, 5000], clean: [2000, 5000], media: [500, 1500], scroll: [1500, 3000] };

  const PREFIX = { instagram: 'ig', x: 'x' }; // storage key prefix per site
  const MEDIA_HOSTS = {
    instagram: [/(^|\.)cdninstagram\.com$/i, /(^|\.)fbcdn\.net$/i],
    x: [/(^|\.)twimg\.com$/i]
  };
  const KNOWN_EXT = ['jpg', 'png', 'webp', 'gif', 'mp4', 'mov', 'heic'];

  const pad2 = (n) => String(n).padStart(2, '0');

  /** Local calendar date (YYYY-MM-DD) of a Unix time in seconds; '0000-00-00' when missing. */
  function localDate(seconds) {
    if (!seconds) return '0000-00-00';
    const d = new Date(Number(seconds) * 1000);
    if (isNaN(d)) return '0000-00-00';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** Date (YYYY-MM-DD, UTC) of an X `created_at` string; '0000-00-00' when unparsable. */
  function twitterDate(text) {
    const d = new Date(text);
    if (!text || isNaN(d)) return '0000-00-00';
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  /** Keeps a value usable as one part of a file name. */
  function safePart(value, fallback) {
    const s = String(value == null ? '' : value).replace(/[^A-Za-z0-9._-]/g, '_');
    return s || fallback || 'unknown';
  }

  /** File extension taken from the URL path when it is a known media type, else `fallback`. */
  function extFromUrl(url, fallback) {
    try {
      const m = /\.([a-z0-9]{2,4})$/i.exec(new URL(url).pathname);
      if (m) {
        const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
        if (KNOWN_EXT.includes(ext)) return ext;
      }
    } catch (_) { /* not a URL: use the fallback */ }
    return fallback;
  }

  /** date_user_code_NN.ext, relative to the site's folder. */
  function mediaName(post, n, ext) {
    return [safePart(post.date), safePart(post.user), safePart(post.code)].join('_') + '_' + pad2(n) + '.' + ext;
  }

  /** Only https URLs on the site's own media CDNs are downloaded. Captured data comes from the
   * page, so a script running there must not be able to make the extension fetch other hosts. */
  function isAllowedMediaUrl(site, url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && (MEDIA_HOSTS[site] || []).some((re) => re.test(u.hostname));
    } catch (_) {
      return false;
    }
  }

  /** Positive integer, or 0 meaning "no limit". */
  function parseLimit(value) {
    const n = Math.floor(Number(value));
    return isFinite(n) && n > 0 ? n : 0;
  }

  function randomBetween(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  // ---- CSV (RFC 4180, UTF-8 with BOM so Excel detects the encoding) -------------------------

  function csvCell(value) {
    const s = String(value == null ? '' : value).replace(/\r\n|\r|\n/g, ' ');
    return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    const lines = [CSV_FIELDS.join(',')];
    for (const row of rows) lines.push(CSV_FIELDS.map((f) => csvCell(row[f])).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /** CSV row of a record. `files` lists the names Chrome actually saved, uniquified or not. */
  function rowFromRecord(rec) {
    const names = (rec.files || []).filter((f) => f && f.ok).sort((a, b) => a.n - b.n).map((f) => f.name);
    return {
      date: rec.date || '',
      user: rec.user || '',
      link: rec.link || '',
      files: names.join(SEP),
      caption: rec.caption || ''
    };
  }

  /** Rows of an iterable of records, newest first. */
  function sortedRows(records) {
    return Array.from(records)
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(a.code).localeCompare(String(b.code)))
      .map(rowFromRecord);
  }

  // ---- NotebookLM Markdown -------------------------------------------------------------------

  function markdownEntry(row) {
    const lines = ['## @' + (row.user || 'unknown') + ' — ' + (row.date || ''), 'Link: ' + (row.link || '')];
    const files = (row.files || '').split(SEP).filter(Boolean);
    if (files.length) lines.push('Files: ' + files.join(', '));
    const caption = String(row.caption || '').trim();
    lines.push('', caption || '(no caption)', '');
    return lines.join('\n');
  }

  function countWords(text) {
    const words = text.match(/\S+/g);
    return words ? words.length : 0;
  }

  /** Splits rows into Markdown documents of at most `wordsPerPart` words (a single longer entry
   * still gets its own part). Returns [{ count, text }]. */
  function buildMarkdownParts(site, rows, wordsPerPart) {
    const limit = wordsPerPart || WORDS_PER_PART;
    const parts = [];
    let current = [];
    let words = 0;
    for (const row of rows) {
      const text = markdownEntry(row);
      const count = countWords(text);
      if (current.length && words + count > limit) {
        parts.push(current);
        current = [];
        words = 0;
      }
      current.push(text);
      words += count;
    }
    parts.push(current);
    return parts.map((part) => ({
      count: part.length,
      text: '# Saved posts archive: ' + site + '\n\n' + part.join('\n')
    }));
  }

  // ---- Records -------------------------------------------------------------------------------
  // { site, code, user, date, link, caption, need: [n], files: [{ n, name, id, ok }],
  //   cleaned, cleanedAt, updatedAt }
  // `need` lists the media numbers the post consists of; `files` the ones saved so far
  // (`id` is Chrome's download id).

  function recordKey(site, code) {
    return PREFIX[site] + ':' + code;
  }

  function needs(rec) {
    return Array.isArray(rec.need) ? rec.need : [];
  }

  /** True when every media file of the post has been saved. A post without media only counts for
   * X: a text-only bookmark lives in the index itself, while an Instagram post that yielded no
   * media URL is never treated as archived. */
  function isComplete(rec) {
    const need = needs(rec);
    if (!need.length) return rec.site === 'x';
    const saved = new Set((rec.files || []).filter((f) => f && f.ok).map((f) => f.n));
    return need.every((n) => saved.has(n));
  }

  /** Eligible for cleaning: complete, not cleaned yet and, for a text-only post, already written
   * to an index written at or after its last update (`csvAt`). */
  function isReadyToClean(rec, csvAt) {
    if (rec.cleaned || !isComplete(rec)) return false;
    return needs(rec).length > 0 || (!!csvAt && (rec.updatedAt || 0) <= csvAt);
  }

  function summarize(records, csvAt) {
    const s = { posts: 0, downloaded: 0, ready: 0, cleaned: 0, incomplete: 0 };
    for (const rec of records) {
      s.posts++;
      if (rec.cleaned) s.cleaned++;
      if (isComplete(rec)) s.downloaded++;
      else s.incomplete++;
      if (isReadyToClean(rec, csvAt)) s.ready++;
    }
    return s;
  }

  return {
    ROOT_DIR, SEP, CSV_FIELDS, WORDS_PER_PART, DEFAULT_CLEAN_LIMIT, MAX_CONSECUTIVE_ERRORS, DELAY, PREFIX,
    localDate, twitterDate, safePart, extFromUrl, mediaName, isAllowedMediaUrl, parseLimit, randomBetween,
    csvCell, toCsv, rowFromRecord, sortedRows,
    markdownEntry, countWords, buildMarkdownParts,
    recordKey, isComplete, isReadyToClean, summarize
  };
});
