/**
 * ============================================================================
 * Statistics.gs — Statistik tahlil dvigateli
 * ----------------------------------------------------------------------------
 * DATA yozuvlaridan oldindan hisoblangan statistikani ishlab chiqaradi:
 *   - Umumiy ko'rsatkichlar (jami, bajarilgan, muddati o'tgan...)
 *   - Muhandis / Tuman / Viloyat reytinglari
 *   - Turar / Noturar joy taqsimoti
 *   - Oylik tendensiyalar
 * Natijalar STATISTICS varag'iga va keshga yoziladi (tez yetkazib berish uchun).
 * ============================================================================
 */

var Statistics = (function () {

  var STATS_CACHE_KEY = 'stats::summary';

  /**
   * Bo'sh statistik to'plovchini yaratadi.
   * @returns {Object}
   */
  function _emptyAccumulator() {
    return {
      total: 0,
      completed: 0,
      inProgress: 0,
      expired: 0,
      dueToday: 0,
      oneDay: 0,
      twoDays: 0,
      threeDays: 0,
      residential: 0,
      nonResidential: 0,
      paid: 0,
      partial: 0,
      waiting: 0,
      unpaid: 0,
      progressSum: 0
    };
  }

  /**
   * Berilgan yozuvlar massivi bo'yicha umumiy statistikani hisoblaydi.
   * @param {Array<Object>} rows
   * @returns {Object}
   */
  function compute(rows) {
    var acc = _emptyAccumulator();
    var byEngineer = {};
    var byDistrict = {};
    var byRegion = {};
    var byType = {};
    var byMonth = {};

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      acc.total++;

      switch (r.deadlineStatus) {
        case DEADLINE_STATUS.COMPLETED: acc.completed++; break;
        case DEADLINE_STATUS.EXPIRED: acc.expired++; break;
        case DEADLINE_STATUS.DUE_TODAY: acc.dueToday++; acc.inProgress++; break;
        case DEADLINE_STATUS.ONE_DAY: acc.oneDay++; acc.inProgress++; break;
        case DEADLINE_STATUS.TWO_DAYS: acc.twoDays++; acc.inProgress++; break;
        case DEADLINE_STATUS.THREE_DAYS: acc.threeDays++; acc.inProgress++; break;
        default: acc.inProgress++; break;
      }

      if (r.residency === RESIDENCY.RESIDENTIAL) acc.residential++;
      else if (r.residency === RESIDENCY.NON_RESIDENTIAL) acc.nonResidential++;

      switch (r.paymentStatus) {
        case PAYMENT_STATUS.PAID: acc.paid++; break;
        case PAYMENT_STATUS.PARTIAL: acc.partial++; break;
        case PAYMENT_STATUS.WAITING: acc.waiting++; break;
        default: acc.unpaid++; break;
      }

      acc.progressSum += Utils.toNumber(r.progressPercent);

      _bump(byEngineer, r.engineer || 'Noma\'lum', r);
      _bump(byDistrict, r.district || 'Noma\'lum', r);
      _bump(byRegion, r.region || 'Noma\'lum', r);

      var typeKey = r.applicationType || 'Boshqa';
      byType[typeKey] = (byType[typeKey] || 0) + 1;

      var mKey = r.year + '-' + ('0' + r.month).slice(-2);
      if (!byMonth[mKey]) byMonth[mKey] = { total: 0, completed: 0, expired: 0 };
      byMonth[mKey].total++;
      if (r.deadlineStatus === DEADLINE_STATUS.COMPLETED) byMonth[mKey].completed++;
      if (r.deadlineStatus === DEADLINE_STATUS.EXPIRED) byMonth[mKey].expired++;
    }

    return {
      summary: {
        total: acc.total,
        completed: acc.completed,
        inProgress: acc.inProgress,
        expired: acc.expired,
        dueToday: acc.dueToday,
        oneDay: acc.oneDay,
        twoDays: acc.twoDays,
        threeDays: acc.threeDays,
        residential: acc.residential,
        nonResidential: acc.nonResidential,
        paid: acc.paid,
        partial: acc.partial,
        waiting: acc.waiting,
        unpaid: acc.unpaid,
        completionRate: Utils.percentOf(acc.completed, acc.total),
        expiredRate: Utils.percentOf(acc.expired, acc.total),
        avgProgress: Math.round(Utils.safeDivide(acc.progressSum, acc.total) * 10) / 10
      },
      engineerRanking: _ranking(byEngineer),
      districtRanking: _ranking(byDistrict),
      regionRanking: _ranking(byRegion),
      byType: byType,
      byMonth: byMonth
    };
  }

  /**
   * Guruh hisoblagichini oshiradi.
   * @param {Object} map
   * @param {string} key
   * @param {Object} r
   */
  function _bump(map, key, r) {
    if (!map[key]) {
      map[key] = { name: key, total: 0, completed: 0, expired: 0, amount: 0, paid: 0 };
    }
    var g = map[key];
    g.total++;
    if (r.deadlineStatus === DEADLINE_STATUS.COMPLETED) g.completed++;
    if (r.deadlineStatus === DEADLINE_STATUS.EXPIRED) g.expired++;
    g.amount += Utils.toNumber(r.amount);
    g.paid += Utils.toNumber(r.paidAmount);
  }

  /**
   * Guruhlar xaritasini reyting massiviga aylantiradi (SLA va bajarilish bo'yicha).
   * @param {Object} map
   * @returns {Array<Object>}
   */
  function _ranking(map) {
    var arr = [];
    for (var k in map) {
      if (!map.hasOwnProperty(k)) continue;
      var g = map[k];
      arr.push({
        name: g.name,
        total: g.total,
        completed: g.completed,
        expired: g.expired,
        completionRate: Utils.percentOf(g.completed, g.total),
        amount: g.amount,
        paid: g.paid,
        score: 0
      });
    }
    // Reyting bali: bajarilish foizi - muddati o'tganlar jarimasi.
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i];
      e.score = Math.round(
        e.completionRate - (Utils.percentOf(e.expired, e.total) * 0.5)
      );
    }
    arr.sort(function (a, b) { return b.score - a.score || b.total - a.total; });
    for (var j = 0; j < arr.length; j++) arr[j].rank = j + 1;
    return arr;
  }

  /**
   * Import vaqtida statistikani qayta quradi va STATISTICS varag'iga yozadi.
   * @param {Array<Object>} enriched
   */
  function rebuild(enriched) {
    var stats = compute(enriched);
    _writeStatsSheet(stats);
    Cache.set(STATS_CACHE_KEY, stats, Config.value('cacheTtlSec', 1800));
    Cache.track(STATS_CACHE_KEY);
    return stats;
  }

  /**
   * STATISTICS varag'iga umumiy ko'rsatkichlarni va reytinglarni yozadi.
   * @param {Object} stats
   */
  function _writeStatsSheet(stats) {
    try {
      if (!Repository.exists(SHEETS.STATISTICS)) {
        Repository.ss().insertSheet(SHEETS.STATISTICS);
      }
      Repository.clearAll(SHEETS.STATISTICS);
      var sh = Repository.sheet(SHEETS.STATISTICS, true);
      var rows = [['KO\'RSATKICH', 'QIYMAT']];
      var s = stats.summary;
      rows.push(['Jami arizalar', s.total]);
      rows.push(['Bajarilgan', s.completed]);
      rows.push(['Jarayonda', s.inProgress]);
      rows.push(['Muddati o\'tgan', s.expired]);
      rows.push(['Bugun tugaydi', s.dueToday]);
      rows.push(['Turar joy', s.residential]);
      rows.push(['Noturar joy', s.nonResidential]);
      rows.push(['To\'langan', s.paid]);
      rows.push(['To\'lov kutilmoqda', s.waiting]);
      rows.push(['Bajarilish foizi (%)', s.completionRate]);
      rows.push(['Yangilangan', Utils.formatDateTime(new Date())]);
      sh.getRange(1, 1, rows.length, 2).setValues(rows);
    } catch (e) {
      Logger.log('Statistics._writeStatsSheet xato: ' + e);
    }
  }

  /**
   * Joriy statistikani keshdan yoki DATA'dan oladi.
   * @param {Array<Object>} [rows] Berilsa, shu massivdan hisoblanadi (filtrlangan)
   * @returns {Object}
   */
  function getStats(rows) {
    if (rows) return compute(rows);
    var cached = Cache.get(STATS_CACHE_KEY);
    if (cached) return cached;
    var all = Dashboard.loadAll();
    return rebuild(all);
  }

  /**
   * Oylik snapshotni MONTHLY_STATS varag'iga saqlaydi (tarixiy taqqoslash uchun).
   * @param {Array<Object>} enriched
   */
  function saveMonthlySnapshot(enriched) {
    try {
      var stats = compute(enriched);
      var s = stats.summary;
      var period = Utilities.formatDate(new Date(),
        Config.value('timeZone', 'Asia/Tashkent'), 'yyyy-MM');
      var snapshotDate = Utils.formatDateTime(new Date());

      if (!Repository.exists(SHEETS.MONTHLY_STATS)) {
        Repository.ss().insertSheet(SHEETS.MONTHLY_STATS);
        Repository.writeHeaders(SHEETS.MONTHLY_STATS, [
          'PERIOD', 'SNAPSHOT_DATE', 'TOTAL', 'COMPLETED', 'EXPIRED', 'IN_PROGRESS',
          'PAID', 'WAITING', 'COMPLETION_RATE'
        ]);
      }
      Repository.appendRow(SHEETS.MONTHLY_STATS, [
        period, snapshotDate, s.total, s.completed, s.expired, s.inProgress,
        s.paid, s.waiting, s.completionRate
      ]);
    } catch (e) {
      Logger.log('Statistics.saveMonthlySnapshot xato: ' + e);
    }
  }

  /**
   * Tarixiy snapshotlarni o'qiydi (taqqoslash uchun).
   * @returns {Array<Object>}
   */
  function getHistory() {
    if (!Repository.exists(SHEETS.MONTHLY_STATS)) return [];
    var parsed = Repository.readObjects(SHEETS.MONTHLY_STATS);
    return parsed.rows.map(function (r) {
      return {
        period: r.PERIOD,
        snapshotDate: r.SNAPSHOT_DATE,
        total: Utils.toNumber(r.TOTAL),
        completed: Utils.toNumber(r.COMPLETED),
        expired: Utils.toNumber(r.EXPIRED),
        completionRate: Utils.toNumber(r.COMPLETION_RATE)
      };
    });
  }

  return {
    compute: compute,
    rebuild: rebuild,
    getStats: getStats,
    saveMonthlySnapshot: saveMonthlySnapshot,
    getHistory: getHistory
  };
})();
