/**
 * ============================================================================
 * DeadlineSettings.gs — Ariza muddati sozlamalari (Administrator)
 * ----------------------------------------------------------------------------
 *   - Muddat qoidalari: ariza turi -> ish kunlari soni (SERVICE_RULES varag'i)
 *   - Bayram kunlari: ish kuni hisoblanmaydigan sanalar (HOLIDAYS varag'i)
 * O'zgarishlardan keyin tegishli keshlar avtomatik tozalanadi.
 * ============================================================================
 */

var DeadlineSettings = (function () {

  var RULE_HEADERS = ['ARIZA_TURI', 'TURAR_NOTURAR', 'MUDDAT_KUN'];
  var HOLIDAY_HEADERS = ['SANA', 'NOMI'];

  /* ----------------------------- QOIDALAR -------------------------------- */

  /** SERVICE_RULES varag'i mavjudligini va sarlavhalarini ta'minlaydi. */
  function _ensureRulesSheet() {
    if (!Repository.exists(SHEETS.SERVICE_RULES)) {
      Repository.ss().insertSheet(SHEETS.SERVICE_RULES);
    }
    var sh = Repository.sheet(SHEETS.SERVICE_RULES, true);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, RULE_HEADERS.length).setValues([RULE_HEADERS]);
    }
    return sh;
  }

  /**
   * Barcha muddat qoidalarini qaytaradi.
   * @returns {Array<{name: string, residency: string, days: number}>}
   */
  function getRules() {
    _ensureRulesSheet();
    var matrix = Repository.readMatrix(SHEETS.SERVICE_RULES);
    var out = [];
    for (var r = 1; r < matrix.length; r++) {
      var name = Utils.str(matrix[r][0]);
      if (!name) continue;
      out.push({
        name: name,
        residency: Utils.str(matrix[r][1]),
        days: Utils.toNumber(matrix[r][2])
      });
    }
    out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
  }

  /**
   * Muddat qoidasini qo'shadi yoki yangilaydi (nomi bo'yicha).
   * @param {Object} rule {name, residency, days}
   * @returns {{ok: boolean, error?: string}}
   */
  function saveRule(rule) {
    rule = rule || {};
    var name = Utils.str(rule.name);
    if (!name) return { ok: false, error: 'Ariza turi nomi kiritilmadi.' };
    var days = Utils.toNumber(rule.days);
    if (days <= 0 || days > 365) {
      return { ok: false, error: 'Muddat 1 dan 365 (ish kuni) gacha bo\'lishi kerak.' };
    }
    var residency = Utils.str(rule.residency);

    var sh = _ensureRulesSheet();
    var matrix = Repository.readMatrix(SHEETS.SERVICE_RULES);
    var target = Utils.normalize(name);
    for (var r = 1; r < matrix.length; r++) {
      if (Utils.normalize(matrix[r][0]) === target) {
        sh.getRange(r + 1, 1, 1, 3).setValues([[name, residency, days]]);
        _invalidate();
        return { ok: true, updated: true };
      }
    }
    sh.appendRow([name, residency, days]);
    _invalidate();
    return { ok: true, updated: false };
  }

  /**
   * Muddat qoidasini o'chiradi.
   * @param {string} name
   * @returns {{ok: boolean, error?: string}}
   */
  function deleteRule(name) {
    var sh = _ensureRulesSheet();
    var matrix = Repository.readMatrix(SHEETS.SERVICE_RULES);
    var target = Utils.normalize(name);
    for (var r = 1; r < matrix.length; r++) {
      if (Utils.normalize(matrix[r][0]) === target) {
        sh.deleteRow(r + 1);
        _invalidate();
        return { ok: true };
      }
    }
    return { ok: false, error: 'Qoida topilmadi.' };
  }

  /* ----------------------------- BAYRAMLAR ------------------------------- */

  /** HOLIDAYS varag'i mavjudligini va sarlavhalarini ta'minlaydi. */
  function _ensureHolidaySheet() {
    if (!Repository.exists(SHEETS.HOLIDAYS)) {
      Repository.ss().insertSheet(SHEETS.HOLIDAYS);
    }
    var sh = Repository.sheet(SHEETS.HOLIDAYS, true);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, HOLIDAY_HEADERS.length).setValues([HOLIDAY_HEADERS]);
    }
    return sh;
  }

  /**
   * Barcha bayram kunlarini qaytaradi (sana bo'yicha tartiblangan).
   * @returns {Array<{date: string, name: string}>}
   */
  function getHolidays() {
    _ensureHolidaySheet();
    var matrix = Repository.readMatrix(SHEETS.HOLIDAYS);
    var out = [];
    for (var r = 1; r < matrix.length; r++) {
      var d = Utils.toDate(matrix[r][0]);
      if (!d) continue;
      out.push({
        date: Utils.formatDate(d, 'yyyy-MM-dd'),
        dateFmt: Utils.formatDate(d, 'dd.MM.yyyy'),
        name: Utils.str(matrix[r][1])
      });
    }
    out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return out;
  }

  /**
   * Bayram kunini qo'shadi.
   * @param {Object} holiday {date, name}
   * @returns {{ok: boolean, error?: string}}
   */
  function addHoliday(holiday) {
    holiday = holiday || {};
    var d = Utils.toDate(holiday.date);
    if (!d) return { ok: false, error: 'Sana noto\'g\'ri formatda.' };
    var key = Utils.formatDate(d, 'yyyy-MM-dd');

    var sh = _ensureHolidaySheet();
    var matrix = Repository.readMatrix(SHEETS.HOLIDAYS);
    for (var r = 1; r < matrix.length; r++) {
      var ed = Utils.toDate(matrix[r][0]);
      if (ed && Utils.formatDate(ed, 'yyyy-MM-dd') === key) {
        return { ok: false, error: 'Bu sana allaqachon kiritilgan.' };
      }
    }
    sh.appendRow([Utils.formatDate(d, 'dd.MM.yyyy'), Utils.str(holiday.name)]);
    _invalidate();
    return { ok: true };
  }

  /**
   * Bayram kunini o'chiradi.
   * @param {string} date 'yyyy-MM-dd' yoki boshqa format
   * @returns {{ok: boolean, error?: string}}
   */
  function deleteHoliday(date) {
    var d = Utils.toDate(date);
    if (!d) return { ok: false, error: 'Sana noto\'g\'ri.' };
    var key = Utils.formatDate(d, 'yyyy-MM-dd');
    var sh = _ensureHolidaySheet();
    var matrix = Repository.readMatrix(SHEETS.HOLIDAYS);
    for (var r = 1; r < matrix.length; r++) {
      var ed = Utils.toDate(matrix[r][0]);
      if (ed && Utils.formatDate(ed, 'yyyy-MM-dd') === key) {
        sh.deleteRow(r + 1);
        _invalidate();
        return { ok: true };
      }
    }
    return { ok: false, error: 'Bayram kuni topilmadi.' };
  }

  /* -------------------- MUDDAT FORMULASI QOIDALARI ----------------------- */
  // Excel formulasi (Аризани муддати кун) qiymatlari shu varaqda sozlanadi.
  // Tuzilma (qaysi shart, qaysi tartibda) kodda; bu yerda faqat KUNLAR.

  var CONFIG_HEADERS = ['KALIT', 'TAVSIF', 'QIYMAT'];

  /** Standart qiymatlar — foydalanuvchining Excel formulasidan olingan. */
  var DEFAULT_DEADLINE_CONFIG = [
    ['manba:Kadastr muhandisi', 'Ariza manbasi = "Kadastr muhandisi"', 3],
    ['manba:UZKAD', 'Ariza manbasi = "UZKAD"', 5],
    ['flag:FREE', 'Kadastr passport olish turi = "FREE"', 5],
    ['ariza:Registratsiya (tashqi - UZKAD da bor)', 'Ariza turi (aniq moslik)', 1],
    ['ariza:Avtoyo\'l va suv xo\'jaligi obyektining kadastr pasportini shakllantirish va ro\'yxatga olish', 'Ariza turi (aniq moslik)', 7],
    ['ariza:Notarius uchun ma\'lumotnoma (uz)', 'Ariza turi (aniq moslik)', 1],
    ['ariza:Qurilishi tugallangan ko\'chmas mulkni foydalanishga qabul qilish', 'Ariza turi (aniq moslik)', 10],
    ['turar:yer_maydoni', 'Turar obyekt/kompozit + Obyekt turi 2 = "Turar yer maydoni"', 7],
    ['turar:default', 'Turar obyekt/kompozit (boshqa hollar)', 10],
    ['noturar:daraxtlar', 'Noturar + Priznak = "Ko\u2018p yillik daraxtlar xizmati"', 15],
    ['noturar:yer_yoki_davlat', 'Noturar yer maydoni / Davlat ijara yer uchastkasi', 7],
    ['umumiy:turar', 'Umumiy foydalanish — "Turar" deb aniqlangan', 10],
    ['maydon:<100', 'Maydon < 100 m\u00b2', 10],
    ['maydon:<=1000', 'Maydon 100\u20131000 m\u00b2', 12],
    ['maydon:<=5000', 'Maydon 1000\u20135000 m\u00b2', 17],
    ['maydon:<=15000', 'Maydon 5000\u201315000 m\u00b2', 22],
    ['maydon:<=50000', 'Maydon 15000\u201350000 m\u00b2', 28],
    ['maydon:>50000', 'Maydon > 50000 m\u00b2', 37],
    ['default', 'Hech qaysi qoidaga mos kelmasa (standart)', 10]
  ];

  /** Tahrirlanmaydigan (tuzilmaviy) kalitlar — UI'da o'chirish tugmasi ko'rsatilmaydi. */
  var FIXED_CONFIG_KEYS = {
    'turar:yer_maydoni': true, 'turar:default': true,
    'noturar:daraxtlar': true, 'noturar:yer_yoki_davlat': true,
    'umumiy:turar': true,
    'maydon:<100': true, 'maydon:<=1000': true, 'maydon:<=5000': true,
    'maydon:<=15000': true, 'maydon:<=50000': true, 'maydon:>50000': true,
    'default': true
  };

  /** MUDDAT_QOIDALARI varag'i mavjudligini, sarlavha va standart qiymatlarini ta'minlaydi. */
  function _ensureConfigSheet() {
    if (!Repository.exists(SHEETS.DEADLINE_RULES)) {
      Repository.ss().insertSheet(SHEETS.DEADLINE_RULES);
    }
    var sh = Repository.sheet(SHEETS.DEADLINE_RULES, true);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, CONFIG_HEADERS.length).setValues([CONFIG_HEADERS]);
    }
    // Bo'sh bo'lsa — standart qiymatlar bilan to'ldiramiz (seed).
    if (sh.getLastRow() < 2) {
      sh.getRange(2, 1, DEFAULT_DEADLINE_CONFIG.length, 3).setValues(DEFAULT_DEADLINE_CONFIG);
      _invalidate();
    }
    return sh;
  }

  /**
   * Barcha muddat-formula qiymatlarini qaytaradi.
   * @returns {Array<{key, desc, value, fixed}>}
   */
  function getDeadlineConfig() {
    _ensureConfigSheet();
    var matrix = Repository.readMatrix(SHEETS.DEADLINE_RULES);
    var out = [];
    for (var r = 1; r < matrix.length; r++) {
      var key = Utils.str(matrix[r][0]);
      if (!key) continue;
      out.push({
        key: key,
        desc: Utils.str(matrix[r][1]),
        value: Utils.toNumber(matrix[r][2]),
        fixed: FIXED_CONFIG_KEYS[key] === true
      });
    }
    return out;
  }

  /**
   * Muddat-formula qiymatlarini tezkor {kalit: kun} xaritasi sifatida qaytaradi.
   * BusinessLogic shu xaritadan foydalanadi.
   * @returns {Object<string, number>}
   */
  function getDeadlineConfigMap() {
    var list = getDeadlineConfig();
    var map = {};
    for (var i = 0; i < list.length; i++) map[list[i].key] = list[i].value;
    return map;
  }

  /**
   * Bitta qiymatni saqlaydi (qo'shadi yoki yangilaydi).
   * @param {string} key
   * @param {number} value ish kunlari soni
   * @param {string} [desc]
   * @returns {{ok: boolean, error?: string}}
   */
  function saveDeadlineParam(key, value, desc) {
    key = Utils.str(key);
    if (!key) return { ok: false, error: 'Kalit kiritilmadi.' };
    var days = Utils.toNumber(value);
    if (days < 0 || days > 365) {
      return { ok: false, error: 'Kun 0 dan 365 gacha bo\'lishi kerak.' };
    }
    var sh = _ensureConfigSheet();
    var matrix = Repository.readMatrix(SHEETS.DEADLINE_RULES);
    for (var r = 1; r < matrix.length; r++) {
      if (Utils.str(matrix[r][0]) === key) {
        var keepDesc = desc !== undefined && desc !== null ? Utils.str(desc) : Utils.str(matrix[r][1]);
        sh.getRange(r + 1, 1, 1, 3).setValues([[key, keepDesc, days]]);
        _invalidate();
        return { ok: true, updated: true };
      }
    }
    sh.appendRow([key, Utils.str(desc), days]);
    _invalidate();
    return { ok: true, updated: false };
  }

  /**
   * Qiymatni o'chiradi (tuzilmaviy/fixed kalitlar o'chirilmaydi).
   * @param {string} key
   * @returns {{ok: boolean, error?: string}}
   */
  function deleteDeadlineParam(key) {
    key = Utils.str(key);
    if (FIXED_CONFIG_KEYS[key]) {
      return { ok: false, error: 'Bu tuzilmaviy qoida — o\'chirib bo\'lmaydi (faqat qiymatini o\'zgartiring).' };
    }
    var sh = _ensureConfigSheet();
    var matrix = Repository.readMatrix(SHEETS.DEADLINE_RULES);
    for (var r = 1; r < matrix.length; r++) {
      if (Utils.str(matrix[r][0]) === key) {
        sh.deleteRow(r + 1);
        _invalidate();
        return { ok: true };
      }
    }
    return { ok: false, error: 'Qoida topilmadi.' };
  }

  /** Barcha qiymatlarni standart holatga qaytaradi. */
  function resetDeadlineConfig() {
    if (Repository.exists(SHEETS.DEADLINE_RULES)) {
      Repository.clearAll(SHEETS.DEADLINE_RULES);
    }
    _ensureConfigSheet();
    _invalidate();
    return { ok: true };
  }

  /* -------------------- ARIZA MANBASI FILTRI ----------------------------- */
  // Hisobotga FAQAT shu yerda belgilangan manbaalardan kelgan arizalar kiradi.
  // Ro'yxat BO'SH bo'lsa — barcha manbalar kiritiladi (filtr o'chiq).

  var SOURCE_HEADERS = ['MANBA'];

  /** ARIZA_MANBASI varag'i mavjudligini ta'minlaydi (bo'sh — filtr o'chiq). */
  function _ensureSourceSheet() {
    if (!Repository.exists(SHEETS.SOURCES)) {
      Repository.ss().insertSheet(SHEETS.SOURCES);
    }
    var sh = Repository.sheet(SHEETS.SOURCES, true);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, SOURCE_HEADERS.length).setValues([SOURCE_HEADERS]);
    }
    return sh;
  }

  /**
   * Ruxsat etilgan manbalar ro'yxati.
   * @returns {Array<string>}
   */
  function getAllowedSources() {
    _ensureSourceSheet();
    var matrix = Repository.readMatrix(SHEETS.SOURCES);
    var out = [];
    for (var r = 1; r < matrix.length; r++) {
      var name = Utils.str(matrix[r][0]);
      if (name) out.push(name);
    }
    out.sort(function (a, b) { return a.localeCompare(b); });
    return out;
  }

  /**
   * Ruxsat etilgan manbalar to'plami (normallashgan). Ro'yxat bo'sh — null
   * (ya'ni filtr qo'llanmaydi, barcha manbalar kiritiladi).
   * @returns {Object<string, boolean>|null}
   */
  function getAllowedSourceSet() {
    var list = getAllowedSources();
    if (!list.length) return null;
    var map = {};
    for (var i = 0; i < list.length; i++) map[Utils.normalize(list[i])] = true;
    return map;
  }

  /**
   * Manbani ruxsat ro'yxatiga qo'shadi.
   * @param {string} name
   * @returns {{ok: boolean, error?: string}}
   */
  function addSource(name) {
    name = Utils.str(name);
    if (!name) return { ok: false, error: 'Manba nomi kiritilmadi.' };
    var sh = _ensureSourceSheet();
    var matrix = Repository.readMatrix(SHEETS.SOURCES);
    var target = Utils.normalize(name);
    for (var r = 1; r < matrix.length; r++) {
      if (Utils.normalize(matrix[r][0]) === target) {
        return { ok: true, exists: true };
      }
    }
    sh.appendRow([name]);
    _invalidate();
    return { ok: true };
  }

  /**
   * Manbani ruxsat ro'yxatidan o'chiradi.
   * @param {string} name
   * @returns {{ok: boolean, error?: string}}
   */
  function deleteSource(name) {
    var sh = _ensureSourceSheet();
    var matrix = Repository.readMatrix(SHEETS.SOURCES);
    var target = Utils.normalize(name);
    for (var r = 1; r < matrix.length; r++) {
      if (Utils.normalize(matrix[r][0]) === target) {
        sh.deleteRow(r + 1);
        _invalidate();
        return { ok: true };
      }
    }
    return { ok: false, error: 'Manba topilmadi.' };
  }

  /** Standart muddat (ish kuni) — qoidaga mos kelmagan arizalar uchun. */
  function getDefaultDays() {
    return Config.value('defaultDeadlineDays', 10);
  }

  /** O'zgarishlardan keyin tegishli keshlarni tozalaydi. */
  function _invalidate() {
    BusinessCalendar.invalidate();
    BusinessLogic.invalidate();
    try { Dashboard.invalidate(); } catch (e) { /* Dashboard hali yuklanmagan bo'lishi mumkin */ }
  }

  return {
    getRules: getRules,
    saveRule: saveRule,
    deleteRule: deleteRule,
    getHolidays: getHolidays,
    addHoliday: addHoliday,
    deleteHoliday: deleteHoliday,
    getDefaultDays: getDefaultDays,
    getDeadlineConfig: getDeadlineConfig,
    getDeadlineConfigMap: getDeadlineConfigMap,
    saveDeadlineParam: saveDeadlineParam,
    deleteDeadlineParam: deleteDeadlineParam,
    resetDeadlineConfig: resetDeadlineConfig,
    getAllowedSources: getAllowedSources,
    getAllowedSourceSet: getAllowedSourceSet,
    addSource: addSource,
    deleteSource: deleteSource
  };
})();
