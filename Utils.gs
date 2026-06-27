/**
 * ============================================================================
 * Utils.gs — Umumiy yordamchi funksiyalar (Utility Layer)
 * ----------------------------------------------------------------------------
 * Sana, matn, raqam, xavfsizlik va massiv bilan ishlash uchun toza, qayta
 * ishlatiluvchi funksiyalar. Hech qanday biznes mantiq bu yerda bo'lmaydi.
 * ============================================================================
 */

var Utils = (function () {

  /* ----------------------------- SANA ------------------------------------ */

  /**
   * Har qanday qiymatni Date obyektiga aylantiradi.
   * @param {*} value Date, raqam (seriya), yoki matn
   * @returns {Date|null}
   */
  function toDate(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === 'number') {
      // Google Sheets seriya raqami (1899-12-30 dan boshlab).
      var epoch = new Date(Date.UTC(1899, 11, 30));
      var ms = Math.round(value * 86400000);
      var d = new Date(epoch.getTime() + ms);
      return isNaN(d.getTime()) ? null : d;
    }
    var s = String(value).trim();
    if (!s) return null;
    // dd.mm.yyyy yoki dd/mm/yyyy formatlari.
    var m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
    if (m) {
      var day = parseInt(m[1], 10);
      var mon = parseInt(m[2], 10) - 1;
      var yr = parseInt(m[3], 10);
      if (yr < 100) yr += 2000;
      var d2 = new Date(yr, mon, day);
      return isNaN(d2.getTime()) ? null : d2;
    }
    var parsed = new Date(s);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * Vaqt qismini olib tashlab, kunning boshini qaytaradi (00:00).
   * @param {Date} date
   * @returns {Date}
   */
  function startOfDay(date) {
    var d = new Date(date.getTime());
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Ikki sananing kun farqini qaytaradi (b - a), kalendar kunlarda.
   * @param {Date} a
   * @param {Date} b
   * @returns {number}
   */
  function daysBetween(a, b) {
    var ms = startOfDay(b).getTime() - startOfDay(a).getTime();
    return Math.round(ms / 86400000);
  }

  /**
   * Sanani formatlash (kun.oy.yil).
   * @param {Date|*} value
   * @param {string} [pattern] Apps Script format patterni
   * @returns {string}
   */
  function formatDate(value, pattern) {
    var d = toDate(value);
    if (!d) return '';
    var tz = Config.value('timeZone', 'Asia/Tashkent');
    return Utilities.formatDate(d, tz, pattern || 'dd.MM.yyyy');
  }

  /**
   * Sana va vaqtni formatlash.
   * @param {Date|*} value
   * @returns {string}
   */
  function formatDateTime(value) {
    return formatDate(value, 'dd.MM.yyyy HH:mm:ss');
  }

  /**
   * ISO formatdagi joriy vaqt.
   * @returns {string}
   */
  function nowIso() {
    return Utilities.formatDate(new Date(), Config.value('timeZone', 'Asia/Tashkent'),
      "yyyy-MM-dd'T'HH:mm:ss");
  }

  /** Bugungi kun (00:00). @returns {Date} */
  function today() {
    return startOfDay(new Date());
  }

  /* ----------------------------- MATN ------------------------------------ */

  /**
   * Matnni xavfsiz string ko'rinishiga keltiradi.
   * @param {*} v
   * @returns {string}
   */
  function str(v) {
    return v == null ? '' : String(v).trim();
  }

  /**
   * HTML belgilarini ekranlash (XSS himoyasi).
   * @param {*} v
   * @returns {string}
   */
  function escapeHtml(v) {
    var s = str(v);
    return s.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
  }

  /**
   * Matnni normallashtirish: kichik harf, ortiqcha bo'shliqlarsiz.
   * @param {*} v
   * @returns {string}
   */
  function normalize(v) {
    return str(v).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Faqat raqamlarni qoldiradi (PNFL, STIR, telefon uchun).
   * @param {*} v
   * @returns {string}
   */
  function digitsOnly(v) {
    return str(v).replace(/\D+/g, '');
  }

  /**
   * Matnni kapitalizatsiya qilish (har bir so'z bosh harf bilan).
   * @param {*} v
   * @returns {string}
   */
  function titleCase(v) {
    return str(v).toLowerCase().replace(/(^|\s)\S/g, function (c) {
      return c.toUpperCase();
    });
  }

  /* ----------------------------- RAQAM ----------------------------------- */

  /**
   * Har qanday qiymatni songa aylantiradi (vergul, bo'shliqlarni tozalaydi).
   * @param {*} v
   * @returns {number}
   */
  function toNumber(v) {
    if (typeof v === 'number') return isNaN(v) ? 0 : v;
    var s = str(v).replace(/\s+/g, '').replace(/,/g, '.').replace(/[^\d.\-]/g, '');
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  /**
   * Pul summasini formatlash (1 234 567 so'm).
   * @param {number} v
   * @param {boolean} [withCurrency]
   * @returns {string}
   */
  function formatMoney(v, withCurrency) {
    var n = toNumber(v);
    var sign = n < 0 ? '-' : '';
    n = Math.abs(Math.round(n));
    var s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return sign + s + (withCurrency ? ' ' + Config.value('currency', "so'm") : '');
  }

  /**
   * Foizni formatlash.
   * @param {number} v 0..100
   * @returns {string}
   */
  function formatPercent(v) {
    return (Math.round(toNumber(v) * 10) / 10) + '%';
  }

  /**
   * Sonni xavfsiz bo'lish (0 ga bo'lishni oldini oladi).
   * @param {number} a
   * @param {number} b
   * @returns {number}
   */
  function safeDivide(a, b) {
    b = toNumber(b);
    if (b === 0) return 0;
    return toNumber(a) / b;
  }

  /** @returns {number} foiz (0..100) */
  function percentOf(part, total) {
    return Math.round(safeDivide(part, total) * 1000) / 10;
  }

  /* -------------------------- XAVFSIZLIK ---------------------------------- */

  /**
   * UUID generatsiya qilish.
   * @returns {string}
   */
  function uuid() {
    return Utilities.getUuid();
  }

  /**
   * Tasodifiy token (URL-safe).
   * @param {number} [bytes]
   * @returns {string}
   */
  function randomToken(bytes) {
    var n = bytes || 24;
    var arr = [];
    for (var i = 0; i < n; i++) {
      arr.push(Math.floor(Math.random() * 256));
    }
    return Utilities.base64EncodeWebSafe(arr).replace(/=+$/, '');
  }

  /**
   * SHA-256 hex hash.
   * @param {string} text
   * @returns {string}
   */
  function sha256(text) {
    var raw = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, str(text), Utilities.Charset.UTF_8);
    return raw.map(function (b) {
      var v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    }).join('');
  }

  /* ---------------------------- MASSIV ----------------------------------- */

  /**
   * Massivni belgilangan o'lchamdagi bo'laklarga ajratadi (chunking).
   * @param {Array} arr
   * @param {number} size
   * @returns {Array<Array>}
   */
  function chunk(arr, size) {
    var out = [];
    for (var i = 0; i < arr.length; i += size) {
      out.push(arr.slice(i, i + size));
    }
    return out;
  }

  /**
   * Massivdagi noyob qiymatlar.
   * @param {Array} arr
   * @returns {Array}
   */
  function unique(arr) {
    var seen = {};
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var k = String(arr[i]);
      if (!seen[k]) { seen[k] = true; out.push(arr[i]); }
    }
    return out;
  }

  /**
   * Massiv elementlarini kalit bo'yicha guruhlaydi.
   * @param {Array<Object>} arr
   * @param {string|function} key
   * @returns {Object<string, Array>}
   */
  function groupBy(arr, key) {
    var fn = typeof key === 'function' ? key : function (x) { return x[key]; };
    var out = {};
    for (var i = 0; i < arr.length; i++) {
      var k = String(fn(arr[i]));
      if (!out[k]) out[k] = [];
      out[k].push(arr[i]);
    }
    return out;
  }

  /**
   * Massiv elementlarini kalit bo'yicha indekslaydi (Map).
   * @param {Array<Object>} arr
   * @param {string|function} key
   * @returns {Object<string, Object>}
   */
  function indexBy(arr, key) {
    var fn = typeof key === 'function' ? key : function (x) { return x[key]; };
    var out = {};
    for (var i = 0; i < arr.length; i++) {
      out[String(fn(arr[i]))] = arr[i];
    }
    return out;
  }

  /**
   * Massivni son maydoni bo'yicha yig'indilaydi.
   * @param {Array<Object>} arr
   * @param {string|function} field
   * @returns {number}
   */
  function sumBy(arr, field) {
    var fn = typeof field === 'function' ? field : function (x) { return x[field]; };
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += toNumber(fn(arr[i]));
    return s;
  }

  /* ---------------------------- OBYEKT ----------------------------------- */

  /**
   * Chuqur klonlash (JSON orqali).
   * @param {*} obj
   * @returns {*}
   */
  function deepClone(obj) {
    return obj == null ? obj : JSON.parse(JSON.stringify(obj));
  }

  /**
   * Obyektlarni birlashtirish (shallow).
   * @param {...Object} sources
   * @returns {Object}
   */
  function merge() {
    var out = {};
    for (var i = 0; i < arguments.length; i++) {
      var src = arguments[i] || {};
      for (var k in src) {
        if (src.hasOwnProperty(k)) out[k] = src[k];
      }
    }
    return out;
  }

  return {
    toDate: toDate,
    startOfDay: startOfDay,
    daysBetween: daysBetween,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    nowIso: nowIso,
    today: today,
    str: str,
    escapeHtml: escapeHtml,
    normalize: normalize,
    digitsOnly: digitsOnly,
    titleCase: titleCase,
    toNumber: toNumber,
    formatMoney: formatMoney,
    formatPercent: formatPercent,
    safeDivide: safeDivide,
    percentOf: percentOf,
    uuid: uuid,
    randomToken: randomToken,
    sha256: sha256,
    chunk: chunk,
    unique: unique,
    groupBy: groupBy,
    indexBy: indexBy,
    sumBy: sumBy,
    deepClone: deepClone,
    merge: merge
  };
})();
