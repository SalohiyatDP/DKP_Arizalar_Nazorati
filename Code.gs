/**
 * ============================================================================
 * Code.gs — Veb-ilova kirish nuqtasi (doGet) va Server API
 * ----------------------------------------------------------------------------
 *   - doGet: HTML sahifani server tomonida render qiladi (layout + sahifa)
 *   - include: HTML bo'laklarini birlashtiradi
 *   - api*: mijoz (google.script.run) chaqiradigan funksiyalar
 *
 * BARCHA api* funksiyalari sessiya tokenini tekshiradi, holatni o'zgartiruvchi
 * amallar qo'shimcha CSRF tekshiruvidan o'tadi. Frontend'ga ishonilmaydi.
 * ============================================================================
 */

/**
 * HTML faylni stringga aylantiradi (qisman shablonlarni qo'shish uchun).
 * @param {string} filename
 * @returns {string}
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Veb-ilovaning GET kirish nuqtasi.
 * @param {Object} e So'rov parametrlari
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  try {
    // Birinchi ishga tushirishda administratorni ta'minlaymiz.
    Login.seedAdmin();

    var params = (e && e.parameter) || {};
    var page = params.page || 'dashboard';
    var template = HtmlService.createTemplateFromFile('layout');

    var cfg = Config.get();
    template.appName = cfg.appName;
    template.organization = cfg.organization;
    template.version = cfg.version;
    template.page = _safePage(page);
    template.darkModeDefault = cfg.darkModeDefault === true;

    var out = template.evaluate()
      .setTitle(cfg.appName)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    return out;
  } catch (err) {
    AppLog.error('doGet', err);
    var errTmpl = HtmlService.createTemplateFromFile('error');
    errTmpl.message = String(err && err.message ? err.message : err);
    return errTmpl.evaluate().setTitle('Xato');
  }
}

/**
 * Ruxsat etilgan sahifalar ro'yxati (open redirect/XSS oldini olish).
 * @param {string} page
 * @returns {string}
 */
function _safePage(page) {
  var allowed = ['dashboard', 'login', 'profile', 'changePassword'];
  return allowed.indexOf(page) !== -1 ? page : 'dashboard';
}

/* ========================================================================== */
/*                              API YORDAMCHILARI                             */
/* ========================================================================== */

/**
 * Standart muvaffaqiyatli javob.
 * @param {*} data
 * @returns {Object}
 */
function _ok(data) {
  return { ok: true, data: data === undefined ? null : data };
}

/**
 * Standart xato javobi.
 * @param {string} message
 * @param {string} [code]
 * @returns {Object}
 */
function _err(message, code) {
  return { ok: false, error: message, code: code || 'ERROR' };
}

/**
 * Sessiyani tekshiradi va foydalanuvchini qaytaradi, aks holda xato tashlaydi.
 * @param {string} token
 * @returns {Object} session user
 */
function _auth(token) {
  var session = Security.validateSession(token);
  if (!session) {
    throw new Error('AUTH: Sessiya tugagan yoki yaroqsiz. Qaytadan kiring.');
  }
  return session;
}

/**
 * Holatni o'zgartiruvchi amallar uchun CSRF tekshiruvi.
 * @param {Object} session
 * @param {string} csrf
 */
function _csrf(session, csrf) {
  if (!Security.verifyCsrf(session, csrf)) {
    throw new Error('CSRF: Xavfsizlik tokeni mos kelmadi.');
  }
}

/**
 * API funksiyalarini xato bilan o'rab ishlatuvchi yordamchi.
 * @param {function} fn
 * @returns {Object}
 */
function _guard(fn) {
  try {
    return _ok(fn());
  } catch (err) {
    var msg = String(err && err.message ? err.message : err);
    if (msg.indexOf('AUTH:') === 0) return _err(msg.substring(5).trim(), 'AUTH');
    if (msg.indexOf('CSRF:') === 0) return _err(msg.substring(5).trim(), 'CSRF');
    AppLog.error('API', err);
    return _err(msg);
  }
}

/* ========================================================================== */
/*                            AUTENTIFIKATSIYA API                            */
/* ========================================================================== */

/**
 * Login API.
 * @param {Object} payload {username, password, rememberMe}
 * @returns {Object}
 */
function apiLogin(payload) {
  return _guard(function () {
    var result = Login.authenticate(payload || {});
    if (!result.ok) throw new Error(result.error);
    return {
      token: result.session.token,
      csrf: result.session.csrf,
      expiresAt: result.session.expiresAt,
      user: result.user,
      mustChangePassword: result.mustChangePassword
    };
  });
}

