/**
 * ============================================================================
 * Finance.gs — Moliyaviy tahlil dvigateli
 * ----------------------------------------------------------------------------
 * To'lovlar, daromad, qarz va moliyaviy tendensiyalarni hisoblaydi:
 *   - Oylik daromad, yig'ilgan summa, kutilayotgan to'lov
 *   - Oylik / yillik statistika
 *   - Muhandis / Tuman / Viloyat kesimida moliya
 *   - Oylararo taqqoslash va tendensiya
 * Natijalar FINANCE varag'iga va keshga yoziladi.
 * ============================================================================
 */

var Finance = (function () {

  var FIN_CACHE_KEY = 'finance::summary';

  /**
   * Yozuvlar bo'yicha moliyaviy ko'rsatkichlarni hisoblaydi.
   * @param {Array<Object>} rows
   * @returns {Object}
   */
  function compute(rows) {
    var totalAmount = 0, totalPaid = 0, totalDebt = 0;
    var waitingAmount = 0, waitingCount = 0;
    var byMonth = {};
    var byDistrict = {};
    var byEngineer = {};
    var byRegistrator = {};
    var pending = [];

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var amount = Utils.toNumber(r.amount);
      var paid = Utils.toNumber(r.paidAmount);
      var debt = Utils.toNumber(r.debtAmount);

      totalAmount += amount;
      totalPaid += paid;
      totalDebt += debt;

      // To'lov jarayonida (kutilayotgan) — to'lanishi lozim summa = qarz (amount - paid).
      var isWaiting = r.paymentStatus === PAYMENT_STATUS.WAITING;
      var pendAmt = isWaiting ? (debt > 0 ? debt : Math.max(0, amount - paid)) : 0;
      if (isWaiting) {
        waitingCount++;
        waitingAmount += pendAmt;
        if (pending.length < 5000) {
          pending.push({
            transactionNo: Utils.str(r.transactionNo),
            applicationNo: Utils.str(r.applicationNo),
            cadastreNo: Utils.str(r.cadastreNo),
            customer: Utils.str(r.customer),
            owner: Utils.str(r.owner),
            phone: Utils.str(r.phone),
            district: Utils.str(r.district),
            engineer: Utils.str(r.engineer),
            registrator: Utils.str(r.registrator),
            applicationType: Utils.str(r.applicationType),
            amount: amount,
            paid: paid,
            pendingAmount: pendAmt,
            registerDate: Utils.formatDate(r.registerDate),
            deadlineDate: Utils.formatDate(r.deadlineDate)
          });
        }
      }

      var mKey = r.year + '-' + ('0' + r.month).slice(-2);
      _accMonth(byMonth, mKey, amount, paid, debt);
      _accGroup(byDistrict, r.district || 'Noma\'lum', amount, paid, debt, isWaiting, pendAmt);
      _accGroup(byRegistrator, r.registrator || 'Noma\'lum', amount, paid, debt, isWaiting, pendAmt);

      // KADASTR MUHANDISI kesimi — to'lov faqat Kadastr + Manzil summalaridan.
      var engAmount = Utils.toNumber(r.engineerAmount);
      var engPaid = Utils.toNumber(r.engineerPaid);
      var engDebt = Math.max(0, engAmount - engPaid);
      var engPendAmt = isWaiting ? engDebt : 0;
      _accGroup(byEngineer, r.engineer || 'Noma\'lum', engAmount, engPaid, engDebt, isWaiting, engPendAmt);
    }

    // Kutilayotgan to'lov summasi bo'yicha kamayuvchi tartibda (eng katta qarz oldinda).
    pending.sort(function (a, b) { return b.pendingAmount - a.pendingAmount; });

    var monthly = _monthArray(byMonth);
    var currentMonthKey = Utilities.formatDate(new Date(),
      Config.value('timeZone', 'Asia/Tashkent'), 'yyyy-MM');
    var current = byMonth[currentMonthKey] || { amount: 0, paid: 0, debt: 0, count: 0 };

    return {
      summary: {
        totalAmount: totalAmount,
        totalPaid: totalPaid,
        totalDebt: totalDebt,
        waitingAmount: waitingAmount,
        waitingCount: waitingCount,
        collectionRate: Utils.percentOf(totalPaid, totalAmount),
        monthlyIncome: current.paid,
        monthlyExpected: current.amount,
        monthlyDebt: current.debt
      },
      monthly: monthly,
      byDistrict: _groupArray(byDistrict),
      byEngineer: _groupArray(byEngineer),
      byRegistrator: _groupArray(byRegistrator),
      pending: pending,
      comparison: _comparison(monthly)
    };
  }

  function _accMonth(map, key, amount, paid, debt) {
    if (!map[key]) map[key] = { period: key, amount: 0, paid: 0, debt: 0, count: 0 };
    map[key].amount += amount;
    map[key].paid += paid;
    map[key].debt += debt;
    map[key].count++;
  }

  function _accGroup(map, key, amount, paid, debt, waiting, waitingAmt) {
    if (!map[key]) map[key] = { name: key, amount: 0, paid: 0, debt: 0, count: 0, waitingCount: 0, waitingAmount: 0 };
    map[key].amount += amount;
    map[key].paid += paid;
    map[key].debt += debt;
    map[key].count++;
    if (waiting) { map[key].waitingCount++; map[key].waitingAmount += (waitingAmt || 0); }
  }

  /**
   * Oylik xaritani tartiblangan massivga aylantiradi.
   * @param {Object} map
   * @returns {Array<Object>}
   */
  function _monthArray(map) {
    var arr = [];
    for (var k in map) {
      if (map.hasOwnProperty(k)) {
        var m = map[k];
        m.collectionRate = Utils.percentOf(m.paid, m.amount);
        m.label = _monthLabel(k);
        arr.push(m);
      }
    }
    arr.sort(function (a, b) { return a.period < b.period ? -1 : 1; });
    return arr;
  }

  /**
   * Guruh xaritasini massivga aylantiradi (daromad bo'yicha tartiblangan).
   * @param {Object} map
   * @returns {Array<Object>}
   */
  function _groupArray(map) {
    var arr = [];
    for (var k in map) {
      if (map.hasOwnProperty(k)) {
        var g = map[k];
        g.collectionRate = Utils.percentOf(g.paid, g.amount);
        arr.push(g);
      }
    }
    arr.sort(function (a, b) { return b.paid - a.paid; });
    return arr;
  }

  /**
   * "yyyy-MM" ni o'zbekcha yorliqqa aylantiradi (Yanvar 2026).
   * @param {string} key
   * @returns {string}
   */
  function _monthLabel(key) {
    var parts = key.split('-');
    var y = parts[0];
    var m = parseInt(parts[1], 10) - 1;
    return (MONTH_NAMES_UZ[m] || parts[1]) + ' ' + y;
  }

  /**
   * Joriy va oldingi oyni taqqoslaydi.
   * @param {Array<Object>} monthly
   * @returns {Object}
   */
  function _comparison(monthly) {
    if (monthly.length === 0) {
      return { current: null, previous: null, growthPercent: 0 };
    }
    var current = monthly[monthly.length - 1];
    var previous = monthly.length > 1 ? monthly[monthly.length - 2] : null;
    var growth = 0;
    if (previous && previous.paid > 0) {
      growth = Math.round(((current.paid - previous.paid) / previous.paid) * 1000) / 10;
    }
    return { current: current, previous: previous, growthPercent: growth };
  }

  /**
   * Import vaqtida moliyaviy ma'lumotni qayta quradi va FINANCE varag'iga yozadi.
   * @param {Array<Object>} enriched
   * @returns {Object}
   */
  function rebuild(enriched) {
    var fin = compute(enriched);
    _writeFinanceSheet(fin);
    Cache.set(FIN_CACHE_KEY, fin, Config.value('cacheTtlSec', 1800));
    Cache.track(FIN_CACHE_KEY);
    return fin;
  }

  /**
   * FINANCE varag'iga oylik moliyaviy ko'rsatkichlarni yozadi.
   * @param {Object} fin
   */
  function _writeFinanceSheet(fin) {
    try {
      if (!Repository.exists(SHEETS.FINANCE)) {
        Repository.ss().insertSheet(SHEETS.FINANCE);
      }
      Repository.clearAll(SHEETS.FINANCE);
      var sh = Repository.sheet(SHEETS.FINANCE, true);
      var rows = [['DAVR', 'ARIZALAR', 'JAMI SUMMA', 'TO\'LANGAN', 'QARZ', 'YIG\'ILISH (%)']];
      for (var i = 0; i < fin.monthly.length; i++) {
        var m = fin.monthly[i];
        rows.push([m.label, m.count, m.amount, m.paid, m.debt, m.collectionRate]);
      }
      rows.push(['JAMI', '', fin.summary.totalAmount, fin.summary.totalPaid,
        fin.summary.totalDebt, fin.summary.collectionRate]);
      sh.getRange(1, 1, rows.length, 6).setValues(rows);
    } catch (e) {
      Logger.log('Finance._writeFinanceSheet xato: ' + e);
    }
  }

  /**
   * Joriy moliyaviy ma'lumotni keshdan yoki DATA'dan oladi.
   * @param {Array<Object>} [rows]
   * @returns {Object}
   */
  function getFinance(rows) {
    if (rows) return compute(rows);
    var cached = Cache.get(FIN_CACHE_KEY);
    if (cached) return cached;
    var all = Dashboard.loadAll();
    return rebuild(all);
  }

  return {
    compute: compute,
    rebuild: rebuild,
    getFinance: getFinance
  };
})();
