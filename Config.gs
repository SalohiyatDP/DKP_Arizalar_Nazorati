/**
 * ============================================================================
 * DKP ARIZALAR NAZORATI — Enterprise Analytics Platform
 * Config.gs — Markaziy konfiguratsiya qatlami
 * ----------------------------------------------------------------------------
 * Tizimning barcha sozlamalari shu yerda jamlangan. Hech qanday "magic string"
 * kod ichida ishlatilmaydi. Sozlamalar bir nechta manbadan birlashtiriladi:
 *   1. Standart qiymatlar (DEFAULT_CONFIG)
 *   2. SETTINGS varag'idagi qiymatlar (administrator tomonidan tahrirlanadi)
 *   3. PropertiesService (runtime override)
 * ============================================================================
 */

/**
 * @typedef {Object} SystemConfig
 * @property {string} appName        Ilova nomi
 * @property {string} version        Versiya
 * @property {string} timeZone       Vaqt mintaqasi
 * @property {string} locale         Til/mintaqa (uz-UZ)
 * @property {string} currency       Valyuta belgisi
 * @property {number} sessionTtlMin  Sessiya muddati (daqiqa)
 * @property {number} pageSize       Standart sahifalash hajmi
 * @property {number} cacheTtlSec    Kesh muddati (soniya)
 * @property {number} maxImportRows  Bitta importdagi maksimal qatorlar
 */

/** Tizimning standart konfiguratsiyasi (o'zgartirib bo'lmaydigan poydevor). */
var DEFAULT_CONFIG = {
  appName: 'DKP Arizalar Nazorati',
  appShortName: 'DKP Nazorat',
  organization: 'Davlat Kadastr Palatasi',
  version: '1.0.0',
  timeZone: 'Asia/Tashkent',
  locale: 'uz-UZ',
  currency: "so'm",
  currencyCode: 'UZS',

  // --- Xavfsizlik ---
  sessionTtlMin: 720,            // 12 soat
  rememberMeTtlMin: 43200,       // 30 kun
  passwordMinLength: 8,
  passwordHistoryDepth: 5,
  maxLoginAttempts: 5,
  loginLockMinutes: 15,
  saltLength: 16,
  hashIterations: 10000,

  // --- Ishlash unumdorligi ---
  pageSize: 50,
  maxPageSize: 500,
  cacheTtlSec: 1800,             // 30 daqiqa
  shortCacheTtlSec: 300,         // 5 daqiqa
  importChunkSize: 5000,
  maxImportRows: 200000,

  // --- Muddatlar ---
  defaultDeadlineDays: 10,       // standart ariza muddati (ish kuni)

  // --- Eksport ---
  exportMaxRows: 100000,
  exportBatchSize: 2000,

  // --- Bildirishnomalar ---
  notifyEmailEnabled: false,
  notifyAdminEmail: ''
};

/**
 * SETTINGS varag'idan o'qiladigan kalitlar va ularning tiplari.
 * Administrator bu qiymatlarni varaqdan o'zgartirishi mumkin.
 */
var SETTINGS_SCHEMA = {
  'APP_NAME': 'string',
  'ORGANIZATION': 'string',
  'SESSION_TTL_MIN': 'number',
  'PAGE_SIZE': 'number',
  'CACHE_TTL_SEC': 'number',
  'DEFAULT_DEADLINE_DAYS': 'number',
  'PASSWORD_MIN_LENGTH': 'number',
  'MAX_LOGIN_ATTEMPTS': 'number',
  'NOTIFY_EMAIL_ENABLED': 'boolean',
  'NOTIFY_ADMIN_EMAIL': 'string',
  'DARK_MODE_DEFAULT': 'boolean'
};

/**
 * Konfiguratsiya menejeri (Singleton). Sozlamalarni birlashtiradi va keshlaydi.
 */
