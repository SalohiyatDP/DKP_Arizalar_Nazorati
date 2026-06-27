/**
 * ============================================================================
 * Reports.gs — Tayyor hisobotlar dvigateli
 * ----------------------------------------------------------------------------
 * Turli hisobot turlarini generatsiya qiladi (foydalanuvchi doirasida):
 *   - Muddati o'tgan arizalar
 *   - Bugun tugaydigan arizalar
 *   - Muhandis / Tuman / Viloyat hisoboti
 *   - Moliyaviy hisobot
 *   - Oylik hisobot
 *   - Samaradorlik (performance) hisoboti
 *   - To'lov hisoboti
 *   - Foydalanuvchi faolligi
 * ============================================================================
 */

var Reports = (function () {

  /**
   * Hisobot generatsiya qiluvchi dispetcher.
   * @param {Object} user
   * @param {string} type
   * @param {Object} filters
   * @returns {Object}
   */
  function generate(user, type, filters) {
    var rows = Dashboard.scopedRows(user, Validation.sanitizeFilters(filters || {}));
    AppLog.action(ACTION_TYPE.VIEW_REPORT, user.username, 'Hisobot: ' + type);

    switch (type) {
      case 'expired': return _expired(rows);
      case 'dueToday': return _dueToday(rows);
      case 'engineer': return _byGroup(rows, 'engineer', 'Muhandislar hisoboti');
      case 'district': return _byGroup(rows, 'district', 'Tumanlar hisoboti');
      case 'finance': return _finance(rows);
      case 'monthly': return _monthly(rows);
      case 'performance': return _performance(rows);
      case 'payment': return _payment(rows);
      default: return _summary(rows);
    }
  }

  /**
   * Sarlavha + qatorlardan iborat hisobot obyektini quradi.
   * @param {string} title
   * @param {Array<string>} columns
   * @param {Array<Array>} data
   * @param {Object} [meta]
   * @returns {Object}
   */
  function _report(title, columns, data, meta) {
    return {
      title: title,
      generatedAt: Utils.formatDateTime(new Date()),
      columns: columns,
      rows: data,
      total: data.length,
      meta: meta || {}
    };
  }

  /** Muddati o'tgan arizalar hisoboti. */
  function _expired(rows) {
    var data = rows
      .filter(function (r) { return r.deadlineStatus === DEADLINE_STATUS.EXPIRED; })
      .sort(function (a, b) { return a.remainingDays - b.remainingDays; })
      .map(function (r) {
        return [
          r.transactionNo || r.applicationNo || r.cadastreNo,
          r.district, r.engineer,
          Utils.formatDate(r.registerDate),
          Math.abs(r.remainingDays) + ' kun'
        ];
      });
    return _report('Muddati o\'tgan arizalar',
      ['Tranzaksiya raqami', 'Tuman', 'Muhandis', 'Ariza kelgan sana', 'Kechikish muddati'], data);
  }

  /** Bugun tugaydigan arizalar hisoboti. */
  function _dueToday(rows) {
    var data = rows
      .filter(function (r) { return r.deadlineStatus === DEADLINE_STATUS.DUE_TODAY; })
      .map(function (r) {
        return [
          r.transactionNo || r.applicationNo || r.cadastreNo,
          r.district, r.engineer,
          Utils.formatDate(r.registerDate),
          'Bugun'
        ];
      });
    return _report('Bugun tugaydigan arizalar',
      ['Tranzaksiya raqami', 'Tuman', 'Muhandis', 'Ariza kelgan sana', 'Kechikish muddati'], data);
  }

  /** Guruh (muhandis/tuman/viloyat) bo'yicha hisobot. */
  function _byGroup(rows, field, title) {
    var groups = Utils.groupBy(rows, function (r) { return r[field] || 'Noma\'lum'; });
    var data = [];
    for (var key in groups) {
      if (!groups.hasOwnProperty(key)) continue;
      var g = groups[key];
      var completed = 0, expired = 0, amount = 0, paid = 0;
      for (var i = 0; i < g.length; i++) {
        if (g[i].deadlineStatus === DEADLINE_STATUS.COMPLETED) completed++;
        if (g[i].deadlineStatus === DEADLINE_STATUS.EXPIRED) expired++;
        amount += Utils.toNumber(g[i].amount);
        paid += Utils.toNumber(g[i].paidAmount);
      }
      data.push([
        key, g.length, completed, expired,
        Utils.percentOf(completed, g.length) + '%',
        Utils.formatMoney(paid)
      ]);
    }
    data.sort(function (a, b) { return b[1] - a[1]; });
    return _report(title,
      ['Nomi', 'Jami', 'Bajarilgan', 'Muddati o\'tgan', 'Bajarilish %', 'To\'langan'],
      data);
  }

  /** Moliyaviy hisobot. */
  function _finance(rows) {
    var fin = Finance.compute(rows);
    var data = fin.monthly.map(function (m) {
      return [m.label, m.count, Utils.formatMoney(m.amount),
        Utils.formatMoney(m.paid), Utils.formatMoney(m.debt), m.collectionRate + '%'];
    });
    return _report('Moliyaviy hisobot',
      ['Davr', 'Arizalar', 'Jami summa', 'To\'langan', 'Qarz', 'Yig\'ilish %'],
      data, { summary: fin.summary });
  }

  /** Oylik hisobot. */
  function _monthly(rows) {
    var stats = Statistics.compute(rows);
    var data = [];
    for (var key in stats.byMonth) {
      if (!stats.byMonth.hasOwnProperty(key)) continue;
      var m = stats.byMonth[key];
      data.push([key, m.total, m.completed, m.expired,
        Utils.percentOf(m.completed, m.total) + '%']);
    }
    data.sort(function (a, b) { return a[0] < b[0] ? 1 : -1; });
    return _report('Oylik hisobot',
      ['Davr', 'Jami', 'Bajarilgan', 'Muddati o\'tgan', 'Bajarilish %'], data);
  }

  /** Samaradorlik (engineer ranking) hisoboti. */
  function _performance(rows) {
    var stats = Statistics.compute(rows);
    var data = stats.engineerRanking.map(function (e) {
      return [e.rank, e.name, e.total, e.completed, e.completionRate + '%', e.score];
    });
    return _report('Samaradorlik hisoboti',
      ['O\'rin', 'Muhandis', 'Jami', 'Bajarilgan', 'Bajarilish %', 'Ball'],
      data);
  }

  /** To'lov hisoboti. */
  function _payment(rows) {
    var data = rows
      .filter(function (r) {
        return r.paymentStatus === PAYMENT_STATUS.WAITING ||
          r.paymentStatus === PAYMENT_STATUS.PARTIAL;
      })
      .sort(function (a, b) { return b.debtAmount - a.debtAmount; })
      .map(function (r) {
        return [
          r.applicationNo || r.transactionNo || r.cadastreNo,
          r.customer, r.district,
          Utils.formatMoney(r.amount), Utils.formatMoney(r.paidAmount),
          Utils.formatMoney(r.debtAmount),
          PAYMENT_STATUS_LABEL[r.paymentStatus] || ''
        ];
      });
    return _report('To\'lov hisoboti',
      ['Ariza', 'Mijoz', 'Tuman', 'Summa', 'To\'langan', 'Qarz', 'Holat'], data);
  }

  /** Umumiy hisobot. */
  function _summary(rows) {
    var stats = Statistics.compute(rows);
    var s = stats.summary;
    var data = [
      ['Jami arizalar', s.total],
      ['Bajarilgan', s.completed],
      ['Jarayonda', s.inProgress],
      ['Muddati o\'tgan', s.expired],
      ['Turar joy', s.residential],
      ['Noturar joy', s.nonResidential],
      ['Bajarilish foizi', s.completionRate + '%'],
      ['O\'rtacha progress', s.avgProgress + '%']
    ];
    return _report('Umumiy hisobot', ['Ko\'rsatkich', 'Qiymat'], data);
  }

  return {
    generate: generate
  };
})();