/**
 * Logout API.
 * @param {string} token
 * @returns {Object}
 */
function apiLogout(token) {
  return _guard(function () {
    var session = Security.validateSession(token);
    Login.logout(token, session ? session.username : null);
    return true;
  });
}

/**
 * Joriy foydalanuvchi profilini qaytaradi.
 * @param {string} token
 * @returns {Object}
 */
function apiGetProfile(token) {
  return _guard(function () {
    var session = _auth(token);
    return {
      username: session.username,
      fullName: session.fullName,
      role: session.role,
      roleLabel: ROLE_LABEL[session.role] || session.role,
      region: session.region,
      district: session.district,
      employeeId: session.employeeId,
      permissions: Security.permissionsOf(session)
    };
  });
}

/**
 * Parolni o'zgartirish API.
 * @param {string} token
 * @param {string} csrf
 * @param {Object} payload {oldPassword, newPassword, confirmPassword}
 * @returns {Object}
 */
function apiChangePassword(token, csrf, payload) {
  return _guard(function () {
    var session = _auth(token);
    _csrf(session, csrf);
    var result = Login.changePassword(session, payload || {});
    if (!result.ok) throw new Error(result.error);
    return true;
  });
}

/* ========================================================================== */
/*                              DASHBOARD API                                 */
/* ========================================================================== */

/**
 * Dashboard ma'lumotlarini qaytaradi.
 * @param {string} token
 * @param {Object} [filters]
 * @returns {Object}
 */
function apiGetDashboard(token, filters) {
  return _guard(function () {
    var session = _auth(token);
    Security.require(session, PERMISSIONS.VIEW_DASHBOARD);
    return Dashboard.getDashboard(session, filters || {});
  });
}

/**
 * Sahifalangan jadval ma'lumotini qaytaradi.
 * @param {string} token
 * @param {Object} filters
 * @returns {Object}
 */
function apiQueryTable(token, filters) {
  return _guard(function () {
    var session = _auth(token);
    Security.require(session, PERMISSIONS.VIEW_DASHBOARD);
    return Dashboard.queryTable(session, filters || {});
  });
}

/**
 * Tezkor qidiruv.
 * @param {string} token
 * @param {string} term
 * @returns {Object}
 */
function apiSearch(token, term) {
  return _guard(function () {
    var session = _auth(token);
    return Dashboard.search(session, term, 30);
  });
}

/**
 * Kaskad filtr variantlarini qaytaradi.
 * @param {string} token
 * @returns {Object}
 */
function apiFilterOptions(token) {
  return _guard(function () {
    var session = _auth(token);
    return Dashboard.filterOptions(session);
  });
}

/**
 * Foydalanuvchi bildirishnomalarini qaytaradi.
 * @param {string} token
 * @returns {Object}
 */
function apiGetNotifications(token) {
  return _guard(function () {
    var session = _auth(token);
    return Notification.forUser(session);
  });
}

/* ========================================================================== */
/*                                 IMPORT API                                 */
/* ========================================================================== */

/**
 * Importni ishga tushiradi (faqat RUN_IMPORT ruxsati bilan).
 * @param {string} token
 * @param {string} csrf
 * @returns {Object}
 */
function apiRunImport(token, csrf) {
  return _guard(function () {
    var session = _auth(token);
    _csrf(session, csrf);
    Security.require(session, PERMISSIONS.RUN_IMPORT);
    var report = Import.run({ actor: session.username });
    Notification.notifyImportComplete(report);
    return report;
  });
}

/**
 * So'nggi import ma'lumotini qaytaradi.
 * @param {string} token
 * @returns {Object}
 */
function apiLastImport(token) {
  return _guard(function () {
    _auth(token);
    return Import.lastImportInfo();
  });
}

/**
 * Yuklangan fayldan (xlsx/xls/csv) to'g'ridan-to'g'ri import qiladi.
 * @param {string} token
 * @param {string} csrf
 * @param {Object} payload {base64, fileName, mimeType}
 * @returns {Object}
 */
function apiImportFile(token, csrf, payload) {
  return _guard(function () {
    var session = _auth(token);
    _csrf(session, csrf);
    Security.require(session, PERMISSIONS.RUN_IMPORT);
    payload = payload || {};
    var report = Import.importFromFile({
      base64: payload.base64,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      actor: session.username
    });
    Notification.notifyImportComplete(report);
    return report;
  });
}

/* ========================================================================== */
/*                                 EKSPORT API                                */
/* ========================================================================== */

