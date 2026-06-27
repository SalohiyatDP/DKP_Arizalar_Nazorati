/**
 * ============================================================================
 * Menu.gs — Spreadsheet menyusi
 * ----------------------------------------------------------------------------
 * Spreadsheet ochilganda "DKP Nazorat" menyusini qo'shadi: import, statistikani
 * yangilash, administrator vositalari va veb-ilovaga havola.
 * ============================================================================
 */

/**
 * Spreadsheet ochilganda avtomatik ishlaydi (simple trigger).
 * @param {Object} [e]
 */
function onOpen(e) {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.createMenu('DKP Nazorat')
      .addItem('📥 Hisobotni import qilish', 'menuRunImport')
      .addItem('🔄 Statistikani yangilash', 'menuRefreshStats')
      .addSeparator()
      .addItem('👤 Administrator yaratish', 'menuSeedAdmin')
      .addItem('🌐 Veb-ilova havolasi', 'menuShowWebAppUrl')
      .addSeparator()
      .addItem('🧹 Keshni tozalash', 'menuClearCache')
      .addItem('ℹ️ Tizim haqida', 'menuAbout')
      .addToUi();
  } catch (err) {
    Logger.log('onOpen xato: ' + err);
  }
}

/**
 * Menyu: import jarayonini ishga tushiradi va natijani ko'rsatadi.
 */
function menuRunImport() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert('Import',
    'HISOBOT varag\'idagi ma\'lumotni import qilishni boshlaysizmi?\n' +
    'Avval joriy DATA zaxiralanadi.', ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;

  var report = Import.run({ actor: Session.getActiveUser().getEmail() });
  Notification.notifyImportComplete(report);

  var msg = report.success
    ? '✅ Import muvaffaqiyatli!\n\n' +
      'Jami: ' + report.totalRows + '\n' +
      'Yaroqli: ' + report.validRows + '\n' +
      'Yaroqsiz: ' + report.invalidRows + '\n' +
      'Davomiyligi: ' + Math.round(report.durationMs / 1000) + ' soniya'
    : '❌ Import xatosi:\n' + report.error + '\n\nDATA zaxiradan tiklandi.';
  ui.alert('Import natijasi', msg, ui.ButtonSet.OK);
}

/**
 * Menyu: statistikani DATA asosida qayta hisoblaydi.
 */
function menuRefreshStats() {
  var ui = SpreadsheetApp.getUi();
  try {
    var rows = Dashboard.loadAll();
    if (rows.length === 0) {
      ui.alert('Ma\'lumot yo\'q', 'DATA varag\'i bo\'sh. Avval import qiling.',
        ui.ButtonSet.OK);
      return;
    }
    Statistics.rebuild(rows);
    Finance.rebuild(rows);
    Dashboard.refreshSnapshot(rows);
    Cache.flushAll();
    ui.alert('Tayyor', 'Statistika va moliya yangilandi (' + rows.length + ' yozuv).',
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Xato', String(e), ui.ButtonSet.OK);
  }
}

/**
 * Menyu: standart administratorni yaratadi.
 */
function menuSeedAdmin() {
  var ui = SpreadsheetApp.getUi();
  var res = Login.seedAdmin();
  if (res.created) {
    ui.alert('Administrator yaratildi',
      'Login: ' + res.username + '\nParol: ' + res.password +
      '\n\nBirinchi kirishda parolni o\'zgartirish majburiy!', ui.ButtonSet.OK);
  } else {
    ui.alert('Mavjud', 'Administrator allaqachon mavjud.', ui.ButtonSet.OK);
  }
}

/**
 * Menyu: veb-ilova URL manzilini ko'rsatadi.
 */
function menuShowWebAppUrl() {
  var ui = SpreadsheetApp.getUi();
  var url = ScriptApp.getService().getUrl();
  ui.alert('Veb-ilova havolasi',
    url || 'Ilova hali joylashtirilmagan (Deploy > New deployment).',
    ui.ButtonSet.OK);
}

/**
 * Menyu: keshni tozalaydi.
 */
function menuClearCache() {
  Cache.flushAll();
  BusinessLogic.invalidate();
  BusinessCalendar.invalidate();
  Config.invalidate();
  SpreadsheetApp.getUi().alert('Kesh tozalandi.');
}

/**
 * Menyu: tizim haqida ma'lumot.
 */
function menuAbout() {
  var cfg = Config.get();
  SpreadsheetApp.getUi().alert(cfg.appName,
    cfg.organization + '\nVersiya: ' + cfg.version +
    '\nEnterprise Analytics Platform', SpreadsheetApp.getUi().ButtonSet.OK);
}
