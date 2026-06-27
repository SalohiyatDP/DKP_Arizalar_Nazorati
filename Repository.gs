/**
 * ============================================================================
 * Repository.gs — Ma'lumotlarga kirish qatlami (Repository Pattern)
 * ----------------------------------------------------------------------------
 * Spreadsheet bilan barcha o'qish/yozish operatsiyalari shu yerda jamlangan.
 * Qoidalar:
 *   - Bitta getValues() / setValues() bilan ommaviy o'qish-yozish.
 *   - Hech qanday hujayra-hujayra (cell-by-cell) operatsiya yo'q.
 *   - Sarlavhalar (header) avtomatik aniqlanadi va obyektlarga aylantiriladi.
 *   - 100 000+ qator uchun batch (chunk) yozuv.
 * ============================================================================
 */

var Repository = (function () {

  var _ssCache = null;

  /**
   * Faol spreadsheetni qaytaradi.
   * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
   */
  function ss() {
    if (_ssCache) return _ssCache;
    _ssCache = SpreadsheetApp.getActiveSpreadsheet();
    if (!_ssCache) {
      throw new Error('Faol Spreadsheet topilmadi. Skript Spreadsheet bilan bog\'lanmagan.');
    }
    return _ssCache;
  }

  /**
   * Varaqni nomi bo'yicha olish.
   * @param {string} name
   * @param {boolean} [required]
   * @returns {GoogleAppsScript.Spreadsheet.Sheet|null}
   */
  function sheet(name, required) {
    var sh = ss().getSheetByName(name);
    if (!sh && required) {
      throw new Error('Varaq topilmadi: "' + name + '". Mavjud varaqlar tekshirilsin.');
    }
    return sh;
  }

  /**
   * Varaq mavjudligini tekshirish.
   * @param {string} name
   * @returns {boolean}
   */
  function exists(name) {
    return !!ss().getSheetByName(name);
  }

  /**
   * Varaqning butun matritsasini (sarlavha + ma'lumot) o'qiydi.
   * @param {string} name
   * @returns {Array<Array<*>>} Bo'sh bo'lsa [].
   */
  function readMatrix(name) {
    var sh = sheet(name);
    if (!sh) return [];
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (lastRow < 1 || lastCol < 1) return [];
    return sh.getRange(1, 1, lastRow, lastCol).getValues();
  }

  /**
   * Varaqni obyektlar massiviga o'qiydi (birinchi qator — sarlavha).
   * @param {string} name
   * @param {function(Array<string>):Object<string,number>} [headerMapper]
   *        Sarlavhalarni logik kalitlarga moslashtiruvchi funksiya.
   * @returns {{headers: Array<string>, rows: Array<Object>, raw: Array<Array>}}
   */
  function readObjects(name, headerMapper) {
    var matrix = readMatrix(name);
    if (matrix.length === 0) return { headers: [], rows: [], raw: [] };

    var headers = matrix[0].map(function (h) { return Utils.str(h); });
    var keyByCol;
    if (headerMapper) {
      keyByCol = headerMapper(headers);
    } else {
      keyByCol = {};
      for (var c = 0; c < headers.length; c++) keyByCol[c] = headers[c];
    }

    var rows = [];
    for (var r = 1; r < matrix.length; r++) {
      var row = matrix[r];
      // To'liq bo'sh qatorlarni o'tkazib yuborish.
      var empty = true;
      for (var k = 0; k < row.length; k++) {
        if (row[k] !== '' && row[k] != null) { empty = false; break; }
      }
      if (empty) continue;

      var obj = { _row: r + 1 };
      for (var col in keyByCol) {
        if (keyByCol.hasOwnProperty(col)) {
          obj[keyByCol[col]] = row[col];
        }
      }
      rows.push(obj);
    }
    return { headers: headers, rows: rows, raw: matrix };
  }

  /**
   * Varaqdagi ma'lumotlarni (sarlavhadan tashqari) tozalaydi.
   * @param {string} name
   */
  function clearData(name) {
    var sh = sheet(name);
    if (!sh) return;
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (lastRow > 1 && lastCol > 0) {
      sh.getRange(2, 1, lastRow - 1, lastCol).clearContent();
    }
  }

  /**
   * Varaqni to'liq tozalaydi (sarlavha bilan birga).
   * @param {string} name
   */
  function clearAll(name) {
    var sh = sheet(name);
    if (sh) sh.clear();
  }

  /**
   * Sarlavhalarni yozadi (1-qatorga).
   * @param {string} name
   * @param {Array<string>} headers
   */
  function writeHeaders(name, headers) {
    var sh = sheet(name, true);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }

  /**
   * Matritsani varaqqa ommaviy (chunk) yozadi.
   * 100 000+ qatorda timeout bo'lmasligi uchun bo'laklab yoziladi.
   * @param {string} name
   * @param {Array<Array<*>>} matrix Sarlavhasiz ma'lumot
   * @param {number} [startRow] Boshlang'ich qator (standart: 2)
   */
  function writeMatrix(name, matrix, startRow) {
    var sh = sheet(name, true);
    if (!matrix || matrix.length === 0) return;
    var start = startRow || 2;
    var cols = matrix[0].length;
    var chunkSize = Config.value('importChunkSize', 5000);
    var chunks = Utils.chunk(matrix, chunkSize);
    var rowCursor = start;
    for (var i = 0; i < chunks.length; i++) {
      var part = chunks[i];
      sh.getRange(rowCursor, 1, part.length, cols).setValues(part);
      rowCursor += part.length;
      SpreadsheetApp.flush();
    }
  }

  /**
   * Obyektlar massivini ustun tartibi bo'yicha matritsaga aylantirib yozadi.
   * @param {string} name
   * @param {Array<Object>} objects
   * @param {Array<string>} columns Ustunlar tartibi (logik kalitlar)
   * @param {Object} [opts] {clearFirst: true, writeHeaders: true}
   */
  function writeObjects(name, objects, columns, opts) {
    opts = opts || {};
    var sh = sheet(name, true);
    if (opts.clearFirst !== false) clearData(name);
    if (opts.writeHeaders) writeHeaders(name, columns);

    if (!objects || objects.length === 0) return;
    var matrix = new Array(objects.length);
    for (var i = 0; i < objects.length; i++) {
      var obj = objects[i];
      var row = new Array(columns.length);
      for (var c = 0; c < columns.length; c++) {
        var v = obj[columns[c]];
        row[c] = (v === undefined || v === null) ? '' : v;
      }
      matrix[i] = row;
    }
    writeMatrix(name, matrix, 2);
  }

  /**
   * Bitta qatorni varaq oxiriga qo'shadi (log varaqlari uchun).
   * @param {string} name
   * @param {Array<*>} row
   */
  function appendRow(name, row) {
    var sh = sheet(name);
    if (!sh) {
      // Log varaqlari yo'q bo'lsa yaratiladi (faqat tizim varaqlari uchun).
      sh = ss().insertSheet(name);
    }
    sh.appendRow(row);
  }

  /**
   * Bir nechta qatorni ommaviy qo'shadi.
   * @param {string} name
   * @param {Array<Array<*>>} rows
   */
  function appendRows(name, rows) {
    if (!rows || rows.length === 0) return;
    var sh = sheet(name);
    if (!sh) sh = ss().insertSheet(name);
    var startRow = sh.getLastRow() + 1;
    sh.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
  }

  /**
   * Varaqdagi ma'lumot qatorlari sonini qaytaradi (sarlavhasiz).
   * @param {string} name
   * @returns {number}
   */
  function rowCount(name) {
    var sh = sheet(name);
    if (!sh) return 0;
    return Math.max(0, sh.getLastRow() - 1);
  }

  /**
   * HISOBOT sarlavhalarini logik kalitlarga moslashtiruvchi mapper.
   * @param {Array<string>} headers
   * @returns {Object<number,string>} {ustunIndeksi: logikKalit}
   */
  function hisobotHeaderMapper(headers) {
    var map = {};
    var normHeaders = headers.map(function (h) { return Utils.normalize(h); });
    for (var key in HISOBOT_FIELDS) {
      if (!HISOBOT_FIELDS.hasOwnProperty(key)) continue;
      var variants = HISOBOT_FIELDS[key];
      for (var v = 0; v < variants.length; v++) {
        var target = Utils.normalize(variants[v]);
        var idx = normHeaders.indexOf(target);
        if (idx !== -1) { map[idx] = key; break; }
      }
    }
    return map;
  }

  return {
    ss: ss,
    sheet: sheet,
    exists: exists,
    readMatrix: readMatrix,
    readObjects: readObjects,
    clearData: clearData,
    clearAll: clearAll,
    writeHeaders: writeHeaders,
    writeMatrix: writeMatrix,
    writeObjects: writeObjects,
    appendRow: appendRow,
    appendRows: appendRows,
    rowCount: rowCount,
    hisobotHeaderMapper: hisobotHeaderMapper
  };
})();
