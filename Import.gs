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
      lock.waitLock(30000);
    } catch (e) {
      report.error = 'Boshqa import jarayoni davom etmoqda. Iltimos kuting.';
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

      // 3. VALIDATE
      _step(report, 'Validate', 'RUNNING');
      var mapping = Repository.hisobotHeaderMapper(parsed.headers);
      var headerCheck = Validation.validateImportHeaders(mapping);
      if (!headerCheck.ok) {
        throw new Error('Sarlavha tekshiruvi muvaffaqiyatsiz: ' +
          headerCheck.errors.join('; '));
      }
      var validRows = [];
      for (var i = 0; i < parsed.rows.length; i++) {
        var check = Validation.validateImportRow(parsed.rows[i]);
        if (check.ok) {
          validRows.push(parsed.rows[i]);
        } else {
          report.invalidRows++;
          if (report.warnings.length < 50) {
            report.warnings.push('Qator ' + parsed.rows[i]._row + ': ' +
              check.errors.join(', '));
          }
        }
      }
      report.validRows = validRows.length;
      _step(report, 'Validate', 'OK',
        report.validRows + ' yaroqli, ' + report.invalidRows + ' yaroqsiz');

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
      Finance.rebuild(enriched);
      _step(report, 'Finance', 'OK');

      // 8. CACHE (eski keshni tozalash, yangisini isitish)
      _step(report, 'Cache', 'RUNNING');
      Cache.flushAll();
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

  return {
    run: run,
    lastImportInfo: lastImportInfo
  };
})();
