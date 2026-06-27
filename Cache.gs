/**
 * ============================================================================
 * Cache.gs — Ko'p qatlamli keshlash tizimi
 * ----------------------------------------------------------------------------
 * Uch qatlamli kesh:
 *   1. Memory (script bajarilishi davomida) — eng tez
 *   2. CacheService (qisqa muddatli, <100KB) — bo'laklarga ajratilgan
 *   3. PropertiesService (uzoq muddatli kichik metadata)
 *
 * 100 000+ qatorli statistikani tez yetkazib berish uchun katta obyektlar
 * CacheService'da bir nechta bo'lakka bo'lib saqlanadi.
 * ============================================================================
 */

var Cache = (function () {

  var _memory = {};                 // {key: {value, expires}}
  var CHUNK_LIMIT = 95000;          // CacheService bo'lak chegarasi (bayt)
  var MAX_CHUNKS = 40;              // bitta obyekt uchun maksimal bo'laklar

  /**
   * Memory keshdan o'qish.
   * @param {string} key
   * @returns {*|undefined}
   */
  function _memGet(key) {
    var entry = _memory[key];
    if (!entry) return undefined;
    if (entry.expires && entry.expires < Date.now()) {
      delete _memory[key];
      return undefined;
    }
    return entry.value;
  }

  function _memSet(key, value, ttlSec) {
    _memory[key] = {
      value: value,
      expires: ttlSec ? Date.now() + ttlSec * 1000 : 0
    };
  }

  /**
   * Kesh qiymatini olish (memory -> CacheService).
   * @param {string} key
   * @returns {*|null}
   */
  function get(key) {
    var mem = _memGet(key);
    if (mem !== undefined) return mem;

    try {
      var cache = CacheService.getScriptCache();
      var meta = cache.get('meta::' + key);
      if (!meta) return null;

      var info = JSON.parse(meta);
      var raw;
      if (info.chunks > 1) {
        var keys = [];
        for (var i = 0; i < info.chunks; i++) keys.push('chunk::' + key + '::' + i);
        var parts = cache.getAll(keys);
        var buf = '';
        for (var j = 0; j < info.chunks; j++) {
          var piece = parts['chunk::' + key + '::' + j];
          if (piece == null) return null; // bo'lak yo'qolgan -> kesh yaroqsiz
          buf += piece;
        }
        raw = buf;
      } else {
        raw = cache.get('chunk::' + key + '::0');
        if (raw == null) return null;
      }

      var value = info.json ? JSON.parse(raw) : raw;
      _memSet(key, value, info.ttl);
      return value;
    } catch (e) {
      Logger.log('Cache.get xato (' + key + '): ' + e);
      return null;
    }
  }

  /**
   * Kesh qiymatini saqlash (memory + CacheService bo'laklab).
   * @param {string} key
   * @param {*} value
   * @param {number} [ttlSec]
   * @returns {boolean}
   */
  function set(key, value, ttlSec) {
    var ttl = ttlSec || Config.value('cacheTtlSec', 1800);
    _memSet(key, value, ttl);

    try {
      var cache = CacheService.getScriptCache();
      var isJson = typeof value !== 'string';
      var raw = isJson ? JSON.stringify(value) : value;
      var chunks = [];
      for (var i = 0; i < raw.length; i += CHUNK_LIMIT) {
        chunks.push(raw.substring(i, i + CHUNK_LIMIT));
      }
      if (chunks.length > MAX_CHUNKS) {
        // Juda katta — faqat memory keshda qoldiramiz.
        return false;
      }
      var toStore = {};
      for (var c = 0; c < chunks.length; c++) {
        toStore['chunk::' + key + '::' + c] = chunks[c];
      }
      toStore['meta::' + key] = JSON.stringify({
        chunks: chunks.length, json: isJson, ttl: ttl
      });
      cache.putAll(toStore, ttl);
      return true;
    } catch (e) {
      Logger.log('Cache.set xato (' + key + '): ' + e);
      return false;
    }
  }

  /**
   * Funksiya natijasini keshlash (memoization).
   * @param {string} key
   * @param {function} producer Qiymat ishlab chiqaruvchi funksiya
   * @param {number} [ttlSec]
   * @returns {*}
   */
  function remember(key, producer, ttlSec) {
    var cached = get(key);
    if (cached !== null && cached !== undefined) return cached;
    var value = producer();
    set(key, value, ttlSec);
    return value;
  }

  /**
   * Bitta kalitni o'chirish.
   * @param {string} key
   */
  function remove(key) {
    delete _memory[key];
    try {
      var cache = CacheService.getScriptCache();
      var meta = cache.get('meta::' + key);
      var info = meta ? JSON.parse(meta) : { chunks: 1 };
      var keys = ['meta::' + key];
      for (var i = 0; i < (info.chunks || 1); i++) {
        keys.push('chunk::' + key + '::' + i);
      }
      cache.removeAll(keys);
    } catch (e) {
      Logger.log('Cache.remove xato (' + key + '): ' + e);
    }
  }

  /**
   * Berilgan prefiksli barcha keshlarni bekor qilish.
   * Kalitlar ro'yxati PropertiesService'da kuzatiladi.
   * @param {string} [prefix]
   */
  function invalidate(prefix) {
    // Memory tozalash
    for (var k in _memory) {
      if (!prefix || k.indexOf(prefix) === 0) delete _memory[k];
    }
    // Kuzatilgan kalitlar
    try {
      var props = PropertiesService.getScriptProperties();
      var tracked = props.getProperty('CACHE_KEYS');
      if (tracked) {
        var list = JSON.parse(tracked);
        var remaining = [];
        for (var i = 0; i < list.length; i++) {
          if (!prefix || list[i].indexOf(prefix) === 0) {
            remove(list[i]);
          } else {
            remaining.push(list[i]);
          }
        }
        props.setProperty('CACHE_KEYS', JSON.stringify(remaining));
      }
    } catch (e) {
      Logger.log('Cache.invalidate xato: ' + e);
    }
  }

  /** Kuzatiladigan kalitlar ro'yxatiga qo'shish. */
  function track(key) {
    try {
      var props = PropertiesService.getScriptProperties();
      var tracked = props.getProperty('CACHE_KEYS');
      var list = tracked ? JSON.parse(tracked) : [];
      if (list.indexOf(key) === -1) {
        list.push(key);
        props.setProperty('CACHE_KEYS', JSON.stringify(list));
      }
    } catch (e) { /* sukut saqlanadi */ }
  }

  /** Import yoki ma'lumot o'zgargandan keyin barcha analitik keshni tozalash. */
  function flushAll() {
    _memory = {};
    try {
      CacheService.getScriptCache().removeAll(
        JSON.parse(PropertiesService.getScriptProperties().getProperty('CACHE_KEYS') || '[]')
          .map(function (k) { return 'meta::' + k; }));
    } catch (e) { /* ignore */ }
    invalidate('');
  }

  return {
    get: get,
    set: set,
    remember: remember,
    remove: remove,
    invalidate: invalidate,
    track: track,
    flushAll: flushAll
  };
})();
