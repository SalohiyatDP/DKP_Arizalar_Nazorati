/**
 * ============================================================================
 * BusinessCalendar.gs — Ish kunlari kalendari dvigateli
 * ----------------------------------------------------------------------------
 * Muddatlar FAQAT ish kunlari bo'yicha hisoblanadi.
 *   - Shanba va Yakshanba — dam olish kunlari.
 *   - HOLIDAYS varag'idagi sanalar — bayram/dam olish kunlari.
 * Administrator HOLIDAYS varag'ini tahrirlaydi.
 *
 * Excel ekvivalentlari: WORKDAY, NETWORKDAYS — bu yerda JavaScriptda qayta yozilgan.
 * ============================================================================
 */

var BusinessCalendar = (function () {

  var HOLIDAY_CACHE_KEY = 'biz::holidays';

  /**
   * HOLIDAYS varag'idagi bayram sanalarini Set (lookup map) sifatida o'qiydi.
   * Kesh orqali takroriy o'qishlar oldini oladi.
   * @returns {Object<string, boolean>} {'yyyy-MM-dd': true}
   */
  function _loadHolidays() {
    return Cache.remember(HOLIDAY_CACHE_KEY, function () {
      var map = {};
      try {
        if (!Repository.exists(SHEETS.HOLIDAYS)) return map;
        var matrix = Repository.readMatrix(SHEETS.HOLIDAYS);
        // 1-qator sarlavha deb qabul qilinadi; 1-ustun — sana.
        for (var r = 1; r < matrix.length; r++) {
          var d = Utils.toDate(matrix[r][0]);
          if (d) map[_key(d)] = true;
        }
      } catch (e) {
        Logger.log('BusinessCalendar._loadHolidays xato: ' + e);
      }
      return map;
    }, Config.value('cacheTtlSec', 1800));
  }

  /**
   * Sana kaliti (yyyy-MM-dd).
   * @param {Date} d
   * @returns {string}
   */
  function _key(d) {
    return Utilities.formatDate(Utils.startOfDay(d),
      Config.value('timeZone', 'Asia/Tashkent'), 'yyyy-MM-dd');
  }

  /**
   * Berilgan kun dam olish kuni (shanba/yakshanba)mi?
   * @param {Date} d
   * @returns {boolean}
   */
  function isWeekend(d) {
    var day = d.getDay(); // 0=Yakshanba, 6=Shanba
    return day === 0 || day === 6;
  }

  /**
   * Berilgan kun bayrammi (HOLIDAYS varag'ida bormi)?
   * @param {Date} d
   * @returns {boolean}
   */
  function isHoliday(d) {
    var holidays = _loadHolidays();
    return holidays[_key(d)] === true;
  }

  /**
   * Berilgan kun ish kunimi (dam olish ham, bayram ham emas)?
   * @param {Date|*} date
   * @returns {boolean}
   */
  function isWorkingDay(date) {
    var d = Utils.toDate(date);
    if (!d) return false;
    return !isWeekend(d) && !isHoliday(d);
  }

  /**
   * Keyingi ish kunini qaytaradi (agar berilgan kun ish kuni bo'lsa — o'sha kun).
   * @param {Date|*} date
   * @returns {Date}
   */
  function nextWorkingDay(date) {
    var d = Utils.startOfDay(Utils.toDate(date) || new Date());
    while (!isWorkingDay(d)) {
      d = _addDays(d, 1);
    }
    return d;
  }

  /**
   * Berilgan sanaga N ta ish kuni qo'shadi (Excel WORKDAY ekvivalenti).
   * @param {Date|*} date Boshlang'ich sana
   * @param {number} workDays Qo'shiladigan ish kunlari (manfiy ham mumkin)
   * @returns {Date}
   */
  function addWorkingDays(date, workDays) {
    var d = Utils.startOfDay(Utils.toDate(date) || new Date());
    var remaining = Math.abs(workDays);
    var step = workDays >= 0 ? 1 : -1;
    while (remaining > 0) {
      d = _addDays(d, step);
      if (isWorkingDay(d)) remaining--;
    }
    return d;
  }

  /**
   * Ikki sana orasidagi ish kunlari soni (Excel NETWORKDAYS ekvivalenti).
   * Boshlang'ich va yakuniy kunlar ham hisobga olinadi.
   * @param {Date|*} start
   * @param {Date|*} end
   * @returns {number}
   */
  function workingDaysBetween(start, end) {
    var a = Utils.toDate(start);
    var b = Utils.toDate(end);
    if (!a || !b) return 0;
    a = Utils.startOfDay(a);
    b = Utils.startOfDay(b);
    var sign = 1;
    if (a.getTime() > b.getTime()) {
      var tmp = a; a = b; b = tmp; sign = -1;
    }
    var count = 0;
    var cursor = new Date(a.getTime());
    while (cursor.getTime() <= b.getTime()) {
      if (isWorkingDay(cursor)) count++;
      cursor = _addDays(cursor, 1);
    }
    return count * sign;
  }

  /**
   * Bugundan muddatgacha qolgan ish kunlari (yakuniy kun hisobga olinmaydi).
   * Manfiy qiymat — muddat o'tib ketgan.
   * @param {Date|*} deadline
   * @param {Date} [fromDate] Standart: bugun
   * @returns {number}
   */
  function remainingWorkingDays(deadline, fromDate) {
    var dl = Utils.toDate(deadline);
    if (!dl) return 0;
    var from = Utils.startOfDay(fromDate || new Date());
    dl = Utils.startOfDay(dl);

    if (dl.getTime() === from.getTime()) return 0;

    if (dl.getTime() > from.getTime()) {
      // from (kiritmagan holda) dan dl gacha bo'lgan ish kunlari.
      var count = 0;
      var cursor = _addDays(from, 1);
      while (cursor.getTime() <= dl.getTime()) {
        if (isWorkingDay(cursor)) count++;
        cursor = _addDays(cursor, 1);
      }
      return count;
    }
    // Muddat o'tgan — manfiy.
    var overdue = 0;
    var c2 = _addDays(dl, 1);
    while (c2.getTime() <= from.getTime()) {
      if (isWorkingDay(c2)) overdue++;
      c2 = _addDays(c2, 1);
    }
    return -overdue;
  }

  /**
   * Sanaga kalendar kunlari qo'shadi (ichki yordamchi).
   * @param {Date} d
   * @param {number} days
   * @returns {Date}
   */
  function _addDays(d, days) {
    var nd = new Date(d.getTime());
    nd.setDate(nd.getDate() + days);
    return nd;
  }

  /** HOLIDAYS o'zgargandan keyin keshni tozalash. */
  function invalidate() {
    Cache.remove(HOLIDAY_CACHE_KEY);
  }

  return {
    isWeekend: isWeekend,
    isHoliday: isHoliday,
    isWorkingDay: isWorkingDay,
    nextWorkingDay: nextWorkingDay,
    addWorkingDays: addWorkingDays,
    workingDaysBetween: workingDaysBetween,
    remainingWorkingDays: remainingWorkingDays,
    invalidate: invalidate
  };
})();
