/**
 * ============================================================================
 * Validation.gs — Kirish ma'lumotlarini tekshirish qatlami
 * ----------------------------------------------------------------------------
 * Foydalanuvchi va import ma'lumotlarini server tomonida tekshiradi.
 * Frontend'ga hech qachon ishonilmaydi.
 * ============================================================================
 */

var Validation = (function () {

  /**
   * Tekshiruv natijasi obyekti.
   * @param {boolean} ok
   * @param {Array<string>} [errors]
   * @returns {{ok: boolean, errors: Array<string>}}
   */
  function result(ok, errors) {
    return { ok: ok, errors: errors || [] };
  }

  /**
   * Qiymat bo'sh emasligini tekshiradi.
   * @param {*} v
   * @returns {boolean}
   */
  function required(v) {
    return v !== null && v !== undefined && Utils.str(v) !== '';
  }

  /**
   * PNFL (JSHSHIR) — 14 raqam.
   * @param {*} v
   * @returns {boolean}
   */
  function isPnfl(v) {
    var d = Utils.digitsOnly(v);
    return d.length === 14;
  }

  /**
   * STIR (TIN) — 9 raqam.
   * @param {*} v
   * @returns {boolean}
   */
  function isTin(v) {
    var d = Utils.digitsOnly(v);
    return d.length === 9;
  }

  /**
   * Email formati.
   * @param {*} v
   * @returns {boolean}
   */
  function isEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(Utils.str(v));
  }

  /**
   * Foydalanuvchi nomi: 3-32 belgi, harf/raqam/nuqta/pastki chiziq.
   * @param {*} v
   * @returns {boolean}
   */
  function isUsername(v) {
    return /^[a-zA-Z0-9._-]{3,32}$/.test(Utils.str(v));
  }

  /**
   * Parol siyosatini tekshirish.
   * @param {string} password
   * @returns {{ok: boolean, errors: Array<string>}}
   */
  function validatePassword(password) {
    var errors = [];
    var minLen = Config.value('passwordMinLength', 8);
    var p = Utils.str(password);
    if (p.length < minLen) {
      errors.push('Parol kamida ' + minLen + ' belgidan iborat bo\'lishi kerak.');
    }
    if (!/[A-Za-z]/.test(p)) {
      errors.push('Parolda kamida bitta harf bo\'lishi kerak.');
    }
    if (!/[0-9]/.test(p)) {
      errors.push('Parolda kamida bitta raqam bo\'lishi kerak.');
    }
    return result(errors.length === 0, errors);
  }

  /**
   * Login so'rovini tekshirish.
   * @param {Object} payload {username, password}
   * @returns {{ok: boolean, errors: Array<string>}}
   */
  function validateLogin(payload) {
    var errors = [];
    payload = payload || {};
    if (!required(payload.username)) errors.push('Foydalanuvchi nomi kiritilmadi.');
    if (!required(payload.password)) errors.push('Parol kiritilmadi.');
    return result(errors.length === 0, errors);
  }

  /**
   * Yangi foydalanuvchi ma'lumotlarini tekshirish.
   * @param {Object} user
   * @returns {{ok: boolean, errors: Array<string>}}
   */
  function validateUser(user) {
    var errors = [];
    user = user || {};
    if (!isUsername(user.username)) {
      errors.push('Foydalanuvchi nomi noto\'g\'ri (3-32 belgi, faqat harf/raqam).');
    }
    if (!ROLES[user.role]) {
      errors.push('Rol noto\'g\'ri tanlangan.');
    }
    if (user.role === ROLES.REGION && !required(user.region)) {
      errors.push('Viloyat roli uchun viloyat ko\'rsatilishi shart.');
    }
    if (user.role === ROLES.DISTRICT && !required(user.district)) {
      errors.push('Tuman roli uchun tuman ko\'rsatilishi shart.');
    }
    if (user.email && !isEmail(user.email)) {
      errors.push('Email formati noto\'g\'ri.');
    }
    return result(errors.length === 0, errors);
  }

  /**
   * Import qilingan bitta qatorni tekshiradi.
   * @param {Object} row Logik kalitli obyekt
   * @returns {{ok: boolean, errors: Array<string>}}
   */
  function validateImportRow(row) {
    var errors = [];
    if (!required(row.applicationNo) && !required(row.transactionNo) && !required(row.cadastreNo)) {
      errors.push('Ariza/Tranzaksiya/Kadastr raqamlaridan kamida bittasi bo\'lishi kerak.');
    }
    if (row.registerDate && !Utils.toDate(row.registerDate)) {
      errors.push('Qabul sanasi noto\'g\'ri formatda.');
    }
    if (row.pnfl && !isPnfl(row.pnfl)) {
      // PNFL ixtiyoriy, lekin mavjud bo'lsa formati to'g'ri bo'lsin (ogohlantirish).
      errors.push('JSHSHIR formati noto\'g\'ri (14 raqam bo\'lishi kerak).');
    }
    return result(errors.length === 0, errors);
  }

  /**
   * Import faylining sarlavhalarini tekshiradi (majburiy ustunlar bormi).
   * @param {Object<number,string>} mapping Repository.hisobotHeaderMapper natijasi
   * @returns {{ok: boolean, errors: Array<string>}}
   */
  function validateImportHeaders(mapping) {
    var found = {};
    for (var col in mapping) {
      if (mapping.hasOwnProperty(col)) found[mapping[col]] = true;
    }
    var errors = [];
    var hasIdentifier = found.applicationNo || found.transactionNo || found.cadastreNo;
    if (!hasIdentifier) {
      errors.push('Faylda ariza/tranzaksiya/kadastr raqami ustuni topilmadi.');
    }
    if (!found.registerDate) {
      errors.push('Faylda qabul sanasi ustuni topilmadi.');
    }
    return result(errors.length === 0, errors);
  }

  /**
   * Filtr parametrlarini tozalaydi va xavfsiz holatga keltiradi.
   * @param {Object} filters
   * @returns {Object}
   */
  function sanitizeFilters(filters) {
    filters = filters || {};
    var clean = {};
    var stringFields = ['region', 'district', 'engineer', 'registrator', 'applicationType',
      'objectType', 'residency', 'status', 'deadlineStatus', 'paymentStatus',
      'cadastreNo', 'transactionNo', 'applicationNo', 'customer', 'pnfl', 'tin', 'search'];
    for (var i = 0; i < stringFields.length; i++) {
      var f = stringFields[i];
      if (filters[f] != null && Utils.str(filters[f]) !== '') {
        clean[f] = Utils.str(filters[f]);
      }
    }
    if (filters.year) clean.year = Utils.toNumber(filters.year);
    if (filters.month) clean.month = Utils.toNumber(filters.month);
    if (filters.dateFrom) clean.dateFrom = Utils.formatDate(filters.dateFrom, 'yyyy-MM-dd');
    if (filters.dateTo) clean.dateTo = Utils.formatDate(filters.dateTo, 'yyyy-MM-dd');

    // Sahifalash
    clean.page = Math.max(1, Utils.toNumber(filters.page) || 1);
    var ps = Utils.toNumber(filters.pageSize) || Config.value('pageSize', 50);
    clean.pageSize = Math.min(Config.value('maxPageSize', 500), Math.max(1, ps));
    if (filters.sortBy) clean.sortBy = Utils.str(filters.sortBy);
    clean.sortDir = (Utils.str(filters.sortDir).toLowerCase() === 'desc') ? 'desc' : 'asc';
    return clean;
  }

  return {
    required: required,
    isPnfl: isPnfl,
    isTin: isTin,
    isEmail: isEmail,
    isUsername: isUsername,
    validatePassword: validatePassword,
    validateLogin: validateLogin,
    validateUser: validateUser,
    validateImportRow: validateImportRow,
    validateImportHeaders: validateImportHeaders,
    sanitizeFilters: sanitizeFilters
  };
})();
