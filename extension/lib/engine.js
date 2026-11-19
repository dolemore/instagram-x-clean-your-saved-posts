/* Job engine of the service worker. Runs one download, clean or export job at a time.
 *
 * Storage contract (chrome.storage.local), shared with the popup:
 *   job        progress and outcome of the current or last job
 *   ig:<code>  one record per Instagram post and x:<id> one per X post (see lib/common.js)
 *   meta       { csvAt: { instagram, x } }, when posts.csv was last written for each site
 * Running a job again resumes it: posts and files that are already on disk are skipped.
 *
 * Safety rules the code below keeps:
 *   - A post is cleaned only if every one of its files is still reported on disk by
 *     chrome.downloads (checked twice, because the first call only starts the existence check).
 *   - Three failures in a row stop the job.
 *   - Cleaning and downloading never run in parallel with each other. */
(function (root) {
  'use strict';

  const SA = root.SA;
  const STOP = { stopped: true }; // thrown to unwind the job when the user presses Stop
  const IDLE_ROUNDS = 6; // scroll rounds without a new bookmark before the X scan ends
  const NAV_TIMEOUT_MS = 30 * 1000;
  const STALL_MS = 90 * 1000; // a download with no progress for this long is cancelled
  const MAX_DOWNLOAD_MS = 30 * 60 * 1000;
  const CLOSED = /No tab with id|tab was closed/i;
  const LOGIN_URL = /\/(accounts\/login|i\/flow\/login|login)(\/|\?|$)/;

  class JobError extends Error {
    constructor(key, ...args) {
      super(key);
      this.key = key; // message key shown by the popup
      this.args = args.map(String);
    }
  }

  const run = { active: false, stop: false, errors: 0, capture: null };
  let job = null;
  let lastPublish = 0;
  let pendingPublish = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const rand = (range) => SA.randomBetween(range);
  const baseName = (path) => String(path || '').split(/[\\/]/).pop();
  const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '') || String(a.code).localeCompare(String(b.code));

  /** Sleeps up to `ms`, returning early once Stop is requested. */
  async function wait(ms) {
    const end = Date.now() + ms;
    while (!run.stop && Date.now() < end) await sleep(Math.min(250, end - Date.now()));
  }

  function checkStop() {
    if (run.stop) throw STOP;
  }

  function fail(key, ...args) {
    throw new JobError(key, ...args);
  }

  function noteSuccess() {
    run.errors = 0;
  }

  function noteError() {
    run.errors++;
    if (run.errors >= SA.MAX_CONSECUTIVE_ERRORS) fail('errThreeInRow');
  }

  // ---- Progress published to the popup -------------------------------------------------------

  function publish(force) {
    if (!job) return Promise.resolve();
    const now = Date.now();
    if (!force && now - lastPublish < 400) {
      if (!pendingPublish) {
        pendingPublish = setTimeout(() => {
          pendingPublish = null;
          publish(true);
        }, 450);
      }
      return Promise.resolve();
    }
    lastPublish = now;
    job.updatedAt = now;
    return chrome.storage.local.set({ job }).catch(() => {});
  }

  function log(key, ...args) {
    job.log.push({ k: key, a: args.map(String) });
    if (job.log.length > 30) job.log.splice(0, job.log.length - 30);
    publish();
  }

  function setPhase(key) {
    job.phase = key;
    publish(true);
  }

  // ---- Records -------------------------------------------------------------------------------

  async function loadRecords(site) {
    const prefix = SA.PREFIX[site] + ':';
    const all = await chrome.storage.local.get(null);
    const records = new Map();
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(prefix) && value && value.code) records.set(value.code, value);
    }
    return records;
  }

  async function loadMeta() {
    const { meta } = await chrome.storage.local.get('meta');
    return Object.assign({ csvAt: {} }, meta);
  }

  async function stampIndex(site, stamp) {
    const meta = await loadMeta();
    meta.csvAt = Object.assign({}, meta.csvAt, { [site]: stamp });
    await chrome.storage.local.set({ meta });
  }

  function saveRecord(rec) {
    return chrome.storage.local.set({ [SA.recordKey(rec.site, rec.code)]: rec });
  }

  // ---- Downloads -----------------------------------------------------------------------------

  /** Whether Chrome still lists the download as complete with its file present. */
  async function fileOnDisk(id) {
    if (id === undefined || id === null) return false;
    try {
      const [item] = await chrome.downloads.search({ id });
      return !!item && item.state === 'complete' && item.exists !== false;
    } catch (_) {
      return false;
    }
  }

  /** Polls one download to its end. Resolves { ok, id, path } or { ok: false, error } or, when
   * Stop was requested (and `ignoreStop` is false), { ok: false, stopped: true }. */
  async function waitForDownload(id, ignoreStop) {
    const started = Date.now();
    let lastBytes = -1;
    let lastProgress = started;
    for (;;) {
      const [item] = await chrome.downloads.search({ id });
      if (!item) return { ok: false, error: 'missing' };
      if (item.state === 'complete') {
        const size = item.fileSize > 0 ? item.fileSize : item.bytesReceived;
        if (item.exists === false || !(size > 0)) return { ok: false, error: 'empty' };
        return { ok: true, id, path: item.filename };
      }
      if (item.state === 'interrupted') return { ok: false, error: item.error || 'interrupted' };
      const now = Date.now();
      if (!ignoreStop && run.stop) {
        await chrome.downloads.cancel(id).catch(() => {});
        return { ok: false, stopped: true };
      }
      if (item.bytesReceived !== lastBytes) {
        lastBytes = item.bytesReceived;
        lastProgress = now;
      }
      if (now - lastProgress > STALL_MS || now - started > MAX_DOWNLOAD_MS) {
        await chrome.downloads.cancel(id).catch(() => {});
        return { ok: false, error: 'stalled' };
      }
      await sleep(700);
    }
  }

  /** `filename` is relative to the Downloads folder. Media uses 'uniquify' so an existing file
   * is never overwritten; only the extension's own index files pass 'overwrite'. */
  async function downloadFile(url, filename, options) {
    const o = Object.assign({ conflict: 'uniquify', ignoreStop: false }, options);
    let id;
    try {
      id = await chrome.downloads.download({ url, filename, conflictAction: o.conflict, saveAs: false });
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
    return waitForDownload(id, o.ignoreStop);
  }

  async function downloadWithRetry(url, filename) {
    let result;
    for (let attempt = 1; attempt <= 3; attempt++) {
      result = await downloadFile(url, filename);
      if (result.ok || result.stopped) return result;
      await wait(3000 * attempt);
      checkStop();
    }
    return result;
  }

  // ---- Offscreen document (Blob URLs for the CSV and Markdown files) -------------------------

  async function offscreenCall(message) {
    let lastError;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await chrome.runtime.sendMessage(Object.assign({ target: 'offscreen' }, message));
      } catch (e) {
        lastError = e;
        await sleep(200); // the document may still be starting
      }
    }
    throw lastError;
  }

  async function ensureOffscreen() {
    const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (open.length) return;
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS'],
        justification: 'Create blob: URLs so the CSV and Markdown files can be downloaded.'
      });
    } catch (e) {
      if (!/single offscreen|already exists/i.test(String((e && e.message) || e))) throw e;
    }
  }

  function closeOffscreen() {
    chrome.offscreen.closeDocument().catch(() => {});
  }

  /** Saves text as a file under Downloads. An existing file is replaced; if Chrome cannot (for
   * example the file is open in a spreadsheet), the text is saved next to it under a new name. */
  async function saveText(text, mime, filename) {
    await ensureOffscreen();
    const created = await offscreenCall({ type: 'blob:create', text, mime });
    if (!created || !created.url) throw new Error('Could not create a blob URL');
    try {
      let result = await downloadFile(created.url, filename, { conflict: 'overwrite', ignoreStop: true });
      if (!result.ok) result = await downloadFile(created.url, filename, { conflict: 'uniquify', ignoreStop: true });
      return result;
    } finally {
      offscreenCall({ type: 'blob:revoke', url: created.url }).catch(() => {});
    }
  }

  // ---- Tabs ----------------------------------------------------------------------------------

  async function getTab(tabId) {
    try {
      return await chrome.tabs.get(tabId);
    } catch (_) {
      throw new JobError('errTabClosed');
    }
  }

  /** Loads `url` in the tab and resolves when that navigation finishes. A `complete` event that
   * arrives before this navigation's own `loading` event belongs to the previous page and is
   * ignored. After 30 s it resolves anyway; callers poll the page's DOM afterwards. */
  async function navigate(tabId, url) {
    const tab = await getTab(tabId);
    await new Promise((resolve, reject) => {
      let sawLoading = false;
      let finished = false;
      const timer = setTimeout(() => finish(), NAV_TIMEOUT_MS);

      function finish(error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onRemoved.removeListener(onRemoved);
        if (error) reject(error);
        else resolve();
      }
      function onUpdated(id, info) {
        if (id !== tabId) return;
        if (info.status === 'loading') sawLoading = true;
        else if (info.status === 'complete' && sawLoading) finish();
      }
      function onRemoved(id) {
        if (id === tabId) finish(new JobError('errTabClosed'));
      }

      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.onRemoved.addListener(onRemoved);
      const started = tab.url === url ? chrome.tabs.reload(tabId) : chrome.tabs.update(tabId, { url });
      started.catch(() => finish(new JobError('errTabClosed')));
    });
  }

  async function assertLoggedIn(tabId) {
    const tab = await getTab(tabId);
    if (LOGIN_URL.test(String(tab.url))) fail('errLogin');
  }

  /** Runs `func` in the tab and returns its result, or null while the page is not ready (for
   * example mid-navigation). Fails the job only when the tab is gone. */
  async function tryExec(tabId, func, args) {
    try {
      const results = await chrome.scripting.executeScript({ target: { tabId }, func, args: args || [] });
      return results && results[0] ? results[0].result : null;
    } catch (e) {
      if (CLOSED.test(String((e && e.message) || e))) fail('errTabClosed');
      return null;
    }
  }

  /** Reads until `accept(value)` or the timeout. Polling happens here, in the service worker,
   * because timers inside a background tab are throttled. */
  async function pollUntil(read, accept, timeoutMs) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      checkStop();
      const value = await read();
      if (accept(value)) return value;
      if (Date.now() >= end) return null;
      await wait(500);
    }
  }

  // ---- Shared download step ------------------------------------------------------------------

  /** Brings one post's record up to date and downloads the media files it is missing. */
  async function processPost(post, records) {
    let rec = records.get(post.code);
    if (!rec) {
      rec = { site: post.site, code: post.code, files: [] };
      records.set(post.code, rec);
    }
    rec.user = post.user;
    rec.date = post.date;
    rec.link = post.link;
    rec.caption = post.caption;
    rec.need = post.media.map((m) => m.n);
    rec.cleaned = false; // it is in the live list, so it is saved (again)

    for (const media of post.media) {
      checkStop();
      const have = rec.files.find((f) => f.n === media.n);
      if (have && have.ok && (await fileOnDisk(have.id))) {
        job.counters.skipped++;
        continue;
      }
      const name = SA.mediaName(post, media.n, media.ext);
      if (!SA.isAllowedMediaUrl(post.site, media.url)) {
        job.counters.failed++;
        log('logFileFailed', name);
        continue;
      }
      const result = await downloadWithRetry(media.url, SA.ROOT_DIR + '/' + post.site + '/' + name);
      if (result.stopped) throw STOP;
      if (result.ok) {
        rec.files = rec.files
          .filter((f) => f.n !== media.n)
          .concat({ n: media.n, name: baseName(result.path), id: result.id, ok: true });
        job.counters.files++;
        noteSuccess();
        log('logSaved', name);
      } else {
        job.counters.failed++;
        log('logFileFailed', name);
        rec.updatedAt = Date.now();
        await saveRecord(rec);
        noteError();
      }
      await wait(rand(SA.DELAY.media));
    }

    rec.updatedAt = Date.now();
    await saveRecord(rec);
    job.counters.processed++;
    publish();
  }

  /** Rewrites posts.csv from every record the extension holds for the site. Never throws: a
   * failed index must not hide how the job ended, so it is only logged. */
  async function writeIndex(site, records) {
    if (!records.size) return;
    try {
      setPhase('phaseIndex');
      const stamp = Date.now();
      const text = SA.toCsv(SA.sortedRows(records.values()));
      const result = await saveText(text, 'text/csv;charset=utf-8', SA.ROOT_DIR + '/' + site + '/posts.csv');
      if (result.ok) {
        await stampIndex(site, stamp);
        log('logCsv', baseName(result.path));
      } else {
        log('logFileFailed', 'posts.csv');
      }
    } catch (_) {
      log('logFileFailed', 'posts.csv');
    }
  }

  // ---- Instagram -----------------------------------------------------------------------------

  async function fetchSavedPage(tabId, maxId) {
    const raw = await tryExec(tabId, SA.pageFetchSaved, [maxId]);
    if (!raw) return { kind: 'http', status: 0 };
    return SA.parseSavedPage(raw.status, raw.text);
  }

  async function igDownload(opts) {
    const records = await loadRecords('instagram');
    let maxId = null;
    let page = 0;
    let seen = 0;
    let failures = 0;
    setPhase('phaseScan');
    try {
      scan: for (;;) {
        checkStop();
        const res = await fetchSavedPage(opts.tabId, maxId);
        if (res.kind === 'login') fail('errLogin');
        if (res.kind === 'rate') fail('errRateLimit');
        if (res.kind !== 'ok') {
          failures++;
          if (failures >= SA.MAX_CONSECUTIVE_ERRORS) fail('errListRead', res.status);
          await wait(rand(SA.DELAY.page));
          continue;
        }
        failures = 0;
        page++;
        log('logPage', page, res.posts.length);
        if (page === 1) setPhase('phaseDownload');
        for (const post of res.posts) {
          if (opts.limit && seen >= opts.limit) break scan;
          seen++;
          await processPost(post, records);
        }
        if (!res.moreAvailable || !res.nextMaxId) break;
        maxId = res.nextMaxId;
        await wait(rand(SA.DELAY.page));
      }
    } finally {
      await writeIndex('instagram', records);
    }
  }

  async function igClean(opts) {
    const records = await loadRecords('instagram');
    const list = await selectCleanable(records, 'instagram', opts.limit);
    setPhase('phaseClean');
    for (const rec of list) {
      checkStop();
      await navigate(opts.tabId, 'https://www.instagram.com/p/' + encodeURIComponent(rec.code) + '/');
      await assertLoggedIn(opts.tabId);
      // A Reel can take a long time to draw its save icon.
      let state = await pollUntil(() => tryExec(opts.tabId, SA.pageSaveState),
        (v) => v === 'saved' || v === 'unsaved', 20000);
      let outcome = null;
      if (state === 'saved') {
        await tryExec(opts.tabId, SA.pageClickUnsave);
        await wait(1500);
        state = await pollUntil(() => tryExec(opts.tabId, SA.pageSaveState), (v) => v === 'unsaved', 8000);
        if (state === 'unsaved') outcome = 'cleaned';
      } else if (state === 'unsaved') {
        outcome = 'wasNot';
      }
      await finishClean(rec, outcome);
      await wait(rand(SA.DELAY.clean));
    }
  }

  // ---- X -------------------------------------------------------------------------------------

  async function xDownload(opts) {
    const records = await loadRecords('x');
    const collected = new Map();
    run.capture = { tabId: opts.tabId, collected, operations: new Set() };
    setPhase('phaseScan');

    // A fresh navigation guarantees the page hook is installed before X requests the first page.
    await navigate(opts.tabId, opts.url);
    await assertLoggedIn(opts.tabId);

    let idle = 0;
    while (idle < IDLE_ROUNDS && !(opts.limit && collected.size >= opts.limit)) {
      checkStop();
      const before = collected.size;
      await tryExec(opts.tabId, SA.pageXScroll);
      await wait(rand(SA.DELAY.scroll));
      if (collected.size === before) {
        idle++;
      } else {
        idle = 0;
        log('logScan', collected.size);
      }
    }

    const operations = Array.from(run.capture.operations);
    run.capture = null;
    if (!collected.size) {
      await assertLoggedIn(opts.tabId);
      log('logOps', operations.join(', ') || '-');
      fail('errNoBookmarks');
    }

    let posts = Array.from(collected.values());
    if (opts.limit) posts = posts.slice(0, opts.limit);
    job.counters.total = posts.length;
    setPhase('phaseDownload');
    try {
      for (const post of posts) {
        checkStop();
        await processPost(post, records);
      }
    } finally {
      await writeIndex('x', records);
    }
  }

  async function xClean(opts) {
    const records = await loadRecords('x');
    const list = await selectCleanable(records, 'x', opts.limit);
    setPhase('phaseClean');
    for (const rec of list) {
      checkStop();
      await navigate(opts.tabId, 'https://x.com/i/status/' + rec.code);
      await assertLoggedIn(opts.tabId);
      let state = await pollUntil(() => tryExec(opts.tabId, SA.pageXProbe, [rec.code]),
        (v) => v === 'bookmarked' || v === 'plain', 20000);
      let outcome = null;
      if (state === 'bookmarked') {
        await tryExec(opts.tabId, SA.pageXClick, [rec.code]);
        state = await pollUntil(() => tryExec(opts.tabId, SA.pageXProbe, [rec.code]), (v) => v === 'plain', 8000);
        if (state === 'plain') outcome = 'cleaned';
      } else if (state === 'plain') {
        outcome = 'wasNot';
      }
      await finishClean(rec, outcome);
      await wait(rand(SA.DELAY.clean));
    }
  }

  // ---- Cleaning (shared) ---------------------------------------------------------------------

  /** Posts that may be cleaned now: complete, not cleaned, and every file still on disk. Files
   * are looked up twice with a pause in between, because chrome.downloads.search only starts the
   * existence check and reports a deleted file on the following call. */
  async function selectCleanable(records, site, limit) {
    setPhase('phaseVerify');
    const meta = await loadMeta();
    const candidates = Array.from(records.values())
      .filter((rec) => SA.isReadyToClean(rec, meta.csvAt[site]))
      .sort(byDateDesc);

    for (const rec of candidates) {
      checkStop();
      for (const f of rec.files) await fileOnDisk(f.id);
    }
    await sleep(1200);

    const verified = [];
    for (const rec of candidates) {
      checkStop();
      let allOnDisk = true;
      for (const n of rec.need) {
        const f = rec.files.find((x) => x.n === n && x.ok);
        if (!f || !(await fileOnDisk(f.id))) {
          allOnDisk = false;
          break;
        }
      }
      if (allOnDisk) verified.push(rec);
    }

    if (candidates.length > verified.length) log('logUnverified', candidates.length - verified.length);
    if (!verified.length) fail('errNothingToClean');
    job.eligible = verified.length;
    const list = verified.slice(0, limit || SA.DEFAULT_CLEAN_LIMIT);
    job.counters.total = list.length;
    return list;
  }

  /** Records the outcome of one clean attempt: 'cleaned', 'wasNot' (the site no longer had it
   * saved) or null (could not be confirmed). */
  async function finishClean(rec, outcome) {
    job.counters.processed++;
    if (outcome) {
      noteSuccess();
      rec.cleaned = true;
      rec.cleanedAt = Date.now();
      await saveRecord(rec);
      job.counters.cleaned++;
      log(outcome === 'cleaned' ? 'logCleaned' : 'logWasNot', rec.code);
    } else {
      job.counters.failed++;
      log('logCleanFailed', rec.code);
      noteError();
    }
  }

  // ---- NotebookLM export ---------------------------------------------------------------------

  async function exportMarkdown() {
    setPhase('phaseExport');
    let files = 0;
    let posts = 0;
    for (const site of ['instagram', 'x']) {
      const records = await loadRecords(site);
      if (!records.size) continue;
      const rows = SA.sortedRows(records.values());
      const parts = SA.buildMarkdownParts(site, rows);
      for (let i = 0; i < parts.length; i++) {
        const name = site + '_saved_posts' + (parts.length > 1 ? '_part' + (i + 1) : '') + '.md';
        const result = await saveText(parts[i].text, 'text/markdown;charset=utf-8',
          SA.ROOT_DIR + '/notebooklm/' + name);
        if (!result.ok) fail('errUnexpected', 'could not write ' + name);
        files++;
        log('logExportFile', baseName(result.path), parts[i].count);
      }
      posts += rows.length;
    }
    if (!files) fail('errNothingToExport');
    job.summary = { k: 'sumExport', a: [String(files), String(posts)] };
  }

  // ---- Lifecycle -----------------------------------------------------------------------------

  const keepAlive = {
    timer: null,
    // Any extension API call resets the service worker's idle timer; a long job needs one
    // even in the quiet moments between requests.
    start() {
      this.stop();
      this.timer = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
    },
    stop() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    }
  };

  function describeError(e) {
    if (e instanceof JobError) return { k: e.key, a: e.args };
    const message = String((e && e.message) || e);
    if (/quota/i.test(message)) return { k: 'errStorage', a: [] };
    return { k: 'errUnexpected', a: [message.slice(0, 200)] };
  }

  async function execute(opts) {
    keepAlive.start();
    try {
      if (opts.kind === 'download') await (opts.site === 'instagram' ? igDownload(opts) : xDownload(opts));
      else if (opts.kind === 'clean') await (opts.site === 'instagram' ? igClean(opts) : xClean(opts));
      else await exportMarkdown();
      job.status = 'done';
    } catch (e) {
      if (e === STOP) {
        job.status = 'stopped';
      } else {
        job.status = 'error';
        job.error = describeError(e);
      }
    } finally {
      run.capture = null;
      const c = job.counters;
      if (opts.kind === 'download') {
        job.summary = { k: 'sumDownload', a: [c.processed, c.files, c.failed].map(String) };
      } else if (opts.kind === 'clean') {
        job.summary = { k: 'sumClean', a: [c.cleaned, c.failed, Math.max(0, job.eligible - c.cleaned)].map(String) };
      }
      job.phase = null;
      job.finishedAt = Date.now();
      keepAlive.stop();
      closeOffscreen();
      await publish(true);
      run.active = false;
      run.stop = false;
    }
  }

  function siteMatches(site, url) {
    try {
      const host = new URL(url).hostname;
      return site === 'instagram' ? /(^|\.)instagram\.com$/.test(host) : host === 'x.com';
    } catch (_) {
      return false;
    }
  }

  /** The bookmarks page to scan; only https://x.com/ addresses are accepted. */
  function normalizeXUrl(raw) {
    try {
      const url = new URL(String(raw || 'https://x.com/i/bookmarks').trim());
      return url.protocol === 'https:' && url.hostname === 'x.com' ? url.toString() : null;
    } catch (_) {
      return null;
    }
  }

  const refuse = (error, ...args) => ({ ok: false, error, args: args.map(String) });

  /** Starts a job and returns { ok: true } at once, or { ok: false, error, args } when it cannot
   * start. Request: { kind: 'download' | 'clean' | 'export', site, tabId, limit, url,
   * confirmed }. `confirmed` must be true for 'clean': the popup sets it from its checkbox. */
  async function start(req) {
    if (run.active) return refuse('errBusy');
    const kind = req && req.kind;
    if (!['download', 'clean', 'export'].includes(kind)) return refuse('errUnexpected', 'unknown job');

    let site = null;
    let url = null;
    if (kind !== 'export') {
      site = req.site;
      if (!SA.PREFIX[site]) return refuse('errUnexpected', 'unknown site');
      let tab;
      try {
        tab = await chrome.tabs.get(req.tabId);
      } catch (_) {
        return refuse('errTabClosed');
      }
      if (!siteMatches(site, tab.url)) return refuse('errWrongSite');
      if (kind === 'clean' && req.confirmed !== true) return refuse('errUnexpected', 'confirmation missing');
      if (kind === 'download' && site === 'x') {
        url = normalizeXUrl(req.url);
        if (!url) return refuse('errBadUrl');
      }
    }

    run.active = true;
    run.stop = false;
    run.errors = 0;
    run.capture = null;
    job = {
      id: Date.now(),
      kind,
      site,
      status: 'running',
      phase: null,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      finishedAt: null,
      counters: { processed: 0, files: 0, skipped: 0, failed: 0, cleaned: 0, total: 0 },
      eligible: 0,
      log: [],
      error: null,
      summary: null
    };
    await publish(true);
    execute({ kind, site, url, tabId: req.tabId, limit: SA.parseLimit(req.limit) }).catch(() => {});
    return { ok: true };
  }

  function stop() {
    if (!run.active) return;
    run.stop = true;
    log('logStopRequested');
    publish(true);
  }

  /** Forgets every post record and the job; downloaded files are not touched. */
  async function reset() {
    if (run.active) return refuse('errBusy');
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => /^(ig|x):/.test(k) || k === 'meta' || k === 'job');
    await chrome.storage.local.remove(keys);
    return { ok: true };
  }

  /** Posts the page hook captured. Accepted only from the tab a download job is scanning. */
  function onCaptured(message, sender) {
    const capture = run.capture;
    if (!capture || !sender || !sender.tab || sender.tab.id !== capture.tabId) return;
    if (message.operation) capture.operations.add(String(message.operation));
    for (const post of Array.isArray(message.tweets) ? message.tweets : []) {
      if (!post || !/^\d+$/.test(String(post.code)) || !Array.isArray(post.media)) continue;
      if (!capture.collected.has(post.code)) capture.collected.set(post.code, post);
    }
  }

  /** A job still marked running when the service worker starts was killed with the old worker. */
  async function recoverStaleJob() {
    const { job: stored } = await chrome.storage.local.get('job');
    if (run.active || !stored || stored.status !== 'running') return;
    stored.status = 'interrupted';
    stored.updatedAt = Date.now();
    await chrome.storage.local.set({ job: stored });
  }

  root.SA.engine = { start, stop, reset, onCaptured, recoverStaleJob };
})(self);
