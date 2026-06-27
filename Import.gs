/**
 * ============================================================================
 * Import.gs — Bir tugmali (One-Click) import dvigateli
 * ----------------------------------------------------------------------------
 * Ish oqimi:
 *   Backup -> Import (HISOBOT) -> Validate -> Transform -> Business Logic ->
 *   Statistics -> Finance -> Cache -> Dashboard -> Logs -> Done
 *
 * Rollback qo'llab-quvvatlanadi: xato bo'lsa, BACKUP'dan DATA tiklanadi.
 * 100 000+ qator uchun chunk yozuv va minimal sheet kirishlari.
 * ============================================================================
 */

var Import = (function () {

  /**
   * Import jarayonining holatini saqlovchi obyekt.
   * @returns {Object}
   */
  function _newReport() {
    return {
      batchId: 'IMP-' + Utilities.formatDate(new Date(),
        Config.value('timeZone', 'Asia/Tashkent'), 'yyyyMMdd-HHmmss'),
      startedAt: Utils.nowIso(),
      finishedAt: null,
      steps: [],
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      warnings: [],
      success: false,
      error: null,
      durationMs: 0
    };
  }

  /**
   * Bosqich natijasini hisobotga qo'shadi.
   * @param {Object} report
   * @param {string} name
   * @param {string} status
   * @param {string} [detail]
   */
  function _step(report, name, status, detail) {
    report.steps.push({
      name: name, status: status, detail: detail || '',
      at: Utils.nowIso()
    });
  }

  /**
   * To'liq import jarayonini ishga tushiradi.
   * @param {Object} [opts] {sessionToken, actor}
   * @returns {Object} Import hisoboti
   */
  function run(opts) {
    opts = opts || {};
    var lock = LockService.getScriptLock();
    var report = _newReport();
    var t0 = Date.now();

    // Bir vaqtning o'zida bitta import (concurrency himoyasi).
    try {
      lock.waitLock(15000);
    } catch (e) {
      report.error = 'Avvalgi import hali tugamagan (katta fayl bo\'lishi mumkin). ' +
        'Iltimos 1-2 daqiqa kuting, so\'ng sahifani yangilab Dashboard\'ni tekshiring. ' +
        'Agar takrorlansa, 5 daqiqadan keyin qayta urinib ko\'ring.';
      _step(report, 'Lock', 'ERROR', report.error);
      return report;
    }

    try {
      // 1. BACKUP
      _step(report, 'Backup', 'RUNNING');
      var backup = _backupData();
      _step(report, 'Backup', 'OK', backup.rows + ' qator zaxiralandi');

      // 2. IMPORT (HISOBOT o'qish)
      _step(report, 'Import', 'RUNNING');
      var parsed = Repository.readObjects(SHEETS.HISOBOT, Repository.hisobotHeaderMapper);
      report.totalRows = parsed.rows.length;
      _step(report, 'Import', 'OK', report.totalRows + ' qator o\'qildi');

      if (report.totalRows === 0) {
        throw new Error('HISOBOT varag\'i bo\'sh. Import qilish uchun ma\'lumot yo\'q.');
      }
      if (report.totalRows > Config.value('maxImportRows', 200000)) {
        throw new Error('Qatorlar soni ruxsat etilgan chegaradan oshib ketdi: ' +
          report.totalRows);
      }

      // 3. VALIDATE (yumshoq rejim — qatorlar rad etilmaydi, faqat ogohlantiriladi)
      _step(report, 'Validate', 'RUNNING');
      var mapping = Repository.hisobotHeaderMapper(parsed.headers);
      var headerCheck = Validation.validateImportHeaders(mapping);
      if (!headerCheck.ok && report.warnings.length < 50) {
        report.warnings.push('Sarlavha ogohlantirishi: ' + headerCheck.errors.join('; '));
      }
      // Diagnostika: qaysi ustun qaysi maydonga bog'landi.
      report.detectedColumns = [];
      report.unmappedHeaders = [];
      for (var hc = 0; hc < parsed.headers.length; hc++) {
        if (mapping[hc]) {
          report.detectedColumns.push(Utils.str(parsed.headers[hc]) + ' → ' + mapping[hc]);
        } else if (Utils.str(parsed.headers[hc])) {
          report.unmappedHeaders.push(Utils.str(parsed.headers[hc]));
        }
      }
      // Barcha bo'sh bo'lmagan qatorlarni saqlaymiz — ma'lumot yo'qolmasin.
      var validRows = parsed.rows;
      for (var i = 0; i < parsed.rows.length; i++) {
        var check = Validation.validateImportRow(parsed.rows[i]);
        if (!check.ok) {
          report.invalidRows++;
          if (report.warnings.length < 50) {
            report.warnings.push('Qator ' + parsed.rows[i]._row + ': ' +
              check.errors.join(', '));
          }
        }
      }
      report.validRows = validRows.length;
      _step(report, 'Validate', 'OK',
        report.validRows + ' qator import qilinadi (' + report.invalidRows + ' ogohlantirish)');

      // 4 + 5. TRANSFORM + BUSINESS LOGIC
      _step(report, 'Transform', 'RUNNING');
      var enriched = BusinessLogic.enrichAll(validRows, {
        today: new Date(),
        importBatch: report.batchId
      });
      _step(report, 'Transform', 'OK', enriched.length + ' yozuv boyitildi');

      // DATA varag'iga yozish.
      _step(report, 'Save', 'RUNNING');
      _ensureDataSheet();
      Repository.writeObjects(SHEETS.DATA, enriched, DATA_COLUMNS, {
        clearFirst: true, writeHeaders: true
      });
      _step(report, 'Save', 'OK', 'DATA varag\'iga saqlandi');

      // 6. STATISTICS
      _step(report, 'Statistics', 'RUNNING');
      Statistics.rebuild(enriched);
      _step(report, 'Statistics', 'OK');

      // 7. FINANCE
      _step(report, 'Finance', 'RUNNING');
      var fin = Finance.rebuild(enriched);
      report.totalAmount = fin.summary.totalAmount;
      report.totalPaid = fin.summary.totalPaid;
      report.totalDebt = fin.summary.totalDebt;
      _step(report, 'Finance', 'OK',
        'Jami summa: ' + Utils.formatMoney(fin.summary.totalAmount, true) +
        ' · To\'langan: ' + Utils.formatMoney(fin.summary.totalPaid, true));

      // 8. CACHE (eski keshni tozalash, yangisini isitish)
      _step(report, 'Cache', 'RUNNING');
      Cache.flushAll();
      Dashboard.invalidate();
      BusinessLogic.invalidate();
      BusinessCalendar.invalidate();
      _step(report, 'Cache', 'OK', 'Kesh tozalandi');

      // 9. DASHBOARD (snapshot)
      _step(report, 'Dashboard', 'RUNNING');
      Dashboard.refreshSnapshot(enriched);
      _step(report, 'Dashboard', 'OK');

      // Oylik snapshot (tarixiy taqqoslash uchun).
      Statistics.saveMonthlySnapshot(enriched);

      report.success = true;
    } catch (err) {
      report.error = String(err && err.message ? err.message : err);
      _step(report, 'Error', 'ERROR', report.error);
      // ROLLBACK
      try {
        _step(report, 'Rollback', 'RUNNING');
        _restoreData();
        _step(report, 'Rollback', 'OK', 'DATA zaxiradan tiklandi');
      } catch (rbErr) {
        _step(report, 'Rollback', 'ERROR', String(rbErr));
      }
    } finally {
      report.finishedAt = Utils.nowIso();
      report.durationMs = Date.now() - t0;
      _writeImportLog(report, opts.actor);
      try { lock.releaseLock(); } catch (e2) { /* ignore */ }
    }

    return report;
  }

  /**
   * DATA varag'ini BACKUP varag'iga nusxalaydi.
   * @returns {{rows: number}}
   */
  function _backupData() {
    if (!Repository.exists(SHEETS.DATA)) {
      return { rows: 0 };
    }
    var matrix = Repository.readMatrix(SHEETS.DATA);
    Repository.clearAll(SHEETS.BACKUP);
    var sh = Repository.sheet(SHEETS.BACKUP);
    if (!sh) {
      sh = Repository.ss().insertSheet(SHEETS.BACKUP);
    }
    if (matrix.length > 0) {
      var chunks = Utils.chunk(matrix, Config.value('importChunkSize', 5000));
      var cursor = 1;
      for (var i = 0; i < chunks.length; i++) {
        sh.getRange(cursor, 1, chunks[i].length, chunks[i][0].length)
          .setValues(chunks[i]);
        cursor += chunks[i].length;
        SpreadsheetApp.flush();
      }
    }
    return { rows: Math.max(0, matrix.length - 1) };
  }

  /**
   * BACKUP varag'idan DATA varag'ini tiklaydi (rollback).
   */
  function _restoreData() {
    if (!Repository.exists(SHEETS.BACKUP)) return;
    var matrix = Repository.readMatrix(SHEETS.BACKUP);
    _ensureDataSheet();
    Repository.clearAll(SHEETS.DATA);
    var sh = Repository.sheet(SHEETS.DATA, true);
    if (matrix.length > 0) {
      var chunks = Utils.chunk(matrix, Config.value('importChunkSize', 5000));
      var cursor = 1;
      for (var i = 0; i < chunks.length; i++) {
        sh.getRange(cursor, 1, chunks[i].length, chunks[i][0].length)
          .setValues(chunks[i]);
        cursor += chunks[i].length;
        SpreadsheetApp.flush();
      }
    }
    Cache.flushAll();
  }

  /**
   * DATA varag'i mavjudligini ta'minlaydi.
   */
  function _ensureDataSheet() {
    if (!Repository.exists(SHEETS.DATA)) {
      Repository.ss().insertSheet(SHEETS.DATA);
    }
  }

  /**
   * IMPORT_LOG varag'iga yozuv qo'shadi.
   * @param {Object} report
   * @param {string} [actor]
   */
  function _writeImportLog(report, actor) {
    try {
      var row = [
        report.batchId,
        report.startedAt,
        report.finishedAt,
        report.durationMs,
        report.totalRows,
        report.validRows,
        report.invalidRows,
        report.success ? 'SUCCESS' : 'FAILED',
        report.error || '',
        actor || Session.getActiveUser().getEmail() || 'system'
      ];
      Repository.appendRow(SHEETS.IMPORT_LOG, row);
    } catch (e) {
      Logger.log('Import._writeImportLog xato: ' + e);
    }
    // Markaziy action log.
    if (typeof AppLog !== 'undefined') {
      AppLog.action(ACTION_TYPE.IMPORT, actor,
        (report.success ? 'Import muvaffaqiyatli: ' : 'Import xato: ') +
        report.validRows + '/' + report.totalRows + ' qator');
    }
  }

  /**
   * Faqat import statistikasini qaytaradi (UI uchun).
   * @returns {Object}
   */
  function lastImportInfo() {
    if (!Repository.exists(SHEETS.IMPORT_LOG)) return null;
    var matrix = Repository.readMatrix(SHEETS.IMPORT_LOG);
    if (matrix.length < 2) return null;
    var last = matrix[matrix.length - 1];
    return {
      batchId: last[0],
      startedAt: last[1],
      finishedAt: last[2],
      durationMs: last[3],
      totalRows: last[4],
      validRows: last[5],
      invalidRows: last[6],
      status: last[7],
      error: last[8],
      actor: last[9]
    };
  }

  /**
   * Tayyor 2D jadvalni (mijoz tomonda o'qilgan) HISOBOT varag'iga yozadi.
   * @param {Array<Array<*>>} matrix
   * @returns {{rows: number, cols: number}}
   */
  function _writeMatrixToHisobot(matrix) {
    if (!matrix || matrix.length === 0) {
      throw new Error('Fayl bo\'sh yoki o\'qib bo\'lmadi.');
    }
    if (!Repository.exists(SHEETS.HISOBOT)) {
      Repository.ss().insertSheet(SHEETS.HISOBOT);
    }
    Repository.clearAll(SHEETS.HISOBOT);
    var sh = Repository.sheet(SHEETS.HISOBOT, true);

    var cols = 0;
    for (var i = 0; i < matrix.length; i++) {
      if (matrix[i] && matrix[i].length > cols) cols = matrix[i].length;
    }
    if (cols === 0) throw new Error('Faylda ustunlar topilmadi.');

    var clean = new Array(matrix.length);
    for (var r = 0; r < matrix.length; r++) {
      var row = matrix[r] || [];
      var out = new Array(cols);
      for (var c = 0; c < cols; c++) {
        out[c] = (row[c] === undefined || row[c] === null) ? '' : row[c];
      }
      clean[r] = out;
    }

    var chunkSize = Config.value('importChunkSize', 5000);
    var chunks = Utils.chunk(clean, chunkSize);
    var cursor = 1;
    for (var k = 0; k < chunks.length; k++) {
      sh.getRange(cursor, 1, chunks[k].length, cols).setValues(chunks[k]);
      cursor += chunks[k].length;
      SpreadsheetApp.flush();
    }
    return { rows: Math.max(0, clean.length - 1), cols: cols };
  }

  /**
   * Mijoz tomonda o'qilgan jadvaldan to'liq import qiladi.
   * @param {Array<Array<*>>} matrix
   * @param {Object} opts {fileName, actor}
   * @returns {Object} Import hisoboti
   */
  function importFromMatrix(matrix, opts) {
    opts = opts || {};
    try {
      var written = _writeMatrixToHisobot(matrix);
      var report = run({ actor: opts.actor });
      report.uploadedRows = written.rows;
      report.fileName = opts.fileName || '';
      return report;
    } catch (err) {
      var msg = String(err && err.message ? err.message : err);
      if (typeof AppLog !== 'undefined') AppLog.error('Import.importFromMatrix', err);
      return {
        success: false, error: 'Faylni yozishda xato: ' + msg,
        steps: [{ name: 'Fayl yuklash', status: 'ERROR', detail: msg }],
        totalRows: 0, validRows: 0, invalidRows: 0
      };
    }
  }

  /**
   * Yuklangan fayl tarkibini (xlsx/xls/csv) HISOBOT varag'iga yozadi.
   * xlsx/xls — Drive orqali vaqtinchalik Google Sheet'ga aylantiriladi.
   * @param {string} base64 Fayl mazmuni (base64)
   * @param {string} fileName
   * @param {string} mimeType
   * @returns {{rows: number, cols: number}}
   */
  function _writeFileToHisobot(base64, fileName, mimeType) {
    var bytes = Utilities.base64Decode(base64);
    var name = Utils.str(fileName).toLowerCase();
    var isCsv = name.slice(-4) === '.csv' || (mimeType || '').indexOf('csv') !== -1;

    var matrix;
    if (isCsv) {
      // CSV — to'g'ridan-to'g'ri parse qilamiz.
      var blobCsv = Utilities.newBlob(bytes, 'text/csv', fileName);
      var text = blobCsv.getDataAsString('UTF-8');
      matrix = Utilities.parseCsv(text);
    } else {
      // xlsx/xls — Drive orqali Google Sheet'ga aylantiramiz.
      matrix = _readExcelViaDrive(bytes, fileName);
    }

    if (!matrix || matrix.length === 0) {
      throw new Error('Fayl bo\'sh yoki o\'qib bo\'lmadi.');
    }

    // HISOBOT varag'ini to'liq tozalab, yangi ma'lumotni yozamiz.
    if (!Repository.exists(SHEETS.HISOBOT)) {
      Repository.ss().insertSheet(SHEETS.HISOBOT);
    }
    Repository.clearAll(SHEETS.HISOBOT);
    var sh = Repository.sheet(SHEETS.HISOBOT, true);

    // Ustunlar sonini tenglashtirish (parseCsv qatorlari turli uzunlikda bo'lishi mumkin).
    var cols = 0;
    for (var i = 0; i < matrix.length; i++) cols = Math.max(cols, matrix[i].length);
    for (var r = 0; r < matrix.length; r++) {
      while (matrix[r].length < cols) matrix[r].push('');
    }

    var chunkSize = Config.value('importChunkSize', 5000);
    var chunks = Utils.chunk(matrix, chunkSize);
    var cursor = 1;
    for (var c = 0; c < chunks.length; c++) {
      sh.getRange(cursor, 1, chunks[c].length, cols).setValues(chunks[c]);
      cursor += chunks[c].length;
      SpreadsheetApp.flush();
    }
    return { rows: Math.max(0, matrix.length - 1), cols: cols };
  }

  /**
   * xlsx/xls baytlarini Drive yordamida vaqtinchalik Google Sheet'ga aylantirib o'qiydi.
   * @param {Byte[]} bytes
   * @param {string} fileName
   * @returns {Array<Array<*>>}
   */
  function _readExcelViaDrive(bytes, fileName) {
    var blob = Utilities.newBlob(bytes,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName);
    var tempId = null;
    try {
      // Advanced Drive Service (v2) orqali konvertatsiya.
      var resource = { title: 'DKP_import_' + Date.now() };
      var file = Drive.Files.insert(resource, blob, { convert: true });
      tempId = file.id;
      var tempSs = SpreadsheetApp.openById(tempId);
      var firstSheet = tempSs.getSheets()[0];
      var lastRow = firstSheet.getLastRow();
      var lastCol = firstSheet.getLastColumn();
      if (lastRow < 1 || lastCol < 1) return [];
      return firstSheet.getRange(1, 1, lastRow, lastCol).getValues();
    } finally {
      if (tempId) {
        try { DriveApp.getFileById(tempId).setTrashed(true); } catch (e) { /* ignore */ }
      }
    }
  }

  /**
   * Yuklangan fayldan to'liq import qiladi: avval HISOBOT'ni to'ldiradi, so'ng run().
   * @param {Object} opts {base64, fileName, mimeType, actor}
   * @returns {Object} Import hisoboti (qo'shimcha: uploadedRows)
   */
  function importFromFile(opts) {
    opts = opts || {};
    if (!opts.base64) {
      return { success: false, error: 'Fayl yuborilmadi.', steps: [], totalRows: 0 };
    }
    try {
      var written = _writeFileToHisobot(opts.base64, opts.fileName, opts.mimeType);
      var report = run({ actor: opts.actor });
      report.uploadedRows = written.rows;
      report.fileName = opts.fileName;
      return report;
    } catch (err) {
      var msg = String(err && err.message ? err.message : err);
      if (typeof AppLog !== 'undefined') AppLog.error('Import.importFromFile', err);
      return {
        success: false,
        error: 'Faylni o\'qishda xato: ' + msg,
        steps: [{ name: 'Fayl yuklash', status: 'ERROR', detail: msg }],
        totalRows: 0, validRows: 0, invalidRows: 0
      };
    }
  }

  return {
    run: run,
    importFromFile: importFromFile,
    importFromMatrix: importFromMatrix,
    lastImportInfo: lastImportInfo
  };
})();
