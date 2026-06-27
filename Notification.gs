/**
 * ============================================================================
 * Notification.gs — Loglash (AppLog) va bildirishnomalar tizimi
 * ----------------------------------------------------------------------------
 * AppLog: ACTION_LOG, LOGIN_LOG varaqlariga audit yozuvlari.
 * Notification: muddati o'tgan, bugun tugaydigan, to'lov kutilayotgan arizalar
 *               va tizim hodisalari bo'yicha bildirishnomalar (UI + email).
 * ============================================================================
 */

/**
 * Markaziy audit loglash moduli (global — barcha modullar ishlatadi).
 */
var AppLog = (function () {

  /**
   * Joriy ijrochi (email yoki tizim).
   * @returns {string}
   */
  function _whoami() {
    try {
      return Session.getActiveUser().getEmail() || 'system';
    } catch (e) {
      return 'system';
    }
  }

  /**
   * ACTION_LOG varag'iga yozuv qo'shadi.
   * @param {string} type ACTION_TYPE
   * @param {string} [actor]
   * @param {string} [detail]
   */
  function action(type, actor, detail) {
    _safeAppend(SHEETS.ACTION_LOG, [
      Utils.formatDateTime(new Date()),
      LOG_LEVEL.INFO,
      type || '',
      actor || _whoami(),
      detail || ''
    ]);
  }

  /**
   * Xavfsizlik hodisasini qayd qiladi.
   * @param {string} event
   * @param {string} [actor]
   * @param {string} [detail]
   */
  function security(event, actor, detail) {
    _safeAppend(SHEETS.ACTION_LOG, [
      Utils.formatDateTime(new Date()),
      LOG_LEVEL.SECURITY,
      event || '',
      actor || _whoami(),
      detail || ''
    ]);
  }

  /**
   * Xatoni qayd qiladi.
   * @param {string} context
   * @param {*} err
   */
  function error(context, err) {
    var msg = err && err.message ? err.message : String(err);
    _safeAppend(SHEETS.ACTION_LOG, [
      Utils.formatDateTime(new Date()),
      LOG_LEVEL.ERROR,
      ACTION_TYPE.ERROR,
      _whoami(),
      context + ': ' + msg
    ]);
    Logger.log('[XATO] ' + context + ': ' + msg);
  }

  /**
   * LOGIN_LOG varag'iga kirish yozuvini qo'shadi.
   * @param {string} username
   * @param {boolean} success
   * @param {string} [role]
   */
  function login(username, success, role) {
    _safeAppend(SHEETS.LOGIN_LOG, [
      Utils.formatDateTime(new Date()),
      username || '',
      success ? 'SUCCESS' : 'FAILED',
      role || '',
      _whoami()
    ]);
  }

  /**
   * Varaq sarlavhalarini ta'minlab, qator qo'shadi.
   * @param {string} sheetName
   * @param {Array} row
   */
  function _safeAppend(sheetName, row) {
    try {
      if (!Repository.exists(sheetName)) {
        var sh = Repository.ss().insertSheet(sheetName);
        var headers = _headersFor(sheetName);
        if (headers) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      }
      Repository.appendRow(sheetName, row);
    } catch (e) {
      Logger.log('AppLog._safeAppend xato (' + sheetName + '): ' + e);
    }
  }

  /**
   * Log varaqlari uchun standart sarlavhalar.
   * @param {string} sheetName
   * @returns {Array<string>|null}
   */
  function _headersFor(sheetName) {
    if (sheetName === SHEETS.ACTION_LOG) {
      return ['SANA', 'DARAJA', 'AMAL', 'FOYDALANUVCHI', 'TAFSILOT'];
    }
    if (sheetName === SHEETS.LOGIN_LOG) {
      return ['SANA', 'FOYDALANUVCHI', 'NATIJA', 'ROL', 'EMAIL'];
    }
    return null;
  }

  /**
   * Log yozuvlarini o'qiydi (eng yangilari birinchi).
   * @param {string} sheetName
   * @param {number} [limit]
   * @returns {Array<Object>}
   */
  function read(sheetName, limit) {
    if (!Repository.exists(sheetName)) return [];
    var parsed = Repository.readObjects(sheetName);
    var rows = parsed.rows.slice().reverse();
    return limit ? rows.slice(0, limit) : rows;
  }

  return {
    action: action,
    security: security,
    error: error,
    login: login,
    read: read
  };
})();


