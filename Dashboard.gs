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
   * Yozuvlarni TO'G'RIDAN-TO'G'RI HISOBOT varag'idan o'qiydi va jonli boyitadi.
   * DATA varag'iga ko'chirish (round-trip) YO'Q — HISOBOT yagona manba.
   * Sarlavhalar dinamik (header nomi) bo'yicha moslanadi; indeks hardcode emas.
   * @returns {Array<Object>}
   */
  function _loadRaw() {
    return Cache.remember(DATA_CACHE_KEY, function () {
      if (!Repository.exists(SHEETS.HISOBOT)) return [];
      var parsed = Repository.readObjects(SHEETS.HISOBOT, Repository.hisobotHeaderMapper);
      if (!parsed.rows.length) return [];
      // Xom HISOBOT qatorlarini boyitilgan yozuvlarga aylantiramiz (summa, muddat,
      // holat, residency... shu yerda jonli hisoblanadi — DATA varag'i kerak emas).
      return BusinessLogic.enrichAll(parsed.rows, { today: new Date() });
    }, Config.value('shortCacheTtlSec', 300));
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
      arizaCadastreNo: Utils.str(r.arizaCadastreNo),
      customer: Utils.str(r.customer),
      owner: Utils.str(r.owner),
      phone: Utils.str(r.phone),
      district: Utils.str(r.district),
      mahallaCode: Utils.str(r.mahallaCode),
      mahallaName: Utils.str(r.mahallaName),
      engineer: Utils.str(r.engineer),
      chiefEngineer: Utils.str(r.chiefEngineer),
      registrator: Utils.str(r.registrator),
      applicationType: Utils.str(r.applicationType),
      applicationPurpose: Utils.str(r.applicationPurpose),
      objectType: Utils.str(r.objectType),
      objectType2: Utils.str(r.objectType2),
      objectSubdivision: Utils.str(r.objectSubdivision),
      serviceCode: Utils.str(r.serviceCode),
      priznak: Utils.str(r.priznak),
      applicationSource: Utils.str(r.applicationSource),
      socialProtection: Utils.str(r.socialProtection),
      lastProcessRole: Utils.str(r.lastProcessRole),
      lastProcessName: Utils.str(r.lastProcessName),
      rejectReason: Utils.str(r.rejectReason),
      cadastrePassportType: Utils.str(r.cadastrePassportType),
      registrationType: Utils.str(r.registrationType),
      buildingOrLand: Utils.str(r.buildingOrLand),
      addressAssignment: Utils.str(r.addressAssignment),
      buildingArea: Utils.toNumber(r.buildingArea),
      externalArea: Utils.toNumber(r.externalArea),
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
      if (f.mahallaName && Utils.normalize(r.mahallaName).indexOf(Utils.normalize(f.mahallaName)) === -1) return false;
      if (f.applicationPurpose && Utils.normalize(r.applicationPurpose) !== Utils.normalize(f.applicationPurpose)) return false;
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
          r.owner, r.engineer, r.district, r.mahallaName
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
      arizaCadastreNo: r.arizaCadastreNo,
      customer: r.customer,
      owner: r.owner,
      phone: r.phone,
      district: r.district,
      mahallaName: r.mahallaName,
      engineer: r.engineer,
      chiefEngineer: r.chiefEngineer,
      registrator: r.registrator,
      applicationType: r.applicationType,
      applicationPurpose: r.applicationPurpose,
      objectType: r.objectType,
      objectType2: r.objectType2,
      objectSubdivision: r.objectSubdivision,
      socialProtection: r.socialProtection,
      registrationType: r.registrationType,
      buildingOrLand: r.buildingOrLand,
      buildingArea: r.buildingArea,
      externalArea: r.externalArea,
      lastProcessRole: r.lastProcessRole,
      lastProcessName: r.lastProcessName,
      rejectReason: r.rejectReason,
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
        r.applicationNo, r.transactionNo, r.cadastreNo, r.customer, r.owner
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
    var years = {}, registrators = {}, procRoles = {}, procNames = {}, chiefEngineers = {}, purposes = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.district) districts[r.district] = true;
      if (r.engineer) engineers[r.engineer] = (engineers[r.engineer] || r.district);
      if (r.chiefEngineer) chiefEngineers[r.chiefEngineer] = (chiefEngineers[r.chiefEngineer] || r.district);
      if (r.registrator) registrators[r.registrator] = (registrators[r.registrator] || r.district);
      if (r.applicationType) types[r.applicationType] = true;
      if (r.applicationPurpose) purposes[r.applicationPurpose] = true;
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
      applicationPurposes: Object.keys(purposes).sort(),
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
    // Rol + aniq filtrlar bo'yicha barcha yozuvlar (kümülativ — moliya shundan hisoblanadi).
    var roleRows = scopedRows(user, filters);

    // Arizalar ko'rsatkichlari uchun joriy oy ko'rinishi (aniq davr tanlanmagan bo'lsa).
    var viewRows = roleRows;
    var period = 'Barcha davr';
    if (!filters.dateFrom && !filters.dateTo && !filters.year && !filters.month && !filters.search) {
      viewRows = _currentMonthScope(roleRows);
      period = _currentPeriodLabel();
    }

    var stats = Statistics.compute(viewRows);   // arizalar holati — joriy oy
    // MUHIM: moliya KÜMÜLATIV — to'lovlar oylar davomida to'planib boradi,
    // shuning uchun oylik filtr qo'llanmaydi (aks holda eski to'lovlar 0 ko'rinardi).
    var fin = Finance.compute(roleRows);

    // Faol manba filtri (agar bo'lsa) — UI'da ogohlantirish ko'rsatish uchun.
    var srcFilter = [];
    try { srcFilter = DeadlineSettings.getAllowedSources(); } catch (e) { srcFilter = []; }

    return {
      generatedAt: Utils.formatDateTime(new Date()),
      scope: { role: user.role, district: user.district || '', period: period, sources: srcFilter },
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
        inProgressResidential: stats.summary.inProgressResidential,
        inProgressNonResidential: stats.summary.inProgressNonResidential,
        rejected: stats.summary.rejected,
        completionRate: stats.summary.completionRate,
        monthlyIncome: fin.summary.monthlyIncome,
        monthlyIncomeFmt: Utils.formatMoney(fin.summary.monthlyIncome, true),
        totalPaid: fin.summary.totalPaid,
        totalPaidFmt: Utils.formatMoney(fin.summary.totalPaid, true),
        totalAmount: fin.summary.totalAmount,
        totalAmountFmt: Utils.formatMoney(fin.summary.totalAmount, true),
        totalDebt: fin.summary.totalDebt,
        totalDebtFmt: Utils.formatMoney(fin.summary.totalDebt, true),
        waitingAmount: fin.summary.waitingAmount,
        waitingAmountFmt: Utils.formatMoney(fin.summary.waitingAmount, true),
        waitingCount: fin.summary.waitingCount,
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
        byRegistrator: fin.byRegistrator.slice(0, 1000),
        pending: fin.pending.slice(0, 3000)
      },
      recentActivities: _recentActivities(viewRows),
      summaryTable: _buildSummaryTable(roleRows)
    };
  }

  /**
   * Tuman kesimidagi SVOD jadvali (boshqaruv paneli ostida ko'rsatiladi).
   *
   * Excel mantig'i (skrinshotlar bilan tasdiqlangan):
   *   "Jami yakunlash kerak" = BUGUN muddati tugaydigan + MUDDATI O'TGAN
   *      (ya'ni muddati <= bugun bo'lgan, hali yakunlanmagan arizalar).
   *      Kelajakda muddati keladigan arizalar BUNGA KIRMAYDI.
   *   "Muddati o'tgan" = Filial tomonida o'tgan + Registratsiya tomonidan o'tgan.
   *   Turar + Noturar = Jami (shu to'plam ichida).
   *   Rollar kesmi ham shu "Jami" to'plami ichida (lastProcessName bo'yicha).
   *   "Muddat buzilishini oldini olish" (1..>10 kun qolgan) = ALOHIDA to'plam:
   *      kelajakda muddati keladigan (hali ulgurish mumkin) arizalar.
   *
   * @param {Array<Object>} rows  Rol bo'yicha cheklangan (butun davr) yozuvlar
   * @returns {{roleColumns: Array<string>, rows: Array<Object>, totals: Object}}
   */
  function _buildSummaryTable(rows) {
    function blank(name) {
      return {
        district: name, total: 0,
        expiredBranch: 0, expiredReg: 0, dueToday: 0,
        residential: 0, nonResidential: 0, roles: {},
        d1: 0, d2: 0, d3: 0, d4: 0, d5: 0, d6_10: 0, d10p: 0
      };
    }
    var roleSet = {};
    var byDistrict = {};
    var totals = blank('JAMI');

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var ds = r.deadlineStatus;
      if (ds === DEADLINE_STATUS.COMPLETED) continue;   // yakunlangan — chiqarib tashlanadi

      var dk = r.district || 'Noma\'lum';
      if (!byDistrict[dk]) byDistrict[dk] = blank(dk);
      var g = byDistrict[dk];

      if (ds === DEADLINE_STATUS.DUE_TODAY || ds === DEADLINE_STATUS.EXPIRED) {
        // --- "Jami yakunlash kerak" to'plami (muddati bugun yoki o'tgan) ---
        g.total++; totals.total++;

        if (r.residency === RESIDENCY.RESIDENTIAL) { g.residential++; totals.residential++; }
        else if (r.residency === RESIDENCY.NON_RESIDENTIAL) { g.nonResidential++; totals.nonResidential++; }

        if (ds === DEADLINE_STATUS.DUE_TODAY) {
          g.dueToday++; totals.dueToday++;
        } else { // EXPIRED — joriy bosqichga qarab Filial yoki Registratsiya tomonida
          if (_isRegistrationStage(r)) { g.expiredReg++; totals.expiredReg++; }
          else { g.expiredBranch++; totals.expiredBranch++; }
        }

        // Jarayonda turgan rol (oxirgi jarayon nomi) kesimi — dinamik ustunlar.
        var role = Utils.str(r.lastProcessName) || 'Aniqlanmagan';
        roleSet[role] = true;
        g.roles[role] = (g.roles[role] || 0) + 1;
        totals.roles[role] = (totals.roles[role] || 0) + 1;

      } else {
        // --- Kelajakda muddati keladigan arizalar (oldini olish tahlili) ---
        var rem = Utils.toNumber(r.remainingDays);
        if (rem === 1) { g.d1++; totals.d1++; }
        else if (rem === 2) { g.d2++; totals.d2++; }
        else if (rem === 3) { g.d3++; totals.d3++; }
        else if (rem === 4) { g.d4++; totals.d4++; }
        else if (rem === 5) { g.d5++; totals.d5++; }
        else if (rem >= 6 && rem <= 10) { g.d6_10++; totals.d6_10++; }
        else if (rem > 10) { g.d10p++; totals.d10p++; }
      }
    }

    // Rol ustunlarini umumiy soni bo'yicha kamayuvchi tartibda (eng band rollar oldinda).
    var roleColumns = Object.keys(roleSet).sort(function (a, b) {
      return (totals.roles[b] || 0) - (totals.roles[a] || 0) || a.localeCompare(b);
    });

    // Tartiblash: eng ko'p "yakunlash kerak" bo'lgan tuman oldinda; ish bo'lmasa,
    // kelajak yuki bo'yicha (d-buketlar) ham hisobga olinadi.
    var list = Object.keys(byDistrict).map(function (k) { return byDistrict[k]; })
      .sort(function (a, b) {
        return b.total - a.total ||
          (b.d1 + b.d2 + b.d3 + b.d4 + b.d5 + b.d6_10 + b.d10p) -
          (a.d1 + a.d2 + a.d3 + a.d4 + a.d5 + a.d6_10 + a.d10p) ||
          a.district.localeCompare(b.district);
      });

    return { roleColumns: roleColumns, rows: list, totals: totals };
  }

  /**
   * Ariza joriy bosqichda REGISTRATSIYA tomonidami (aks holda filial tomonida)?
   * Oxirgi jarayon nomi / roli bo'yicha kalit so'zlar orqali aniqlanadi
   * (lotin va kirill variantlari). Heuristika — kerak bo'lsa sozlanadi.
   * @param {Object} r
   * @returns {boolean}
   */
  function _isRegistrationStage(r) {
    var s = Utils.normalize(Utils.str(r.lastProcessName) + ' ' + Utils.str(r.lastProcessRole));
    s = s.replace(/['\u02bb\u02bc`\u2019\u2018]/g, '');   // apostroflarni olib tashlash
    var keys = ['регистр', 'руйхат', 'рўйхат', 'ройхат', 'утказувч', 'ўтказувч',
      'registr', 'royxat', 'otkazuvch'];
    for (var i = 0; i < keys.length; i++) {
      if (s.indexOf(keys[i]) !== -1) return true;
    }
    return false;
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

  /**
   * MUDDAT NAZORATI — admin/bosh muhandis/muhandis uchun muddat holati monitoringi.
   * Ochiq arizalarni toifalarga ajratadi va har biri qaysi bosqichda (kimda)
   * turganini ko'rsatadi. Muhandis roli — faqat o'ziga biriktirilgan arizalar.
   * @param {Object} user
   * @param {Object} [rawFilters]
   * @returns {Object}
   */
  function deadlineControl(user, rawFilters) {
    var filters = Validation.sanitizeFilters(rawFilters || {});
    var rows = scopedRows(user, filters);

    // Kadastr muhandisi — faqat o'ziga biriktirilgan arizalar.
    if (user.role === ROLES.ENGINEER && user.fullName) {
      var me = Utils.normalize(user.fullName);
      var own = rows.filter(function (r) { return Utils.normalize(r.engineer) === me; });
      if (own.length) rows = own;   // mos kelsa — faqat o'ziniki; aks holda tuman doirasi
    }

    function item(r) {
      return {
        transactionNo: Utils.str(r.transactionNo),
        applicationNo: Utils.str(r.applicationNo),
        cadastreNo: Utils.str(r.cadastreNo),
        customer: Utils.str(r.customer),
        owner: Utils.str(r.owner),
        phone: Utils.str(r.phone),
        district: Utils.str(r.district),
        engineer: Utils.str(r.engineer),
        chiefEngineer: Utils.str(r.chiefEngineer),
        stage: Utils.str(r.lastProcessName) || 'Aniqlanmagan',
        stageRole: Utils.str(r.lastProcessRole),
        deadlineDate: Utils.formatDate(r.deadlineDate),
        remainingDays: Utils.toNumber(r.remainingDays)
      };
    }

    var cats = {
      overdue: [], today: [], tomorrow: [], dayAfter: [], notAccepted: []
    };
    var CAP = 4000;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.deadlineStatus === DEADLINE_STATUS.COMPLETED) continue;  // ochiq emas

      var notAccepted = _isNotAccepted(r);
      if (notAccepted && cats.notAccepted.length < CAP) cats.notAccepted.push(item(r));

      if (r.deadlineStatus === DEADLINE_STATUS.EXPIRED) {
        if (cats.overdue.length < CAP) cats.overdue.push(item(r));
      } else if (r.deadlineStatus === DEADLINE_STATUS.DUE_TODAY) {
        if (cats.today.length < CAP) cats.today.push(item(r));
      } else {
        var rem = Utils.toNumber(r.remainingDays);
        if (rem === 1 && cats.tomorrow.length < CAP) cats.tomorrow.push(item(r));
        else if (rem === 2 && cats.dayAfter.length < CAP) cats.dayAfter.push(item(r));
      }
    }

    // Har toifa bo'yicha "hozir kimda" (bosqich) kesimi.
    function roleBreak(list) {
      var m = {};
      for (var j = 0; j < list.length; j++) {
        var k = list[j].stage || 'Aniqlanmagan';
        m[k] = (m[k] || 0) + 1;
      }
      return Object.keys(m).map(function (k) { return { stage: k, count: m[k] }; })
        .sort(function (a, b) { return b.count - a.count; });
    }

    return {
      generatedAt: Utils.formatDateTime(new Date()),
      scope: { role: user.role, district: user.district || '', engineer: (user.role === ROLES.ENGINEER ? (user.fullName || '') : '') },
      counts: {
        overdue: cats.overdue.length,
        today: cats.today.length,
        tomorrow: cats.tomorrow.length,
        dayAfter: cats.dayAfter.length,
        notAccepted: cats.notAccepted.length
      },
      breakdown: {
        overdue: roleBreak(cats.overdue),
        today: roleBreak(cats.today),
        tomorrow: roleBreak(cats.tomorrow),
        dayAfter: roleBreak(cats.dayAfter),
        notAccepted: roleBreak(cats.notAccepted)
      },
      lists: cats
    };
  }

  /**
   * Ariza ijroga qabul qilinmaganmi? (ijrochi muhandis biriktirilmagan yoki
   * jarayon nomi "qabul qilinmagan"ni bildiradi). Heuristika — sozlanadi.
   * @param {Object} r
   * @returns {boolean}
   */
  function _isNotAccepted(r) {
    if (!Utils.str(r.engineer)) return true;   // ijrochi biriktirilmagan
    var s = Utils.normalize(Utils.str(r.lastProcessName) + ' ' + Utils.str(r.lastProcessRole))
      .replace(/['\u02bb\u02bc`\u2019\u2018]/g, '');
    return s.indexOf('ijroga qabul qilinmagan') !== -1 ||
      s.indexOf('qabul qilinmagan') !== -1 ||
      s.indexOf('ижрога кабул') !== -1 ||
      s.indexOf('кабул килинмаган') !== -1;
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
    deadlineControl: deadlineControl,
    refreshSnapshot: refreshSnapshot,
    invalidate: invalidate
  };
})();
