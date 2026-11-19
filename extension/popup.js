/* Popup: shows the state the service worker keeps in chrome.storage.local and sends it start,
 * stop and reset requests (see background.js). It runs no job logic of its own, so closing it
 * never interrupts a job. lib/common.js is loaded first for the same record summary the worker
 * uses. All text comes from _locales through chrome.i18n and is written with textContent. */
(() => {
  'use strict';

  const SA = self.SA;
  const t = (key, args) => chrome.i18n.getMessage(key, (args || []).map(String)) || key;
  const $ = (id) => document.getElementById(id);

  const SITE_NAME = { instagram: 'siteInstagram', x: 'siteX' };
  const STATUS = {
    running: 'statusRunning',
    done: 'statusDone',
    stopped: 'statusStopped',
    error: 'statusError',
    interrupted: 'statusInterrupted'
  };
  const KIND = { download: 'kindDownload', clean: 'kindClean', export: 'kindExport' };
  const COUNTERS = {
    download: [['ctrProcessed', 'processed'], ['ctrFiles', 'files'], ['ctrSkipped', 'skipped'], ['ctrFailed', 'failed']],
    clean: [['ctrProcessed', 'processed'], ['ctrCleaned', 'cleaned'], ['ctrFailed', 'failed']],
    export: []
  };
  const DEFAULT_X_URL = 'https://x.com/i/bookmarks';
  const LOG_LINES = 8;
  const STATS_REFRESH_MS = 2000;

  const state = {
    tabId: null,
    site: null,
    job: null,
    all: {}, // every key of chrome.storage.local
    settings: { limit: '', xUrl: DEFAULT_X_URL }
  };

  function detectSite(url) {
    try {
      const host = new URL(url).hostname;
      if (/(^|\.)instagram\.com$/.test(host)) return 'instagram';
      if (host === 'x.com') return 'x';
    } catch (_) { /* no usable URL: unsupported tab */ }
    return null;
  }

  function localize() {
    document.documentElement.lang = chrome.i18n.getUILanguage();
    document.title = t('extName');
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    }
    $('hintLimit').textContent = t('hintLimit', [SA.DEFAULT_CLEAN_LIMIT]);
  }

  // ---- State ---------------------------------------------------------------------------------

  async function loadAll() {
    state.all = await chrome.storage.local.get(null);
    state.job = state.all.job || null;
    Object.assign(state.settings, state.all.settings);
  }

  function siteRecords(site) {
    const prefix = SA.PREFIX[site] + ':';
    return Object.keys(state.all).filter((k) => k.startsWith(prefix)).map((k) => state.all[k]);
  }

  function siteStats() {
    if (!state.site) return null;
    const csvAt = (state.all.meta && state.all.meta.csvAt) || {};
    return SA.summarize(siteRecords(state.site), csvAt[state.site]);
  }

  const isRunning = () => !!state.job && state.job.status === 'running';

  // ---- Rendering -----------------------------------------------------------------------------

  function renderSite() {
    $('tabInfo').textContent = state.site
      ? t('siteDetected', [t(SITE_NAME[state.site])])
      : t('siteUnsupported');
    $('xUrlRow').hidden = state.site !== 'x';
    $('hintXUrl').hidden = state.site !== 'x';
  }

  function renderActions() {
    const running = isRunning();
    const stats = siteStats();
    const known = siteRecords('instagram').length + siteRecords('x').length;
    $('btnDownload').disabled = running || !state.site;
    $('btnClean').disabled = running || !state.site || !$('chkBackup').checked || !stats || stats.ready === 0;
    $('btnClean').textContent = t('btnClean') + (stats ? ' (' + stats.ready + ')' : '');
    $('btnExport').disabled = running || known === 0;
    $('btnReset').disabled = running;
    $('limit').disabled = running;
    $('xUrl').disabled = running;
  }

  function renderStats() {
    const stats = siteStats();
    $('cardStats').hidden = !stats;
    if (!stats) return;
    $('titleStats').textContent = t('statsFor', [t(SITE_NAME[state.site])]);
    $('stPosts').textContent = stats.posts;
    $('stDownloaded').textContent = stats.downloaded;
    $('stReady').textContent = stats.ready;
    $('stCleaned').textContent = stats.cleaned;
    $('stIncomplete').textContent = stats.incomplete;
  }

  function listItems(list, texts) {
    list.replaceChildren(...texts.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }));
  }

  function renderJob() {
    const job = state.job;
    $('jobCard').hidden = !job;
    if (!job) return;

    const running = job.status === 'running';
    const kind = job.kind ? t(KIND[job.kind]) + (job.site ? ' (' + t(SITE_NAME[job.site]) + ')' : '') : '';
    $('jobStatus').textContent = t(STATUS[job.status] || 'statusError') + (kind ? ' · ' + kind : '');
    $('jobPhase').textContent = running && job.phase ? t(job.phase) : '';
    $('btnStop').hidden = !running;
    $('jobKeepTab').hidden = !running || job.kind === 'export';

    const bar = $('jobBar');
    const total = job.counters.total;
    bar.hidden = !running && !total;
    if (running && !total) {
      bar.removeAttribute('value'); // unknown length: animated bar
    } else {
      bar.max = Math.max(total, 1);
      bar.value = job.counters.processed;
    }

    listItems($('jobCounters'), (COUNTERS[job.kind] || []).map(([label, field]) => t(label) + ': ' + job.counters[field]));
    $('jobSummary').textContent = job.summary ? t(job.summary.k, job.summary.a) : '';
    $('jobError').textContent = job.error ? t(job.error.k, job.error.a) : '';
    const log = $('jobLog');
    listItems(log, (job.log || []).slice(-LOG_LINES).map((entry) => t(entry.k, entry.a)));
    log.scrollTop = log.scrollHeight;
  }

  function showNotice(result) {
    const notice = $('notice');
    notice.hidden = !result;
    if (result) notice.textContent = t(result.error, result.args);
  }

  function renderAll() {
    renderSite();
    renderJob();
    renderStats();
    renderActions();
  }

  // ---- Actions -------------------------------------------------------------------------------

  function saveSettings() {
    state.settings = { limit: $('limit').value, xUrl: $('xUrl').value.trim() || DEFAULT_X_URL };
    chrome.storage.local.set({ settings: state.settings }).catch(() => {});
  }

  async function send(message) {
    try {
      const reply = await chrome.runtime.sendMessage(message);
      return reply || { ok: false, error: 'errUnexpected', args: ['no response'] };
    } catch (e) {
      return { ok: false, error: 'errUnexpected', args: [String((e && e.message) || e)] };
    }
  }

  async function begin(kind) {
    saveSettings();
    showNotice(null);
    const reply = await send({
      type: 'start',
      kind,
      site: state.site,
      tabId: state.tabId,
      limit: $('limit').value,
      url: $('xUrl').value,
      confirmed: kind === 'clean' && $('chkBackup').checked
    });
    if (!reply.ok) {
      showNotice(reply);
      return;
    }
    if (kind === 'clean') $('chkBackup').checked = false; // every clean run needs a fresh confirmation
    await loadAll();
    renderAll();
  }

  async function onReset() {
    if (!window.confirm(t('confirmReset'))) return;
    const reply = await send({ type: 'reset' });
    if (!reply.ok) showNotice(reply);
    await loadAll();
    renderAll();
  }

  let statsTimer = null;
  function scheduleStats() {
    if (statsTimer) return;
    statsTimer = setTimeout(async () => {
      statsTimer = null;
      await loadAll();
      renderStats();
      renderActions();
    }, STATS_REFRESH_MS);
  }

  function onStorageChanged(changes, area) {
    if (area !== 'local') return;
    if (changes.job) {
      state.job = changes.job.newValue || null;
      renderJob();
      renderActions();
      if (!isRunning()) scheduleStats();
    }
    if (Object.keys(changes).some((key) => key !== 'job' && key !== 'settings')) scheduleStats();
  }

  async function init() {
    localize();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tabId = tab ? tab.id : null;
    state.site = tab && tab.url ? detectSite(tab.url) : null;
    await loadAll();
    $('limit').value = state.settings.limit || '';
    $('xUrl').value = state.settings.xUrl || DEFAULT_X_URL;
    renderAll();

    $('btnDownload').addEventListener('click', () => begin('download'));
    $('btnClean').addEventListener('click', () => begin('clean'));
    $('btnExport').addEventListener('click', () => begin('export'));
    $('btnStop').addEventListener('click', () => send({ type: 'stop' }));
    $('btnReset').addEventListener('click', onReset);
    $('chkBackup').addEventListener('change', renderActions);
    $('limit').addEventListener('change', saveSettings);
    $('xUrl').addEventListener('change', saveSettings);
    chrome.storage.onChanged.addListener(onStorageChanged);
  }

  init();
})();