/**
 * Bildirishnomalar moduli.
 */
var Notification = (function () {

  /**
   * Foydalanuvchi uchun dolzarb bildirishnomalarni hisoblaydi.
   * @param {Object} user
   * @returns {Array<Object>}
   */
  function forUser(user) {
    var rows = Dashboard.scopeFor(user, Dashboard.loadAll());
    var expired = 0, dueToday = 0, soon = 0, waitingPay = 0, waitingAmount = 0;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      switch (r.deadlineStatus) {
        case DEADLINE_STATUS.EXPIRED: expired++; break;
        case DEADLINE_STATUS.DUE_TODAY: dueToday++; break;
        case DEADLINE_STATUS.ONE_DAY:
        case DEADLINE_STATUS.TWO_DAYS:
        case DEADLINE_STATUS.THREE_DAYS: soon++; break;
      }
      if (r.paymentStatus === PAYMENT_STATUS.WAITING ||
          r.paymentStatus === PAYMENT_STATUS.PARTIAL) {
        waitingPay++;
        waitingAmount += Utils.toNumber(r.debtAmount);
      }
    }

    var list = [];
    if (expired > 0) {
      list.push(_n('danger', 'Muddati o\'tgan arizalar',
        expired + ' ta ariza muddati o\'tib ketgan', 'warning'));
    }
    if (dueToday > 0) {
      list.push(_n('danger', 'Bugun tugaydigan arizalar',
        dueToday + ' ta ariza bugun yakunlanishi kerak', 'today'));
    }
    if (soon > 0) {
      list.push(_n('warning', 'Muddati yaqinlashmoqda',
        soon + ' ta ariza 1-3 kun ichida tugaydi', 'schedule'));
    }
    if (waitingPay > 0) {
      list.push(_n('info', 'To\'lov kutilmoqda',
        waitingPay + ' ta ariza, jami ' + Utils.formatMoney(waitingAmount, true),
        'payments'));
    }
    return list;
  }

  /**
   * Bildirishnoma obyektini quradi.
   * @param {string} level
   * @param {string} title
   * @param {string} message
   * @param {string} icon
   * @returns {Object}
   */
  function _n(level, title, message, icon) {
    return {
      level: level, title: title, message: message, icon: icon,
      at: Utils.formatDateTime(new Date())
    };
  }

  /**
   * Import yakunlanishi haqida administratorlarga email yuboradi (yoqilgan bo'lsa).
   * @param {Object} report Import hisoboti
   */
  function notifyImportComplete(report) {
    if (!Config.value('notifyEmailEnabled', false)) return;
    var to = Config.value('notifyAdminEmail', '');
    if (!to) return;
    try {
      var subject = '[DKP] Import ' + (report.success ? 'yakunlandi' : 'XATO');
      var body =
        'Import partiyasi: ' + report.batchId + '\n' +
        'Holat: ' + (report.success ? 'Muvaffaqiyatli' : 'Xato') + '\n' +
        'Jami qatorlar: ' + report.totalRows + '\n' +
        'Yaroqli: ' + report.validRows + '\n' +
        'Yaroqsiz: ' + report.invalidRows + '\n' +
        'Davomiyligi: ' + Math.round(report.durationMs / 1000) + ' soniya\n' +
        (report.error ? ('Xato: ' + report.error + '\n') : '');
      MailApp.sendEmail(to, subject, body);
    } catch (e) {
      AppLog.error('Notification.notifyImportComplete', e);
    }
  }

  /**
   * Tizim xatosi haqida bildirishnoma (log + email).
   * @param {string} context
   * @param {*} err
   */
  function notifyError(context, err) {
    AppLog.error(context, err);
    if (Config.value('notifyEmailEnabled', false)) {
      var to = Config.value('notifyAdminEmail', '');
      if (to) {
        try {
          MailApp.sendEmail(to, '[DKP] Tizim xatosi: ' + context,
            String(err && err.message ? err.message : err));
        } catch (e) { /* ignore */ }
      }
    }
  }

  return {
    forUser: forUser,
    notifyImportComplete: notifyImportComplete,
    notifyError: notifyError
  };
})();
