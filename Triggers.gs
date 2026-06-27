/**
 * ============================================================================
 * Triggers.gs — Triggerlarni o'rnatish va davriy vazifalar
 * ----------------------------------------------------------------------------
 *   - installTriggers: o'rnatiladigan triggerlar (kunlik statistika, tozalash)
 *   - dailyMaintenance: har kuni statistikani qayta hisoblash, eski sessiyalarni
 *     tozalash, kunlik snapshot saqlash
 * ============================================================================
 */

/**
 * Barcha kerakli triggerlarni o'rnatadi (administrator bir marta ishga tushiradi).
 * Avval mavjud triggerlarni tozalaydi (dublikat oldini olish).
 */
function installTriggers() {
  removeTriggers();

  // Har kuni soat 06:00 da texnik xizmat.
  ScriptApp.newTrigger('dailyMaintenance')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();

  // Har soatda muddatlarni qayta hisoblash (status o'zgarishi uchun).
  ScriptApp.newTrigger('hourlyDeadlineRefresh')
    .timeBased()
    .everyHours(1)
    .create();

  AppLog.action('SETTINGS_UPDATE', 'system', 'Triggerlar o\'rnatildi');
  return 'Triggerlar muvaffaqiyatli o\'rnatildi.';
}

/**
 * Skript bilan bog'liq barcha triggerlarni o'chiradi.
 */
function removeTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var handler = triggers[i].getHandlerFunction();
    if (handler === 'dailyMaintenance' || handler === 'hourlyDeadlineRefresh') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/**
 * Kunlik texnik xizmat vazifasi.
 */
function dailyMaintenance() {
  try {
    var rows = Dashboard.loadAll();
    if (rows.length > 0) {
      // Bugungi sana bilan muddatlarni qayta hisoblab, DATA'ni yangilaymiz.
      var refreshed = _recalculateDeadlines(rows);
      Repository.writeObjects(SHEETS.DATA, refreshed, DATA_COLUMNS, {
        clearFirst: true, writeHeaders: true
      });
      Cache.flushAll();
      Statistics.rebuild(refreshed);
      Finance.rebuild(refreshed);
      Dashboard.refreshSnapshot(refreshed);
      Statistics.saveMonthlySnapshot(refreshed);
    }
    _cleanupExpiredSessions();
    AppLog.action('SETTINGS_UPDATE', 'system', 'Kunlik texnik xizmat bajarildi');
  } catch (e) {
    Notification.notifyError('dailyMaintenance', e);
  }
}

/**
 * Har soatlik muddat holatini yangilash (faqat status/rang qayta hisoblash).
 */
function hourlyDeadlineRefresh() {
  try {
    var rows = Dashboard.loadAll();
    if (rows.length === 0) return;
    var refreshed = _recalculateDeadlines(rows);
    Repository.writeObjects(SHEETS.DATA, refreshed, DATA_COLUMNS, {
      clearFirst: true, writeHeaders: true
    });
    Cache.flushAll();
    Statistics.rebuild(refreshed);
    Dashboard.refreshSnapshot(refreshed);
  } catch (e) {
    Notification.notifyError('hourlyDeadlineRefresh', e);
  }
}

/**
 * Mavjud yozuvlardagi muddat holati, qolgan kun, SLA va rangни bugungi sanaga
 * ko'ra qayta hisoblaydi (import qilmasdan).
 * @param {Array<Object>} rows
 * @returns {Array<Object>}
 */
function _recalculateDeadlines(rows) {
  var today = new Date();
  return rows.map(function (r) {
    var ctx = {
      status: r.status,
      deadlineDate: Utils.toDate(r.deadlineDate),
      registerDate: Utils.toDate(r.registerDate),
      completeDate: Utils.toDate(r.completeDate)
    };
    var ds = BusinessLogic.computeDeadlineStatus(ctx, today);
    r.deadlineStatus = ds.deadlineStatus;
    r.remainingDays = ds.remainingDays;
    r.colorStatus = ds.colorStatus;
    r.slaPercent = BusinessLogic.computeSla(ctx, today);
    r.progressPercent = BusinessLogic.computeProgress(ctx, today);
    r.updatedAt = Utils.nowIso();
    return r;
  });
}

/**
 * Muddati o'tgan sessiyalarni PropertiesService'dan tozalaydi.
 */
function _cleanupExpiredSessions() {
  try {
    var props = PropertiesService.getScriptProperties();
    var all = props.getProperties();
    var now = Date.now();
    for (var key in all) {
      if (key.indexOf('session::') === 0) {
        try {
          var payload = JSON.parse(all[key]);
          var exp = Utils.toDate(payload.expiresAt);
          if (exp && exp.getTime() < now) {
            props.deleteProperty(key);
          }
        } catch (e) {
          props.deleteProperty(key); // buzilgan yozuvni o'chiramiz
        }
      }
    }
  } catch (e2) {
    Logger.log('_cleanupExpiredSessions xato: ' + e2);
  }
}