/**
 * Filtrlangan ma'lumotni eksport qiladi (base64 qaytaradi).
 * @param {string} token
 * @param {string} csrf
 * @param {Object} filters
 * @param {string} format 'csv'|'xlsx'|'pdf'
 * @returns {Object}
 */
function apiExport(token, csrf, filters, format) {
  return _guard(function () {
    var session = _auth(token);
    _csrf(session, csrf);
    Security.require(session, PERMISSIONS.RUN_EXPORT);
    var result = Export.run(session, filters || {}, format || 'csv');
    if (!result.ok) throw new Error(result.error);
    return result;
  });
}

/**
 * Chop etish uchun HTML jadval qaytaradi.
 * @param {string} token
 * @param {Object} filters
 * @returns {Object}
 */
function apiPrint(token, filters) {
  return _guard(function () {
    var session = _auth(token);
    Security.require(session, PERMISSIONS.RUN_EXPORT);
    var result = Export.buildPrintHtml(session, filters || {});
    if (!result.ok) throw new Error(result.error);
    return result;
  });
}

/* ========================================================================== */
/*                                 HISOBOTLAR API                             */
/* ========================================================================== */

/**
 * Tayyor hisobotni qaytaradi.
 * @param {string} token
 * @param {string} reportType
 * @param {Object} [filters]
 * @returns {Object}
 */
function apiGetReport(token, reportType, filters) {
  return _guard(function () {
    var session = _auth(token);
    Security.require(session, PERMISSIONS.VIEW_REPORTS);
    return Reports.generate(session, reportType, filters || {});
  });
}

/**
 * Tarixiy oylik snapshotlarni qaytaradi (taqqoslash uchun).
 * @param {string} token
 * @returns {Object}
 */
function apiGetHistory(token) {
  return _guard(function () {
    var session = _auth(token);
    Security.require(session, PERMISSIONS.VIEW_REPORTS);
    return Statistics.getHistory();
  });
}

/* ========================================================================== */
/*                       ADMINISTRATOR / FOYDALANUVCHILAR                     */
/* ========================================================================== */

/**
 * Foydalanuvchilar ro'yxati (admin).
 * @param {string} token
 * @returns {Object}
 */
function apiListUsers(token) {
  return _guard(function () {
    var session = _auth(token);
    return Login.listUsers(session);
  });
}

/**
 * Yangi foydalanuvchi yaratish (admin).
 * @param {string} token
 * @param {string} csrf
 * @param {Object} userData
 * @returns {Object}
 */
function apiCreateUser(token, csrf, userData) {
  return _guard(function () {
    var session = _auth(token);
    _csrf(session, csrf);
    var result = Login.createUser(session, userData || {});
    if (!result.ok) throw new Error(result.error);
    return result;
  });
}

/**
 * Foydalanuvchini yangilash (admin).
 * @param {string} token
 * @param {string} csrf
 * @param {string} username
 * @param {Object} updates
 * @returns {Object}
 */
function apiUpdateUser(token, csrf, username, updates) {
  return _guard(function () {
    var session = _auth(token);
    _csrf(session, csrf);
    var result = Login.updateUser(session, username, updates || {});
    if (!result.ok) throw new Error(result.error);
    return true;
  });
}

/**
 * Parolni tiklash (admin).
 * @param {string} token
 * @param {string} csrf
 * @param {string} username
 * @returns {Object}
 */
function apiResetPassword(token, csrf, username) {
  return _guard(function () {
    var session = _auth(token);
    _csrf(session, csrf);
    var result = Login.resetPassword(session, username);
    if (!result.ok) throw new Error(result.error);
    return result;
  });
}

/**
 * Audit loglarini qaytaradi (admin).
 * @param {string} token
 * @param {string} logType 'action'|'login'|'import'|'export'
 * @param {number} [limit]
 * @returns {Object}
 */
function apiGetLogs(token, logType, limit) {
  return _guard(function () {
    var session = _auth(token);
    Security.require(session, PERMISSIONS.VIEW_LOGS);
    var map = {
      action: SHEETS.ACTION_LOG,
      login: SHEETS.LOGIN_LOG,
      import: SHEETS.IMPORT_LOG,
      export: SHEETS.EXPORT
    };
    var sheetName = map[logType] || SHEETS.ACTION_LOG;
    return AppLog.read(sheetName, limit || 100);
  });
}

/**
 * Tizim sozlamalarini qaytaradi (admin).
 * @param {string} token
 * @returns {Object}
 */
function apiGetSettings(token) {
  return _guard(function () {
    var session = _auth(token);
    Security.require(session, PERMISSIONS.MANAGE_SETTINGS);
    return Config.get(true);
  });
}
