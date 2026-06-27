/**
 * ============================================================================
 * BusinessLogic.gs — Asosiy biznes mantiq dvigateli
 * ----------------------------------------------------------------------------
 * HISOBOT'dagi xom qatorlarni boyitilgan DATA yozuviga aylantiradi:
 *   - Status normalizatsiyasi (HOLAT -> kanonik kod)
 *   - Turar/Noturar joy klassifikatsiyasi (AREA_RULES + SERVICE_RULES)
 *   - Muddat hisoblash (ish kunlari, BusinessCalendar)
 *   - Muddat holati (Bajarilgan/Jarayonda/Bugun/1-2-3 kun/O'tgan)
 *   - SLA %, Progress %, Rang holati
 *   - To'lov holati, qarz summasi
 *
 * Barcha Excel formulalari (IF, IFS, COUNTIFS, MATCH...) shu yerda JavaScriptga
 * aylantirilgan. Spreadsheet formulalaridan UMUMAN foydalanilmaydi.
 * ============================================================================
 */

var BusinessLogic = (function () {

  var RULES_CACHE_KEY = 'biz::rules';
  var DEADLINE_CFG_CACHE_KEY = 'biz::deadlineCfg';

  /**
   * SERVICE_RULES va AREA_RULES varaqlaridan klassifikatsiya qoidalarini o'qiydi.
   * @returns {{serviceMap: Object, areaMap: Object, deadlineMap: Object}}
   */
  function _loadRules() {
    return Cache.remember(RULES_CACHE_KEY, function () {
      var serviceMap = {};   // normalizatsiyalangan xizmat turi -> {residency, deadlineDays}
      var areaMap = {};      // normalizatsiyalangan obyekt turi -> residency
      var deadlineMap = {};  // ariza turi -> ish kunlari

      // SERVICE_RULES: ustunlar — kod/nomi, residency, deadlineDays
      try {
        if (Repository.exists(SHEETS.SERVICE_RULES)) {
          var sr = Repository.readObjects(SHEETS.SERVICE_RULES);
          for (var i = 0; i < sr.rows.length; i++) {
            var row = sr.rows[i];
            var keys = _rowValues(row);
            var name = Utils.normalize(keys[0]);
            if (!name) continue;
            var residency = _parseResidency(keys[1]);
            var dd = Utils.toNumber(keys[2]);
            serviceMap[name] = {
              residency: residency,
              deadlineDays: dd > 0 ? dd : 0
            };
            if (dd > 0) deadlineMap[name] = dd;
          }
        }
      } catch (e) { Logger.log('SERVICE_RULES o\'qish xatosi: ' + e); }

      // AREA_RULES: ustunlar — obyekt turi, residency
      try {
        if (Repository.exists(SHEETS.AREA_RULES)) {
          var ar = Repository.readObjects(SHEETS.AREA_RULES);
          for (var j = 0; j < ar.rows.length; j++) {
            var arow = ar.rows[j];
            var avals = _rowValues(arow);
            var oname = Utils.normalize(avals[0]);
            if (!oname) continue;
            areaMap[oname] = _parseResidency(avals[1]);
          }
        }
      } catch (e2) { Logger.log('AREA_RULES o\'qish xatosi: ' + e2); }

      return { serviceMap: serviceMap, areaMap: areaMap, deadlineMap: deadlineMap };
    }, Config.value('cacheTtlSec', 1800));
  }

  /**
   * Obyektning _row kalitidan tashqari qiymatlarini tartib bilan qaytaradi.
   * @param {Object} row
   * @returns {Array}
   */
  function _rowValues(row) {
    var vals = [];
    for (var k in row) {
      if (row.hasOwnProperty(k) && k !== '_row') vals.push(row[k]);
    }
    return vals;
  }

  /**
   * Matnni RESIDENCY kodiga aylantiradi.
   * @param {*} v
   * @returns {string}
   */
  function _parseResidency(v) {
    var s = Utils.normalize(v);
    if (s.indexOf('notur') !== -1 || s.indexOf('non') !== -1 ||
        s.indexOf('tijorat') !== -1 || s.indexOf('biznes') !== -1) {
      return RESIDENCY.NON_RESIDENTIAL;
    }
    if (s.indexOf('tur') !== -1 || s.indexOf('uy') !== -1 ||
        s.indexOf('resid') !== -1 || s.indexOf('yashash') !== -1) {
      return RESIDENCY.RESIDENTIAL;
    }
    return '';
  }

  /**
   * HOLAT matnini kanonik status kodiga aylantiradi.
   * @param {*} raw
   * @returns {string}
   */
  function normalizeStatus(raw) {
    var s = Utils.normalize(raw);
    if (!s) return APP_STATUS.NEW;
    // To'g'ridan-to'g'ri lug'atdan qidirish.
    if (STATUS_DICTIONARY[s]) return STATUS_DICTIONARY[s];
    // Qisman moslik.
    for (var key in STATUS_DICTIONARY) {
      if (STATUS_DICTIONARY.hasOwnProperty(key) && s.indexOf(key) !== -1) {
        return STATUS_DICTIONARY[key];
      }
    }
    return APP_STATUS.IN_PROGRESS;
  }

  /**
   * Ariza turar/noturar joyligini aniqlaydi.
   * Ustuvorlik: AREA_RULES (obyekt turi) -> SERVICE_RULES (xizmat) -> heuristika.
   * @param {Object} row
   * @returns {string} RESIDENCY kodi
   */
  function classifyResidency(row) {
    var rules = _loadRules();
    var objName = Utils.normalize(row.objectType);
    if (objName && rules.areaMap[objName]) return rules.areaMap[objName];

    var svc = Utils.normalize(row.applicationType) || Utils.normalize(row.serviceCode);
    if (svc && rules.serviceMap[svc] && rules.serviceMap[svc].residency) {
      return rules.serviceMap[svc].residency;
    }

    // Heuristik tahlil (obyekt + ariza turi matnidan).
    var combined = objName + ' ' + svc + ' ' + Utils.normalize(row.note);
    var byText = _parseResidency(combined);
    return byText || RESIDENCY.RESIDENTIAL;
  }

  /**
   * MUDDAT_QOIDALARI varag'idagi sozlanadigan qiymatlarni {kalit: kun} xaritasi
   * sifatida o'qiydi (keshlanadi).
   * @returns {Object<string, number>}
   */
  function _loadDeadlineConfig() {
    return Cache.remember(DEADLINE_CFG_CACHE_KEY, function () {
      try {
        return DeadlineSettings.getDeadlineConfigMap();
      } catch (e) {
        Logger.log('Deadline config o\'qish xatosi: ' + e);
        return {};
      }
    }, Config.value('cacheTtlSec', 1800));
  }

  /**
   * Matnni taqqoslash uchun normallashtiradi (Excel "=" kabi — registrga sezgir emas;
   * apostrof variantlari va ortiqcha bo'shliqlar birxillashtiriladi).
   * @param {*} s
   * @returns {string}
   */
  function _cmp(s) {
    return Utils.str(s)
      .replace(/[\u2018\u2019\u02BB\u02BC\u0060\u00B4]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /** s qiymati arr ro'yxatidagi biror qiymatga teng (normallashgan)mi? */
  function _cmpIn(s, arr) {
    var x = _cmp(s);
    for (var i = 0; i < arr.length; i++) {
      if (_cmp(arr[i]) === x) return true;
    }
    return false;
  }

  /** Qiymatni songa keltiradi; bo'sh/yaroqsiz bo'lsa fallback qaytadi. */
  function _num(v, fallback) {
    if (v === undefined || v === null || v === '') return fallback;
    var n = Utils.toNumber(v);
    return isNaN(n) ? fallback : n;
  }

  /**
   * Config'dagi prefiksli (manba:/flag:/ariza:) kalitlardan qiymatga aniq mos
   * keluvchisini topadi. Topilmasa null.
   * @param {Object} cfg
   * @param {string} prefix
   * @param {*} value
   * @returns {number|null}
   */
  function _matchPrefix(cfg, prefix, value) {
    var x = _cmp(value);
    if (!x) return null;
    for (var k in cfg) {
      if (!cfg.hasOwnProperty(k)) continue;
      if (k.indexOf(prefix) === 0 && _cmp(k.substring(prefix.length)) === x) {
        return _num(cfg[k], 0);
      }
    }
    return null;
  }

  /**
   * Maydon (m²) bo'yicha ish kunlari (Excel: IF(W<100,..,IF(W<=1000,..))).
   * Chegaralar tuzilmaviy (kodda), kunlar — sozlanadigan.
   * @param {number} w
   * @param {Object} cfg
   * @returns {number}
   */
  function _areaTierDays(w, cfg) {
    if (w < 100) return _num(cfg['maydon:<100'], 10);
    if (w <= 1000) return _num(cfg['maydon:<=1000'], 12);
    if (w <= 5000) return _num(cfg['maydon:<=5000'], 17);
    if (w <= 15000) return _num(cfg['maydon:<=15000'], 22);
    if (w <= 50000) return _num(cfg['maydon:<=50000'], 28);
    return _num(cfg['maydon:>50000'], 37);
  }

  /**
   * Ariza muddatini (ish kunlari) hisoblaydi — foydalanuvchining Excel formulasi
   * (ustun X "Аризани муддати кун") aynan JavaScriptga o'girilgan.
   *
   * Ustunlar mosligi (Excel -> tizim maydoni):
   *   N -> applicationSource (Ariza manbasi)
   *   V -> cadastrePassportType (Kadastr passport olish turi)
   *   I -> applicationType (Ariza turi)
   *   L -> objectType2 (Obyekt turi 2)
   *   O -> priznak (Priznak)
   *   W -> externalArea (Tashqi o'lchovlar bo'yicha maydon)
   *
   * Qiymatlar (kunlar) MUDDAT_QOIDALARI varag'idan sozlanadi.
   * @param {Object} row
   * @returns {number} ish kunlari soni
   */
  function computeDeadlineDays(row) {
    var cfg = _loadDeadlineConfig();
    var N = row.applicationSource;
    var V = row.cadastrePassportType;
    var I = row.applicationType;
    var L = row.objectType2;
    var O = row.priznak;
    var W = Utils.toNumber(row.externalArea);

    // 1) Ariza manbasi (Kadastr muhandisi / UZKAD ...)
    var m = _matchPrefix(cfg, 'manba:', N);
    if (m !== null) return m;

    // 2) FREE bayrog'i (Kadastr passport olish turi)
    var f = _matchPrefix(cfg, 'flag:', V);
    if (f !== null) return f;

    // 3) Ariza turi bo'yicha aniq qoidalar
    var a = _matchPrefix(cfg, 'ariza:', I);
    if (a !== null) return a;

    // 4) Turar obyekt / Turar kompozit
    if (_cmpIn(I, [
      "Turar joy obyektning kadastr pasportini shakllantirish va davlat ro'yxatidan o'tkazish",
      'Turar kompozit'
    ])) {
      if (_cmp(L) === _cmp('Turar yer maydoni')) return _num(cfg['turar:yer_maydoni'], 7);
      return _num(cfg['turar:default'], 10);
    }

    // 5) Noturar obyekt / Noturar kompozit
    if (_cmpIn(I, [
      "Noturar obyektning kadastr pasportini shakllantirish va davlat ro'yxatidan o'tkazish",
      'Noturar kompozit'
    ])) {
      if (_cmp(O) === _cmp("Ko'p yillik daraxtlar xizmati")) return _num(cfg['noturar:daraxtlar'], 15);
      if (_cmpIn(L, ['Noturar yer maydoni', 'Davlat tashkilotlaridan ijaraga olingan yer uchastkasi'])) {
        return _num(cfg['noturar:yer_yoki_davlat'], 7);
      }
      return _areaTierDays(W, cfg);
    }

    // 6) Umumiy foydalanishdagi ko'chmas mulk qismini yaratish
    if (_cmp(I) === _cmp("Umumiy foydalanishdagi ko'chmas mulk qismini yaratish")) {
      var isTurar;
      if (_cmp(L) === '') {
        // Obyekt turi 2 bo'sh — Priznak bo'yicha aniqlanadi.
        isTurar = _cmpIn(O, ['Turar joy xizmati', 'Yakka tartibdagi turar joy']);
      } else {
        isTurar = _cmpIn(L, ['Yakka tartibdagi turar joy', 'Turar joy xizmati']);
      }
      if (isTurar) return _num(cfg['umumiy:turar'], 10);
      return _areaTierDays(W, cfg);
    }

    // 7) Hech qaysi qoidaga mos kelmadi — standart.
    return _num(cfg['default'], Config.value('defaultDeadlineDays', 10));
  }

  /**
   * Arizaning belgilangan muddat sanasini hisoblaydi.
   * Agar HISOBOT'da muddat berilmagan bo'lsa, qabul sanasiga formula bo'yicha
   * hisoblangan ish kunlari qo'shiladi.
   * @param {Object} row
   * @returns {Date|null}
   */
  function computeDeadline(row) {
    var explicit = Utils.toDate(row.deadlineDate);
    if (explicit) return Utils.startOfDay(explicit);

    var register = Utils.toDate(row.registerDate);
    if (!register) return null;

    var days = computeDeadlineDays(row);
    if (!days || days <= 0) {
      days = Config.value('defaultDeadlineDays', 10);
    }
    return BusinessCalendar.addWorkingDays(register, days);
  }

  /**
   * Arizaning muddat holatini va rangini aniqlaydi.
   * @param {Object} row Status va sanalar bilan to'ldirilgan obyekt
   * @param {Date} [today]
   * @returns {{deadlineStatus: string, remainingDays: number, colorStatus: string}}
   */
  function computeDeadlineStatus(row, today) {
    var now = Utils.startOfDay(today || new Date());
    var status = row.status || normalizeStatus(row.statusRaw);

    // MUHIM: To'lovga chiqarilgan (issued) arizaga muddat hisoblanmaydi —
    // muhandis o'z ishini yakunlagan. To'lov esa alohida (mijoz zimmasida).
    var issued = Utils.toDate(row.issuedDate);
    if (issued) {
      return {
        deadlineStatus: DEADLINE_STATUS.COMPLETED,
        remainingDays: 0,
        colorStatus: COLOR_STATUS.GREEN
      };
    }

    // Bajarilgan/bekor qilingan arizalar muddat hisobidan chiqariladi.
    if (status === APP_STATUS.COMPLETED) {
      return {
        deadlineStatus: DEADLINE_STATUS.COMPLETED,
        remainingDays: 0,
        colorStatus: COLOR_STATUS.GREEN
      };
    }
    if (status === APP_STATUS.REJECTED || status === APP_STATUS.CANCELLED) {
      return {
        deadlineStatus: DEADLINE_STATUS.COMPLETED,
        remainingDays: 0,
        colorStatus: COLOR_STATUS.GREEN
      };
    }

    var deadline = row.deadlineDate ? Utils.toDate(row.deadlineDate) : null;
    if (!deadline) {
      return {
        deadlineStatus: DEADLINE_STATUS.IN_PROGRESS,
        remainingDays: 0,
        colorStatus: COLOR_STATUS.YELLOW
      };
    }

    var remaining = BusinessCalendar.remainingWorkingDays(deadline, now);
    var dStatus, color;

    if (remaining < 0) {
      dStatus = DEADLINE_STATUS.EXPIRED;  color = COLOR_STATUS.BLACK;
    } else if (remaining === 0) {
      dStatus = DEADLINE_STATUS.DUE_TODAY; color = COLOR_STATUS.RED;
    } else if (remaining === 1) {
      dStatus = DEADLINE_STATUS.ONE_DAY;   color = COLOR_STATUS.ORANGE;
    } else if (remaining === 2) {
      dStatus = DEADLINE_STATUS.TWO_DAYS;  color = COLOR_STATUS.ORANGE;
    } else if (remaining === 3) {
      dStatus = DEADLINE_STATUS.THREE_DAYS; color = COLOR_STATUS.YELLOW;
    } else {
      dStatus = DEADLINE_STATUS.IN_PROGRESS; color = COLOR_STATUS.GREEN;
    }

    return { deadlineStatus: dStatus, remainingDays: remaining, colorStatus: color };
  }

  /**
   * Progress foizini hisoblaydi (muddatning qancha qismi sarflandi).
   * @param {Object} row
   * @param {Date} [today]
   * @returns {number} 0..100
   */
  function computeProgress(row, today) {
    var status = row.status;
    if (status === APP_STATUS.COMPLETED ||
        status === APP_STATUS.REJECTED || status === APP_STATUS.CANCELLED) {
      return 100;
    }
    var register = Utils.toDate(row.registerDate);
    var deadline = Utils.toDate(row.deadlineDate);
    if (!register || !deadline) return 0;

    var now = Utils.startOfDay(today || new Date());
    var total = BusinessCalendar.workingDaysBetween(register, deadline);
    if (total <= 0) return 100;
    var used = BusinessCalendar.workingDaysBetween(register, now);
    var pct = Utils.percentOf(used, total);
    return Math.max(0, Math.min(100, pct));
  }

  /**
   * To'lov holati va qarz summasini hisoblaydi.
   * MUHIM: "Oxirgi jarayon nomi" = "To'lov kutilmoqda" bo'lsa — bu ariza
   * to'lanishi lozim (kutilayotgan) deb belgilanadi (to'liq to'langanlar bundan mustasno).
   * @param {Object} row
   * @returns {{paymentStatus: string, debtAmount: number}}
   */
  function computePayment(row) {
    var amount = Utils.toNumber(row.amount);
    var paid = Utils.toNumber(row.paidAmount);
    var debt = Math.max(0, amount - paid);

    // Jarayon bosqichi to'lov kutilayotganini bildiradimi?
    var stage = Utils.normalize(row.lastProcessName || '')
      .replace(/['\u02bb\u02bc`\u2019\u2018]/g, '');
    var stageWaiting = stage.indexOf('tolov kutilmoqda') !== -1 ||
      stage.indexOf('tulov kutilmoqda') !== -1 ||
      (stage.indexOf('tolov') !== -1 && stage.indexOf('kutil') !== -1);

    var explicit = Utils.normalize(row.paymentStatusRaw || row.paymentStatus);
    var ps;
    if (amount > 0 && paid >= amount) {
      ps = PAYMENT_STATUS.PAID;                 // to'liq to'langan
    } else if (stageWaiting) {
      ps = PAYMENT_STATUS.WAITING;              // jarayon: to'lov kutilmoqda
    } else if (explicit.indexOf("to'la") !== -1 || explicit.indexOf('paid') !== -1 ||
        explicit.indexOf('to`la') !== -1 || explicit.indexOf('tolangan') !== -1) {
      ps = PAYMENT_STATUS.PAID;
    } else if (paid > 0 && paid < amount) {
      ps = PAYMENT_STATUS.PARTIAL;
    } else if (amount > 0 && paid === 0) {
      ps = PAYMENT_STATUS.WAITING;
    } else {
      ps = PAYMENT_STATUS.UNPAID;
    }
    return { paymentStatus: ps, debtAmount: debt };
  }

  /**
   * Bitta xom HISOBOT qatorini to'liq boyitilgan DATA yozuviga aylantiradi.
   * @param {Object} raw HISOBOT logik kalitli obyekt
   * @param {Object} ctx {today: Date, importBatch: string}
   * @returns {Object} DATA_COLUMNS sxemasiga mos yozuv
   */
  function enrichRow(raw, ctx) {
    ctx = ctx || {};
    var today = ctx.today || new Date();

    var rec = {};
    rec.rowId = Utils.str(raw.rowId) || Utils.uuid();
    rec.applicationNo = Utils.str(raw.applicationNo);
    rec.transactionNo = Utils.str(raw.transactionNo);
    rec.cadastreNo = Utils.str(raw.cadastreNo);
    rec.arizaCadastreNo = Utils.str(raw.arizaCadastreNo);
    rec.customer = Utils.titleCase(raw.customer);
    rec.owner = Utils.titleCase(raw.owner);
    rec.phone = Utils.str(raw.phone);
    rec.district = Utils.str(raw.district);
    rec.mahallaCode = Utils.str(raw.mahallaCode);
    rec.mahallaName = Utils.str(raw.mahallaName);
    rec.engineer = Utils.str(raw.engineer);
    rec.chiefEngineer = Utils.str(raw.chiefEngineer);
    rec.registrator = Utils.str(raw.registrator);
    rec.applicationType = Utils.str(raw.applicationType);
    rec.applicationPurpose = Utils.str(raw.applicationPurpose);
    rec.objectType = Utils.str(raw.objectType);
    rec.objectType2 = Utils.str(raw.objectType2);
    rec.objectSubdivision = Utils.str(raw.objectSubdivision);
    rec.serviceCode = Utils.str(raw.serviceCode);
    rec.priznak = Utils.str(raw.priznak);
    rec.applicationSource = Utils.str(raw.applicationSource);
    rec.socialProtection = Utils.str(raw.socialProtection);

    // Maydonlar (Excel formulasi: externalArea = W).
    rec.externalArea = Utils.toNumber(raw.externalArea);
    rec.buildingArea = Utils.toNumber(raw.buildingArea);

    // To'lov tasnifi.
    rec.cadastrePassportType = Utils.str(raw.cadastrePassportType);
    rec.registrationType = Utils.str(raw.registrationType);
    rec.buildingOrLand = Utils.str(raw.buildingOrLand);
    rec.addressAssignment = Utils.str(raw.addressAssignment);
    rec.cadastreInvoiceArea = Utils.toNumber(raw.cadastreInvoiceArea);
    rec.regInvoiceArea = Utils.toNumber(raw.regInvoiceArea);

    // Jarayon holati (filtrlash uchun).
    rec.lastProcessRole = Utils.str(raw.lastProcessRole);
    rec.lastProcessName = Utils.str(raw.lastProcessName);
    rec.rejectReason = Utils.str(raw.rejectReason);

    // Status normalizatsiyasi.
    raw.statusRaw = raw.status;
    rec.status = normalizeStatus(raw.status);
    raw.status = rec.status;

    // Klassifikatsiya.
    rec.residency = classifyResidency(raw);

    // Sanalar.
    var register = Utils.toDate(raw.registerDate);
    rec.registerDate = register || '';
    raw.registerDate = register;

    var deadline = computeDeadline(raw);
    rec.deadlineDate = deadline || '';
    raw.deadlineDate = deadline;
    // Formula bo'yicha hisoblangan ish kunlari soni (ko'rsatish/tahlil uchun).
    rec.deadlineDays = computeDeadlineDays(raw);

    var complete = Utils.toDate(raw.completeDate);
    rec.completeDate = complete || '';
    raw.completeDate = complete;

    // To'lovga chiqarilgan sana — muddat hisobini to'xtatuvchi signal.
    var issuedDate = Utils.toDate(raw.issuedDate);
    rec.issuedDate = issuedDate || '';
    raw.issuedDate = issuedDate;
    rec.issued = issuedDate ? true : false;

    rec.area = Utils.toNumber(raw.area);

    // Muddat holati.
    var ds = computeDeadlineStatus(raw, today);
    rec.deadlineStatus = ds.deadlineStatus;
    rec.remainingDays = ds.remainingDays;
    rec.colorStatus = ds.colorStatus;

    rec.progressPercent = computeProgress(raw, today);

    // Moliya — to'lov uchta qismdan iborat (Kadastr + Registratsiya + Manzil).
    var amountSum = Utils.toNumber(raw.amountCadastre) +
      Utils.toNumber(raw.amountReg) + Utils.toNumber(raw.amountAddr);
    var paidSum = Utils.toNumber(raw.paidCadastre) +
      Utils.toNumber(raw.paidReg) + Utils.toNumber(raw.paidAddr);
    rec.amount = amountSum > 0 ? amountSum : Utils.toNumber(raw.amount);
    rec.paidAmount = paidSum > 0 ? paidSum : Utils.toNumber(raw.paidAmount);
    // computePayment yig'ilgan summalardan foydalanishi uchun raw'ga ham yozamiz.
    raw.amount = rec.amount;
    raw.paidAmount = rec.paidAmount;
    raw.paymentStatusRaw = raw.paymentStatus;
    var pay = computePayment(raw);
    rec.paymentStatus = pay.paymentStatus;
    rec.debtAmount = pay.debtAmount;
    rec.paymentDate = Utils.toDate(raw.paymentDate) || '';

    rec.note = Utils.str(raw.note);

    // Davr maydonlari (statistika uchun).
    var periodDate = register || complete || today;
    rec.year = periodDate.getFullYear();
    rec.month = periodDate.getMonth() + 1;

    rec.importBatch = ctx.importBatch || '';
    rec.updatedAt = Utils.nowIso();

    return rec;
  }

  /**
   * Xom qatorlar massivini ommaviy boyitadi.
   * @param {Array<Object>} rawRows
   * @param {Object} ctx
   * @returns {Array<Object>}
   */
  function enrichAll(rawRows, ctx) {
    ctx = ctx || {};
    ctx.today = ctx.today || new Date();
    var out = new Array(rawRows.length);
    for (var i = 0; i < rawRows.length; i++) {
      out[i] = enrichRow(rawRows[i], ctx);
    }
    return out;
  }

  /** Qoida keshini tozalash (SERVICE_RULES/AREA_RULES/MUDDAT_QOIDALARI o'zgarsa). */
  function invalidate() {
    Cache.remove(RULES_CACHE_KEY);
    Cache.remove(DEADLINE_CFG_CACHE_KEY);
  }

  return {
    normalizeStatus: normalizeStatus,
    classifyResidency: classifyResidency,
    computeDeadline: computeDeadline,
    computeDeadlineDays: computeDeadlineDays,
    computeDeadlineStatus: computeDeadlineStatus,
    computeProgress: computeProgress,
    computePayment: computePayment,
    enrichRow: enrichRow,
    enrichAll: enrichAll,
    invalidate: invalidate
  };
})();
