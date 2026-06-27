/**
 * ============================================================================
 * Dashboard.gs — Dashboard va ma'lumot so'rovlari xizmati (Data/Query Service)
 * ----------------------------------------------------------------------------
 * Bu modul UI uchun markaziy ma'lumot manbai:
 *   - DATA varag'ini o'qish va keshlash (loadAll)
 *   - Foydalanuvchi rolига qarab ko'rinish chegaralash (scopeFor) — server tomonda
 *   - Kaskad filtrlash va qidiruv (applyFilters / search)
 *   - Sahifalangan jadval (queryTable)
 *   - Dashboard vidjetlari va grafiklar (getDashboard)
 *   - DASHBOARD varag'iga snapshot yozish (refreshSnapshot)
 *
 * Barcha filtrlash va ruxsat tekshiruvi SERVER tomonida amalga oshiriladi.
 * ============================================================================
 */

var Dashboard = (function () {

  var DATA_CACHE_KEY = 'data::all';

  /**
   * DATA varag'idagi barcha yozuvlarni obyekt massivi sifatida o'qiydi (keshlanadi).
   * @returns {Array<Object>}
   */
  /**
   * DATA varag'idagi XOM yozuvlar (manba filtrisiz, keshlanadi).
   * @returns {Array<Object>}
   */
  function _loadRaw() {
    return Cache.remember(DATA_CACHE_KEY, function () {
      if (!Repository.exists(SHEETS.DATA)) return [];
      var parsed = Repository.readObjects(SHEETS.DATA);
      // Sarlavhalar DATA_COLUMNS bilan mos kelishini ta'minlash uchun normalizatsiya.
      return parsed.rows.map(_normalizeRecord);
    }, Config.value('cacheTtlSec', 1800));
  }

  /**
   * Hisobotga kiritiladigan yozuvlar. Agar ARIZA_MANBASI ro'yxati belgilangan
   * bo'lsa — FAQAT shu manbaalardan kelgan arizalar qaytadi (aks holda barchasi).
   * @returns {Array<Object>}
   */
  function loadAll() {
    var rows = _loadRaw();
    var allowed = null;
    try { allowed = DeadlineSettings.getAllowedSourceSet(); } catch (e) { allowed = null; }
    if (!allowed) return rows;
    return rows.filter(function (r) {
      return allowed[Utils.normalize(r.applicationSource)] === true;
    });
  }

  /** DATA'dagi barcha noyob "Ariza manbasi" qiymatlari (filtrlanmagan) — sozlama UI uchun. */
  function rawSources() {
    var rows = _loadRaw();
    var m = {};
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].applicationSource) m[rows[i].applicationSource] = true;
    }
    return Object.keys(m).sort();
  }

  /**
   * O'qilgan yozuvni standart tiplarga keltiradi.
   * @param {Object} r
   * @returns {Object}
   */
  function _normalizeRecord(r) {
    return {
      rowId: Utils.str(r.rowId),
      applicationNo: Utils.str(r.applicationNo),
      transactionNo: Utils.str(r.transactionNo),
      cadastreNo: Utils.str(r.cadastreNo),
      customer: Utils.str(r.customer),
      tin: Utils.str(r.tin),
      district: Utils.str(r.district),
      engineer: Utils.str(r.engineer),
      chiefEngineer: Utils.str(r.chiefEngineer),
      registrator: Utils.str(r.registrator),
      applicationType: Utils.str(r.applicationType),
      objectType: Utils.str(r.objectType),
      serviceCode: Utils.str(r.serviceCode),
      applicationSource: Utils.str(r.applicationSource),
      lastProcessRole: Utils.str(r.lastProcessRole),
      lastProcessName: Utils.str(r.lastProcessName),
      residency: Utils.str(r.residency),
      area: Utils.toNumber(r.area),
      registerDate: r.registerDate || '',
      deadlineDate: r.deadlineDate || '',
      completeDate: r.completeDate || '',
      issuedDate: r.issuedDate || '',
      issued: (r.issued === true || r.issued === 'true' || r.issued === 'TRUE'),
      status: Utils.str(r.status),
      deadlineStatus: Utils.str(r.deadlineStatus),
      remainingDays: Utils.toNumber(r.remainingDays),
      progressPercent: Utils.toNumber(r.progressPercent),
      colorStatus: Utils.str(r.colorStatus),
      amount: Utils.toNumber(r.amount),
      paidAmount: Utils.toNumber(r.paidAmount),
      debtAmount: Utils.toNumber(r.debtAmount),
      paymentStatus: Utils.str(r.paymentStatus),
      paymentDate: r.paymentDate || '',
      note: Utils.str(r.note),
      year: Utils.toNumber(r.year),
      month: Utils.toNumber(r.month)
    };
  }

  /**
   * Foydalanuvchi roliga ko'ra yozuvlarni chegaralaydi (server-side scope).
   * @param {Object} user {role, region, district, fullName, employeeId, username}
   * @param {Array<Object>} rows
   * @returns {Array<Object>}
   */
  function scopeFor(user, rows) {
    if (!user) return [];
    switch (user.role) {
      case ROLES.ADMIN:
        return rows;
      case ROLES.CHIEF:
      case ROLES.ENGINEER:
        // Bosh muhandis va kadastr muhandis — faqat o'z tumani.
        return rows.filter(function (r) {
          return Utils.normalize(r.district) === Utils.normalize(user.district);
        });
      default:
        return [];
    }
  }

  /**
   * Filtrlarni yozuvlarga qo'llaydi (kaskad + qidiruv).
   * @param {Array<Object>} rows
   * @param {Object} filters Validation.sanitizeFilters natijasi
   * @returns {Array<Object>}
   */
  function applyFilters(rows, filters) {
    if (!filters) return rows;
    var f = filters;
    var search = f.search ? Utils.normalize(f.search) : null;

    return rows.filter(function (r) {
      if (f.district && Utils.normalize(r.district) !== Utils.normalize(f.district)) return false;
      if (f.engineer && Utils.normalize(r.engineer) !== Utils.normalize(f.engineer)) return false;
      if (f.registrator && Utils.normalize(r.registrator) !== Utils.normalize(f.registrator)) return false;
      if (f.applicationType && Utils.normalize(r.applicationType) !== Utils.normalize(f.applicationType)) return false;
      if (f.objectType && Utils.normalize(r.objectType) !== Utils.normalize(f.objectType)) return false;
      if (f.lastProcessRole && Utils.normalize(r.lastProcessRole) !== Utils.normalize(f.lastProcessRole)) return false;
      if (f.lastProcessName && Utils.normalize(r.lastProcessName) !== Utils.normalize(f.lastProcessName)) return false;
      if (f.residency && r.residency !== f.residency) return false;
      if (f.status && r.status !== f.status) return false;
      if (f.deadlineStatus && r.deadlineStatus !== f.deadlineStatus) return false;
      if (f.paymentStatus && r.paymentStatus !== f.paymentStatus) return false;
      if (f.year && Utils.toNumber(r.year) !== f.year) return false;
      if (f.month && Utils.toNumber(r.month) !== f.month) return false;
      if (f.cadastreNo && Utils.str(r.cadastreNo).indexOf(f.cadastreNo) === -1) return false;
      if (f.transactionNo && Utils.str(r.transactionNo).indexOf(f.transactionNo) === -1) return false;
      if (f.applicationNo && Utils.str(r.applicationNo).indexOf(f.applicationNo) === -1) return false;
      if (f.tin && Utils.str(r.tin).indexOf(Utils.digitsOnly(f.tin)) === -1) return false;
      if (f.customer && Utils.normalize(r.customer).indexOf(Utils.normalize(f.customer)) === -1) return false;

      if (f.dateFrom || f.dateTo) {
        var d = Utils.toDate(r.registerDate);
        if (d) {
          var key = Utils.formatDate(d, 'yyyy-MM-dd');
          if (f.dateFrom && key < f.dateFrom) return false;
          if (f.dateTo && key > f.dateTo) return false;
        } else {
          return false;
        }
      }

      if (search) {
        var hay = Utils.normalize([
          r.applicationNo, r.transactionNo, r.cadastreNo, r.customer,
          r.tin, r.engineer, r.district
        ].join(' '));
        if (hay.indexOf(search) === -1) return false;
      }
      return true;
    });
  }

  /**
   * Foydalanuvchi ko'rishi mumkin bo'lgan, filtrlangan yozuvlarni qaytaradi.
   * @param {Object} user
   * @param {Object} filters
   * @returns {Array<Object>}
   */
  function scopedRows(user, filters) {
    var all = loadAll();
    var scoped = scopeFor(user, all);
    return applyFilters(scoped, filters);
  }

  /**
   * Sahifalangan jadval ma'lumotini qaytaradi (Virtual Table uchun).
   * @param {Object} user
   * @param {Object} rawFilters
   * @returns {{rows: Array, total: number, page: number, pageSize: number, pages: number}}
   */
  function queryTable(user, rawFilters) {
    var filters = Validation.sanitizeFilters(rawFilters);
    var rows = scopedRows(user, filters);

    // Saralash.
    if (filters.sortBy) {
      var key = filters.sortBy;
      var dir = filters.sortDir === 'desc' ? -1 : 1;
      rows.sort(function (a, b) {
        var av = a[key], bv = b[key];
        if (av == null) av = '';
        if (bv == null) bv = '';
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    }

    var total = rows.length;
    var pageSize = filters.pageSize;
    var pages = Math.max(1, Math.ceil(total / pageSize));
    var page = Math.min(filters.page, pages);
    var start = (page - 1) * pageSize;
    var pageRows = rows.slice(start, start + pageSize).map(_toDisplay);

    return {
      rows: pageRows,
      total: total,
      page: page,
      pageSize: pageSize,
      pages: pages
    };
  }

  /**
   * Yozuvni UI uchun ko'rsatish formatiga aylantiradi.
   * @param {Object} r
   * @returns {Object}
   */
  function _toDisplay(r) {
    return {
      rowId: r.rowId,
      applicationNo: r.applicationNo,
      transactionNo: r.transactionNo,
      cadastreNo: r.cadastreNo,
      customer: r.customer,
      tin: r.tin,
      district: r.district,
      engineer: r.engineer,
      registrator: r.registrator,
      applicationType: r.applicationType,
      objectType: r.objectType,
      lastProcessRole: r.lastProcessRole,
      lastProcessName: r.lastProcessName,
      residency: r.residency,
      residencyLabel: RESIDENCY_LABEL[r.residency] || '',
      registerDate: Utils.formatDate(r.registerDate),
      deadlineDate: Utils.formatDate(r.deadlineDate),
      completeDate: Utils.formatDate(r.completeDate),
      issuedDate: Utils.formatDate(r.issuedDate),
      issued: r.issued === true,
      status: r.status,
      deadlineStatus: r.deadlineStatus,
      deadlineStatusLabel: DEADLINE_STATUS_LABEL[r.deadlineStatus] || '',
      remainingDays: r.remainingDays,
      progressPercent: r.progressPercent,
      colorStatus: r.colorStatus,
      colorHex: COLOR_HEX[r.colorStatus] || '#9e9e9e',
      amount: r.amount,
      amountFmt: Utils.formatMoney(r.amount),
      paidAmount: r.paidAmount,
      paidFmt: Utils.formatMoney(r.paidAmount),
      debtAmount: r.debtAmount,
      debtFmt: Utils.formatMoney(r.debtAmount),
      paymentStatus: r.paymentStatus,
      paymentStatusLabel: PAYMENT_STATUS_LABEL[r.paymentStatus] || '',
      note: r.note
    };
  }

  /**
   * Tezkor qidiruv (indekslangan maydonlar bo'yicha).
   * @param {Object} user
   * @param {string} term
   * @param {number} [limit]
   * @returns {Array<Object>}
   */
  function search(user, term, limit) {
    var t = Utils.normalize(term);
    if (!t) return [];
    var rows = scopeFor(user, loadAll());
    var max = limit || 30;
    var out = [];
    for (var i = 0; i < rows.length && out.length < max; i++) {
      var r = rows[i];
      var hay = Utils.normalize([
        r.applicationNo, r.transactionNo, r.cadastreNo, r.customer, r.tin
      ].join(' '));
      if (hay.indexOf(t) !== -1) out.push(_toDisplay(r));
    }
    return out;
  }

  /**
   * Kaskad filtrlar uchun mavjud variantlarni qaytaradi (foydalanuvchi doirasida).
   * @param {Object} user
   * @returns {Object}
   */
  function filterOptions(user) {
    var rows = scopeFor(user, loadAll());
    var districts = {}, engineers = {}, types = {}, objectTypes = {};
    var years = {}, registrators = {}, procRoles = {}, procNames = {}, chiefEngineers = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.district) districts[r.district] = true;
      if (r.engineer) engineers[r.engineer] = (engineers[r.engineer] || r.district);
      if (r.chiefEngineer) chiefEngineers[r.chiefEngineer] = (chiefEngineers[r.chiefEngineer] || r.district);
      if (r.registrator) registrators[r.registrator] = (registrators[r.registrator] || r.district);
      if (r.applicationType) types[r.applicationType] = true;
      if (r.objectType) objectTypes[r.objectType] = true;
      if (r.lastProcessRole) procRoles[r.lastProcessRole] = true;
      if (r.lastProcessName) procNames[r.lastProcessName] = true;
      if (r.year) years[r.year] = true;
    }
    return {
      districts: Object.keys(districts).map(function (d) {
        return { name: d };
      }).sort(function (a, b) { return a.name.localeCompare(b.name); }),
      engineers: Object.keys(engineers).map(function (e) {
        return { name: e, district: engineers[e] };
      }).sort(function (a, b) { return a.name.localeCompare(b.name); }),
      chiefEngineers: Object.keys(chiefEngineers).map(function (e) {
        return { name: e, district: chiefEngineers[e] };
      }).sort(function (a, b) { return a.name.localeCompare(b.name); }),
      registrators: Object.keys(registrators).map(function (e) {
        return { name: e, district: registrators[e] };
      }).sort(function (a, b) { return a.name.localeCompare(b.name); }),
      applicationTypes: Object.keys(types).sort(),
      objectTypes: Object.keys(objectTypes).sort(),
      lastProcessRoles: Object.keys(procRoles).sort(),
      lastProcessNames: Object.keys(procNames).sort(),
      years: Object.keys(years).map(Number).sort(function (a, b) { return b - a; }),
      residencies: [
        { value: RESIDENCY.RESIDENTIAL, label: RESIDENCY_LABEL.RESIDENTIAL },
        { value: RESIDENCY.NON_RESIDENTIAL, label: RESIDENCY_LABEL.NON_RESIDENTIAL }
      ],
      deadlineStatuses: Object.keys(DEADLINE_STATUS_LABEL).map(function (k) {
        return { value: k, label: DEADLINE_STATUS_LABEL[k] };
      }),
      paymentStatuses: Object.keys(PAYMENT_STATUS_LABEL).map(function (k) {
        return { value: k, label: PAYMENT_STATUS_LABEL[k] };
      })
    };
  }

  /**
   * Dashboard uchun to'liq ma'lumot to'plamini qaytaradi (vidjetlar + grafiklar).
   * @param {Object} user
   * @param {Object} [rawFilters]
   * @returns {Object}
   */
  function getDashboard(user, rawFilters) {
    var filters = Validation.sanitizeFilters(rawFilters || {});
    var rows = scopedRows(user, filters);

    // Oylik standart ko'rinish: aniq davr (sana/yil/oy) tanlanmagan bo'lsa —
    // joriy oy 1-sanasidan boshlab kelgan arizalar + oldingi oylardan o'tgan
    // (jarayondagi arizalar va kutilayotgan/qisman to'lovlar).
    var period = 'Barcha davr';
    if (!filters.dateFrom && !filters.dateTo && !filters.year && !filters.month && !filters.search) {
      rows = _currentMonthScope(rows);
      period = _currentPeriodLabel();
    }

    var stats = Statistics.compute(rows);
    var fin = Finance.compute(rows);

    return {
      generatedAt: Utils.formatDateTime(new Date()),
      scope: { role: user.role, district: user.district || '', period: period },
      widgets: {
        total: stats.summary.total,
        completed: stats.summary.completed,
        inProgress: stats.summary.inProgress,
        expired: stats.summary.expired,
        dueToday: stats.summary.dueToday,
        waiting: stats.summary.waiting,
        paid: stats.summary.paid,
        residential: stats.summary.residential,
        nonResidential: stats.summary.nonResidential,
        completionRate: stats.summary.completionRate,
        monthlyIncome: fin.summary.monthlyIncome,
        monthlyIncomeFmt: Utils.formatMoney(fin.summary.monthlyIncome, true),
        totalPaid: fin.summary.totalPaid,
        totalPaidFmt: Utils.formatMoney(fin.summary.totalPaid, true),
        totalAmount: fin.summary.totalAmount,
        totalAmountFmt: Utils.formatMoney(fin.summary.totalAmount, true),
        totalDebt: fin.summary.totalDebt,
        totalDebtFmt: Utils.formatMoney(fin.summary.totalDebt, true),
        collectionRate: fin.summary.collectionRate
      },
      charts: {
        statusDistribution: [
          { label: 'Bajarilgan', value: stats.summary.completed, color: COLOR_HEX.GREEN },
          { label: 'Jarayonda', value: stats.summary.inProgress, color: COLOR_HEX.YELLOW },
          { label: 'Muddati o\'tgan', value: stats.summary.expired, color: COLOR_HEX.BLACK }
        ],
        residency: [
          { label: 'Turar joy', value: stats.summary.residential },
          { label: 'Noturar joy', value: stats.summary.nonResidential }
        ],
        payment: [
          { label: 'To\'langan', value: stats.summary.paid },
          { label: 'Qisman', value: stats.summary.partial },
          { label: 'Kutilmoqda', value: stats.summary.waiting },
          { label: 'To\'lanmagan', value: stats.summary.unpaid }
        ],
        monthlyTrend: fin.monthly.map(function (m) {
          return { label: m.label, applications: m.count, income: m.paid };
        }),
        topEngineers: stats.engineerRanking.slice(0, 10),
        topDistricts: stats.districtRanking.slice(0, 10)
      },
      rankings: {
        engineers: stats.engineerRanking.slice(0, 20),
        districts: stats.districtRanking.slice(0, 20)
      },
      finance: {
        comparison: fin.comparison,
        monthly: fin.monthly,
        byDistrict: fin.byDistrict.slice(0, 200),
        byEngineer: fin.byEngineer.slice(0, 1000),
        byRegistrator: fin.byRegistrator.slice(0, 1000)
      },
      recentActivities: _recentActivities(rows)
    };
  }

  /**
   * So'nggi faolликни (eng yangi arizalar) qaytaradi.
   * @param {Array<Object>} rows
   * @returns {Array<Object>}
   */
  /**
   * Joriy oy ko'rinishi: joriy oy 1-sanasidan kelgan arizalar, PLUS oldingi
   * oylardan "o'tib kelgan" ochiq ishlar (jarayondagi arizalar) va kutilayotgan/
   * qisman to'lovlar. Ko'rsatkichlar har oy 1-sanasida shu mantiq bo'yicha yangilanadi.
   * @param {Array<Object>} rows
   * @returns {Array<Object>}
   */
  function _currentMonthScope(rows) {
    var now = new Date();
    var startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return rows.filter(function (r) {
      var reg = Utils.toDate(r.registerDate);
      var inMonth = reg && Utils.startOfDay(reg).getTime() >= startOfMonth;
      var open = r.deadlineStatus !== DEADLINE_STATUS.COMPLETED;  // jarayondagi/o'tgan/bugun
      var pendingPay = r.paymentStatus === PAYMENT_STATUS.WAITING ||
        r.paymentStatus === PAYMENT_STATUS.PARTIAL;               // kutilayotgan to'lov
      return inMonth || open || pendingPay;
    });
  }

  /** Joriy davr yorlig'i (masalan, "Iyun 2026 (joriy oy)"). */
  function _currentPeriodLabel() {
    var now = new Date();
    return (MONTH_NAMES_UZ[now.getMonth()] || '') + ' ' + now.getFullYear() + ' (joriy oy)';
  }

  function _recentActivities(rows) {
    var sorted = rows.slice().sort(function (a, b) {
      var ad = Utils.toDate(a.registerDate);
      var bd = Utils.toDate(b.registerDate);
      var at = ad ? ad.getTime() : 0;
      var bt = bd ? bd.getTime() : 0;
      return bt - at;
    });
    return sorted.slice(0, 15).map(function (r) {
      return {
        applicationNo: r.transactionNo || r.applicationNo || r.cadastreNo,
        customer: r.customer,
        engineer: r.engineer,
        district: r.district,
        registerDate: Utils.formatDate(r.registerDate),
        deadlineStatus: r.deadlineStatus,
        deadlineStatusLabel: DEADLINE_STATUS_LABEL[r.deadlineStatus] || '',
        colorHex: COLOR_HEX[r.colorStatus] || '#9e9e9e'
      };
    });
  }

  /**
   * DASHBOARD varag'iga umumiy snapshot yozadi (import yakunida).
   * @param {Array<Object>} enriched
   */
  function refreshSnapshot(enriched) {
    try {
      var stats = Statistics.compute(enriched);
      var fin = Finance.compute(enriched);
      if (!Repository.exists(SHEETS.DASHBOARD)) {
        Repository.ss().insertSheet(SHEETS.DASHBOARD);
      }
      Repository.clearAll(SHEETS.DASHBOARD);
      var sh = Repository.sheet(SHEETS.DASHBOARD, true);
      var s = stats.summary;
      var rows = [
        ['DKP ARIZALAR NAZORATI — UMUMIY HOLAT', ''],
        ['Yangilangan', Utils.formatDateTime(new Date())],
        ['', ''],
        ['Jami arizalar', s.total],
        ['Bajarilgan', s.completed],
        ['Jarayonda', s.inProgress],
        ['Muddati o\'tgan', s.expired],
        ['Bugun tugaydi', s.dueToday],
        ['Turar joy', s.residential],
        ['Noturar joy', s.nonResidential],
        ['Bajarilish foizi (%)', s.completionRate],
        ['', ''],
        ['Jami summa', Utils.formatMoney(fin.summary.totalAmount, true)],
        ['Yig\'ilgan to\'lov', Utils.formatMoney(fin.summary.totalPaid, true)],
        ['Kutilayotgan to\'lov', Utils.formatMoney(fin.summary.totalDebt, true)],
        ['Joriy oy daromadi', Utils.formatMoney(fin.summary.monthlyIncome, true)]
      ];
      sh.getRange(1, 1, rows.length, 2).setValues(rows);
    } catch (e) {
      Logger.log('Dashboard.refreshSnapshot xato: ' + e);
    }
  }

  /** Ma'lumot keshini bekor qilish. */
  function invalidate() {
    Cache.remove(DATA_CACHE_KEY);
  }

  return {
    loadAll: loadAll,
    rawSources: rawSources,
    scopeFor: scopeFor,
    applyFilters: applyFilters,
    scopedRows: scopedRows,
    queryTable: queryTable,
    search: search,
    filterOptions: filterOptions,
    getDashboard: getDashboard,
    refreshSnapshot: refreshSnapshot,
    invalidate: invalidate
  };
})();
