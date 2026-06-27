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

  /** Standart muddat (ish kuni) — qoidaga mos kelmagan arizalar uchun. */
  function getDefaultDays() {
    return Config.value('defaultDeadlineDays', 10);
  }

  /** O'zgarishlardan keyin tegishli keshlarni tozalaydi. */
  function _invalidate() {
    BusinessCalendar.invalidate();
    BusinessLogic.invalidate();
  }

  return {
    getRules: getRules,
    saveRule: saveRule,
    deleteRule: deleteRule,
    getHolidays: getHolidays,
    addHoliday: addHoliday,
    deleteHoliday: deleteHoliday,
    getDefaultDays: getDefaultDays
  };
})();