var Config = (function () {
  var _cache = null;
  var _cacheStamp = 0;
  var CONFIG_CACHE_MS = 60000; // 1 daqiqa runtime kesh

  /**
   * SETTINGS varag'idan administrator sozlamalarini o'qish.
   * @returns {Object<string, *>}
   */
  function _readSettingsSheet() {
    var result = {};
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      if (!ss) return result;
      var sheet = ss.getSheetByName('SETTINGS');
      if (!sheet || sheet.getLastRow() < 2) return result;

      var range = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
      for (var i = 0; i < range.length; i++) {
        var key = String(range[i][0] || '').trim().toUpperCase();
        var raw = range[i][1];
        if (!key) continue;
        var type = SETTINGS_SCHEMA[key];
        if (!type) { result[key] = raw; continue; }
        result[key] = _coerce(raw, type);
      }
    } catch (e) {
      // SETTINGS o'qishda xato — standart qiymatlarga qaytamiz.
      Logger.log('Config._readSettingsSheet xato: ' + e);
    }
    return result;
  }

  /**
   * Qiymatni belgilangan tipga keltirish.
   * @param {*} raw
   * @param {string} type
   * @returns {*}
   */
  function _coerce(raw, type) {
    if (type === 'number') {
      var n = Number(raw);
      return isNaN(n) ? 0 : n;
    }
    if (type === 'boolean') {
      var s = String(raw).trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'ha' || s === 'yes';
    }
    return raw == null ? '' : String(raw);
  }

  /**
   * Birlashtirilgan (effektiv) konfiguratsiyani qaytaradi.
   * @param {boolean} [force] Keshni e'tiborsiz qoldirish.
   * @returns {SystemConfig}
   */
  function get(force) {
    var now = Date.now();
    if (!force && _cache && (now - _cacheStamp) < CONFIG_CACHE_MS) {
      return _cache;
    }

    var cfg = {};
    for (var k in DEFAULT_CONFIG) {
      if (DEFAULT_CONFIG.hasOwnProperty(k)) cfg[k] = DEFAULT_CONFIG[k];
    }

    var settings = _readSettingsSheet();
    if (settings.APP_NAME) cfg.appName = settings.APP_NAME;
    if (settings.ORGANIZATION) cfg.organization = settings.ORGANIZATION;
    if (settings.SESSION_TTL_MIN) cfg.sessionTtlMin = settings.SESSION_TTL_MIN;
    if (settings.PAGE_SIZE) cfg.pageSize = settings.PAGE_SIZE;
    if (settings.CACHE_TTL_SEC) cfg.cacheTtlSec = settings.CACHE_TTL_SEC;
    if (settings.DEFAULT_DEADLINE_DAYS) cfg.defaultDeadlineDays = settings.DEFAULT_DEADLINE_DAYS;
    if (settings.PASSWORD_MIN_LENGTH) cfg.passwordMinLength = settings.PASSWORD_MIN_LENGTH;
    if (settings.MAX_LOGIN_ATTEMPTS) cfg.maxLoginAttempts = settings.MAX_LOGIN_ATTEMPTS;
    if (settings.NOTIFY_EMAIL_ENABLED != null) cfg.notifyEmailEnabled = settings.NOTIFY_EMAIL_ENABLED;
    if (settings.NOTIFY_ADMIN_EMAIL) cfg.notifyAdminEmail = settings.NOTIFY_ADMIN_EMAIL;
    cfg.darkModeDefault = settings.DARK_MODE_DEFAULT === true;

    _cache = cfg;
    _cacheStamp = now;
    return cfg;
  }

  /**
   * Bitta sozlama qiymatini olish.
   * @param {string} key
   * @param {*} [fallback]
   * @returns {*}
   */
  function value(key, fallback) {
    var cfg = get();
    return (cfg[key] !== undefined && cfg[key] !== null) ? cfg[key] : fallback;
  }

  /** Runtime keshni tozalash. */
  function invalidate() {
    _cache = null;
    _cacheStamp = 0;
  }

  return {
    get: get,
    value: value,
    invalidate: invalidate
  };
})();
