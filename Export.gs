/**
 * ============================================================================
 * Export.gs — Eksport dvigateli (faqat filtrlangan ma'lumot)
 * ----------------------------------------------------------------------------
 * Formatlar: CSV, Excel (xlsx), PDF, Chop etish (HTML).
 * Faqat foydalanuvchi ko'ra oladigan va filtrlangan yozuvlar eksport qilinadi.
 * Format, ranglar, sarlavha va son formati saqlanadi.
 * Katta hajmlar uchun chunk yozuv va vaqtinchalik fayl ishlatiladi.
 * ============================================================================
 */

var Export = (function () {

  /** Eksport uchun ustunlar va sarlavhalar (o'zbekcha). */
  var EXPORT_HEADERS = [
    { key: 'transactionNo', label: 'Tranzaksiya raqami' },
    { key: 'applicationNo', label: 'Ariza raqami' },
    { key: 'cadastreNo', label: 'Kadastr raqami' },
    { key: 'customer', label: 'Mijoz' },
    { key: 'tin', label: 'STIR' },
    { key: 'district', label: 'Tuman' },
    { key: 'engineer', label: 'Muhandis' },
    { key: 'registrator', label: 'Registrator' },
    { key: 'applicationType', label: 'Ariza turi' },
    { key: 'objectType', label: 'Obyekt turi' },
    { key: 'residencyLabel', label: 'Turar/Noturar' },
    { key: 'registerDate', label: 'Qabul sanasi' },
    { key: 'issuedDate', label: 'To\'lovga chiqarilgan sana' },
    { key: 'deadlineDate', label: 'Muddat' },
    { key: 'completeDate', label: 'Bajarilgan sana' },
    { key: 'deadlineStatusLabel', label: 'Muddat holati' },
    { key: 'remainingDays', label: 'Qolgan kun' },
    { key: 'amount', label: 'Summa' },
    { key: 'paidAmount', label: 'To\'langan' },
    { key: 'debtAmount', label: 'Qarz' },
    { key: 'paymentStatusLabel', label: 'To\'lov holati' }
  ];

  /**
   * Filtrlangan yozuvlarni tayyorlaydi (display formatda).
   * @param {Object} user
   * @param {Object} rawFilters
   * @returns {Array<Object>}
   */
  function _prepareRows(user, rawFilters) {
    Security.require(user, PERMISSIONS.RUN_EXPORT);
    var filters = Validation.sanitizeFilters(rawFilters || {});
    filters.page = 1;
    filters.pageSize = Config.value('exportMaxRows', 100000);
    var rows = Dashboard.scopedRows(user, filters);
    var max = Config.value('exportMaxRows', 100000);
    if (rows.length > max) rows = rows.slice(0, max);
    return rows;
  }

  /**
   * Yozuvni eksport ustunlari bo'yicha massivga aylantiradi.
   * @param {Object} r DATA yozuvi
   * @returns {Array}
   */
  function _rowToArray(r) {
    var out = [];
    for (var i = 0; i < EXPORT_HEADERS.length; i++) {
      var key = EXPORT_HEADERS[i].key;
      switch (key) {
        case 'registerDate':
        case 'deadlineDate':
        case 'completeDate':
        case 'issuedDate':
          out.push(Utils.formatDate(r[key])); break;
        case 'residencyLabel':
          out.push(RESIDENCY_LABEL[r.residency] || ''); break;
        case 'deadlineStatusLabel':
          out.push(DEADLINE_STATUS_LABEL[r.deadlineStatus] || ''); break;
        case 'paymentStatusLabel':
          out.push(PAYMENT_STATUS_LABEL[r.paymentStatus] || ''); break;
        default:
          out.push(r[key] != null ? r[key] : '');
      }
    }
    return out;
  }

  /**
   * CSV matnini quradi.
   * @param {Array<Object>} rows
   * @returns {string}
   */
  function _buildCsv(rows) {
    var lines = [];
    lines.push(EXPORT_HEADERS.map(function (h) { return _csvCell(h.label); }).join(','));
    for (var i = 0; i < rows.length; i++) {
      var arr = _rowToArray(rows[i]);
      lines.push(arr.map(_csvCell).join(','));
    }
    return '\uFEFF' + lines.join('\r\n'); // BOM — Excel UTF-8 uchun
  }

  /**
   * CSV katakchasini ekranlaydi.
   * @param {*} v
   * @returns {string}
   */
  function _csvCell(v) {
    var s = Utils.str(v);
    if (/[",\r\n;]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  /**
   * Vaqtinchalik spreadsheet yaratib, eksport blobini oladi (xlsx/pdf).
   * @param {Array<Object>} rows
   * @param {string} format 'xlsx' | 'pdf'
   * @param {string} title
   * @returns {GoogleAppsScript.Base.Blob}
   */
  function _exportViaTemp(rows, format, title) {
    var tempSs = SpreadsheetApp.create('DKP_export_' + Date.now());
    var fileId = tempSs.getId();
    try {
      var sheet = tempSs.getSheets()[0];
      sheet.setName('Export');

      // Sarlavha qatori.
      var header = EXPORT_HEADERS.map(function (h) { return h.label; });
      var matrix = [header];
      for (var i = 0; i < rows.length; i++) {
        matrix.push(_rowToArray(rows[i]));
      }

      var chunkSize = Config.value('exportBatchSize', 2000);
      var chunks = Utils.chunk(matrix, chunkSize);
      var cursor = 1;
      for (var c = 0; c < chunks.length; c++) {
        sheet.getRange(cursor, 1, chunks[c].length, header.length)
          .setValues(chunks[c]);
        cursor += chunks[c].length;
      }

      // Formatlash: sarlavha qalin, ranglangan, ustun kengligi, freeze.
      var headerRange = sheet.getRange(1, 1, 1, header.length);
      headerRange.setFontWeight('bold')
        .setBackground('#1a73e8').setFontColor('#ffffff')
        .setHorizontalAlignment('center');
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, matrix.length, header.length)
        .setBorder(true, true, true, true, true, true);
      for (var w = 1; w <= header.length; w++) sheet.autoResizeColumn(w);
      SpreadsheetApp.flush();

      var blob;
      if (format === 'pdf') {
        blob = _fetchExport(fileId, 'application/pdf', tempSs.getSheets()[0].getSheetId());
        blob.setName(title + '.pdf');
      } else {
        blob = _fetchExport(fileId,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null);
        blob.setName(title + '.xlsx');
      }
      return blob;
    } finally {
      try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* ignore */ }
    }
  }

  /**
   * Drive export URL orqali blob oladi.
   * @param {string} fileId
   * @param {string} mimeType
   * @param {number} [gid]
   * @returns {GoogleAppsScript.Base.Blob}
   */
  function _fetchExport(fileId, mimeType, gid) {
    var token = ScriptApp.getOAuthToken();
    var url;
    if (mimeType === 'application/pdf') {
      url = 'https://docs.google.com/spreadsheets/d/' + fileId +
        '/export?format=pdf&size=A4&portrait=false&fitw=true&gridlines=true' +
        '&top_margin=0.4&bottom_margin=0.4&left_margin=0.4&right_margin=0.4';
      if (gid != null) url += '&gid=' + gid;
    } else {
      url = 'https://docs.google.com/spreadsheets/d/' + fileId + '/export?format=xlsx';
    }
    var resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      throw new Error('Eksport faylini olishda xato (HTTP ' + resp.getResponseCode() + ')');
    }
    return resp.getBlob();
  }

  /**
   * Asosiy eksport amali. Natijani base64 sifatida qaytaradi (mijoz yuklab oladi).
   * @param {Object} user Sessiya foydalanuvchisi
   * @param {Object} rawFilters
   * @param {string} format 'csv' | 'xlsx' | 'pdf'
   * @returns {{ok: boolean, fileName?: string, mimeType?: string, base64?: string, rows?: number, error?: string}}
   */
  function run(user, rawFilters, format) {
    format = (format || 'csv').toLowerCase();
    var t0 = Date.now();
    try {
      var rows = _prepareRows(user, rawFilters);
      var stamp = Utilities.formatDate(new Date(),
        Config.value('timeZone', 'Asia/Tashkent'), 'yyyyMMdd_HHmmss');
      var title = 'DKP_Arizalar_' + stamp;

      var result;
      if (format === 'csv') {
        var csv = _buildCsv(rows);
        result = {
          fileName: title + '.csv',
          mimeType: 'text/csv;charset=utf-8',
          base64: Utilities.base64Encode(csv, Utilities.Charset.UTF_8)
        };
      } else if (format === 'pdf') {
        var pdfBlob = _exportViaTemp(rows, 'pdf', title);
        result = {
          fileName: pdfBlob.getName(),
          mimeType: 'application/pdf',
          base64: Utilities.base64Encode(pdfBlob.getBytes())
        };
      } else {
        var xlsxBlob = _exportViaTemp(rows, 'xlsx', title);
        result = {
          fileName: xlsxBlob.getName(),
          mimeType: xlsxBlob.getContentType(),
          base64: Utilities.base64Encode(xlsxBlob.getBytes())
        };
      }

      _writeExportLog(user, format, rows.length, Date.now() - t0, 'SUCCESS', '');
      AppLog.action(ACTION_TYPE.EXPORT, user.username,
        format.toUpperCase() + ' eksport: ' + rows.length + ' qator');

      return {
        ok: true,
        fileName: result.fileName,
        mimeType: result.mimeType,
        base64: result.base64,
        rows: rows.length
      };
    } catch (err) {
      _writeExportLog(user, format, 0, Date.now() - t0, 'FAILED',
        String(err && err.message ? err.message : err));
      Notification.notifyError('Export.run', err);
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }

  /**
   * Chop etish uchun HTML jadval generatsiya qiladi.
   * @param {Object} user
   * @param {Object} rawFilters
   * @returns {{ok: boolean, html?: string, rows?: number, error?: string}}
   */
  function buildPrintHtml(user, rawFilters) {
    try {
      var rows = _prepareRows(user, rawFilters);
      var html = ['<table class="print-table"><thead><tr>'];
      for (var h = 0; h < EXPORT_HEADERS.length; h++) {
        html.push('<th>' + Utils.escapeHtml(EXPORT_HEADERS[h].label) + '</th>');
      }
      html.push('</tr></thead><tbody>');
      for (var i = 0; i < rows.length; i++) {
        var arr = _rowToArray(rows[i]);
        html.push('<tr>');
        for (var j = 0; j < arr.length; j++) {
          html.push('<td>' + Utils.escapeHtml(arr[j]) + '</td>');
        }
        html.push('</tr>');
      }
      html.push('</tbody></table>');
      return { ok: true, html: html.join(''), rows: rows.length };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }

  /**
   * EXPORT_LOG varag'iga yozuv qo'shadi.
   */
  function _writeExportLog(user, format, rowCount, durationMs, status, error) {
    try {
      if (!Repository.exists(SHEETS.EXPORT)) {
        var sh = Repository.ss().insertSheet(SHEETS.EXPORT);
        sh.getRange(1, 1, 1, 7).setValues([[
          'SANA', 'FOYDALANUVCHI', 'FORMAT', 'QATORLAR', 'DAVOMIYLIK_MS', 'HOLAT', 'XATO'
        ]]);
      }
      Repository.appendRow(SHEETS.EXPORT, [
        Utils.formatDateTime(new Date()),
        (user && user.username) || 'system',
        format, rowCount, durationMs, status, error
      ]);
    } catch (e) {
      Logger.log('Export._writeExportLog xato: ' + e);
    }
  }

  return {
    run: run,
    buildPrintHtml: buildPrintHtml
  };
})();
