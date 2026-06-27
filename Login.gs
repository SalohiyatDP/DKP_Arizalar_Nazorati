/**
 * ============================================================================
 * Login.gs — Autentifikatsiya va foydalanuvchilarni boshqarish
 * ----------------------------------------------------------------------------
 *   - authenticate: login tekshiruvi, urinishlarni cheklash, sessiya yaratish
 *   - changePassword: parolni o'zgartirish (tarix bilan)
 *   - user CRUD: administrator foydalanuvchilarni boshqaradi
 *   - seedAdmin: birinchi ishga tushirishda standart administrator yaratadi
 * LOGIN varag'i — foydalanuvchilar manbai. Parollar OCHIQ saqlanadi (admin beradi).
 * ============================================================================
 */

var Login = (function () {

  /**
   * LOGIN varag'idagi barcha foydalanuvchilarni o'qiydi.
   * @returns {Array<Object>}
   */
  function _loadUsers() {
    if (!Repository.exists(SHEETS.LOGIN)) {
      _ensureLoginSheet();
    }
    var parsed = Repository.readObjects(SHEETS.LOGIN);
    return parsed.rows;
  }

  /**
   * LOGIN varag'i mavjudligini va sarlavhalarini ta'minlaydi.
   */
  function _ensureLoginSheet() {
    if (!Repository.exists(SHEETS.LOGIN)) {
      Repository.ss().insertSheet(SHEETS.LOGIN);
    }
    var sh = Repository.sheet(SHEETS.LOGIN, true);
    if (sh.getLastRow() === 0) {
      Repository.writeHeaders(SHEETS.LOGIN, LOGIN_COLUMNS);
      return;
    }
    // Self-heal: LOGIN_COLUMNS'da bor, lekin varaqda yo'q ustunlarni qo'shamiz
    // (masalan, yangi 'fullName'). Mavjud ma'lumotlar buzilmaydi.
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      .map(function (h) { return Utils.str(h); });
    var missing = [];
    for (var i = 0; i < LOGIN_COLUMNS.length; i++) {
      if (headers.indexOf(LOGIN_COLUMNS[i]) === -1) missing.push(LOGIN_COLUMNS[i]);
    }
    if (missing.length) {
      sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    }
  }

  /**
   * Foydalanuvchini nomi bo'yicha topadi.
   * @param {string} username
   * @returns {Object|null}
   */
  function findByUsername(username) {
    var users = _loadUsers();
    var target = Utils.normalize(username);
    for (var i = 0; i < users.length; i++) {
      if (Utils.normalize(users[i].username) === target) return users[i];
    }
    return null;
  }

  /**
   * Login amali. Urinishlarni cheklaydi, sessiya yaratadi.
   * @param {Object} payload {username, password, rememberMe}
   * @returns {{ok: boolean, error?: string, session?: Object, user?: Object, mustChangePassword?: boolean}}
   */
  function authenticate(payload) {
    var check = Validation.validateLogin(payload);
    if (!check.ok) {
      return { ok: false, error: check.errors.join(' ') };
    }

    var user = findByUsername(payload.username);
    if (!user) {
      AppLog.security('LOGIN_FAIL', payload.username, 'Foydalanuvchi topilmadi');
      return { ok: false, error: 'Foydalanuvchi nomi yoki parol noto\'g\'ri.' };
    }

    // Status tekshiruvi.
    if (Utils.normalize(user.status) === 'bloklangan' ||
        Utils.normalize(user.status) === 'blocked' ||
        Utils.normalize(user.status) === 'inactive') {
      return { ok: false, error: 'Hisob bloklangan. Administratorга murojaat qiling.' };
    }

    // Qulflanish tekshiruvi.
    var lockedUntil = Utils.toDate(user.lockedUntil);
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      return {
        ok: false,
        error: 'Hisob vaqtincha bloklangan. ' +
          Utils.formatDateTime(lockedUntil) + ' dan keyin urinib ko\'ring.'
      };
    }

    // Parol tekshiruvi.
    var valid = Security.verifyPassword(payload.password, user.salt, user.passwordHash);
    if (!valid) {
      _registerFailedAttempt(user);
      AppLog.security('LOGIN_FAIL', user.username, 'Parol noto\'g\'ri');
      return { ok: false, error: 'Foydalanuvchi nomi yoki parol noto\'g\'ri.' };
    }

    // Muvaffaqiyatli — urinishlarni nollash, oxirgi kirishni yangilash.
    _resetAttempts(user);

    var sessionUser = _toSessionUser(user);
    var session = Security.createSession(sessionUser, payload.rememberMe === true);

    AppLog.action(ACTION_TYPE.LOGIN, user.username, 'Tizimga kirdi');
    AppLog.login(user.username, true, sessionUser.role);

    return {
      ok: true,
      session: session,
      user: _publicUser(sessionUser),
      mustChangePassword: _truthy(user.mustChangePassword)
    };
  }

  /**
   * LOGIN qatorini sessiya foydalanuvchisiga aylantiradi (EMPLOYEES bilan boyitadi).
   * @param {Object} user
   * @returns {Object}
   */
  function _toSessionUser(user) {
    var fullName = Utils.str(user.fullName) || user.username;
    try {
      if (fullName === user.username && user.employeeId && Repository.exists(SHEETS.EMPLOYEES)) {
        var emps = Repository.readObjects(SHEETS.EMPLOYEES);
        for (var i = 0; i < emps.rows.length; i++) {
          if (Utils.str(emps.rows[i].employeeId) === Utils.str(user.employeeId) ||
              Utils.normalize(emps.rows[i].fullName) === Utils.normalize(user.username)) {
            fullName = Utils.str(emps.rows[i].fullName) || fullName;
            break;
          }
        }
      }
    } catch (e) { /* ignore */ }

    return {
      username: Utils.str(user.username),
      role: Utils.str(user.role).toUpperCase(),
      district: Utils.str(user.district),
      employeeId: Utils.str(user.employeeId),
      fullName: fullName
    };
  }

  /**
   * Foydalanuvchining ommaviy (xavfsiz) ko'rinishi.
   * @param {Object} u
   * @returns {Object}
   */
  function _publicUser(u) {
    return {
      username: u.username,
      role: u.role,
      roleLabel: ROLE_LABEL[u.role] || u.role,
      district: u.district,
      employeeId: u.employeeId,
      fullName: u.fullName,
      permissions: Security.permissionsOf(u)
    };
  }

  /**
   * Noto'g'ri urinishni qayd qiladi va kerak bo'lsa qulflaydi.
   * @param {Object} user
   */
  function _registerFailedAttempt(user) {
    var attempts = Utils.toNumber(user.failedAttempts) + 1;
    var maxAttempts = Config.value('maxLoginAttempts', 5);
    var updates = { failedAttempts: attempts };
    if (attempts >= maxAttempts) {
      var lockMin = Config.value('loginLockMinutes', 15);
      updates.lockedUntil = Utils.formatDateTime(new Date(Date.now() + lockMin * 60000));
      updates.failedAttempts = 0;
      AppLog.security('ACCOUNT_LOCKED', user.username,
        attempts + ' marta noto\'g\'ri urinish');
    }
    _updateUserRow(user.username, updates);
  }

  /**
   * Muvaffaqiyatli kirishdan keyin urinishlarni nollaydi.
   * @param {Object} user
   */
  function _resetAttempts(user) {
    _updateUserRow(user.username, {
      failedAttempts: 0,
      lockedUntil: '',
      lastLogin: Utils.formatDateTime(new Date())
    });
  }

  /**
   * LOGIN varag'idagi bitta foydalanuvchi qatorini yangilaydi.
   * @param {string} username
   * @param {Object} updates {kalit: qiymat}
   * @returns {boolean}
   */
  function _updateUserRow(username, updates) {
    var sh = Repository.sheet(SHEETS.LOGIN, true);
    var matrix = Repository.readMatrix(SHEETS.LOGIN);
    if (matrix.length < 2) return false;
    var headers = matrix[0].map(function (h) { return Utils.str(h); });
    var colIndex = {};
    for (var c = 0; c < headers.length; c++) colIndex[headers[c]] = c;

    var target = Utils.normalize(username);
    var unameCol = colIndex.username != null ? colIndex.username : 0;

    for (var r = 1; r < matrix.length; r++) {
      if (Utils.normalize(matrix[r][unameCol]) === target) {
        for (var key in updates) {
          if (updates.hasOwnProperty(key) && colIndex[key] != null) {
            matrix[r][colIndex[key]] = updates[key];
          }
        }
        sh.getRange(r + 1, 1, 1, headers.length).setValues([matrix[r]]);
        return true;
      }
    }
    return false;
  }

  /**
   * Joriy parolni o'zgartiradi.
   * @param {Object} session Joriy sessiya foydalanuvchisi
   * @param {Object} payload {oldPassword, newPassword, confirmPassword}
   * @returns {{ok: boolean, error?: string}}
   */
  function changePassword(session, payload) {
    if (!session) return { ok: false, error: 'Sessiya yaroqsiz.' };
    payload = payload || {};

    if (payload.newPassword !== payload.confirmPassword) {
      return { ok: false, error: 'Yangi parol va tasdiqlash mos kelmadi.' };
    }
    var policy = Validation.validatePassword(payload.newPassword);
    if (!policy.ok) {
      return { ok: false, error: policy.errors.join(' ') };
    }

    var user = findByUsername(session.username);
    if (!user) return { ok: false, error: 'Foydalanuvchi topilmadi.' };

    if (!Security.verifyPassword(payload.oldPassword, user.salt, user.passwordHash)) {
      AppLog.security('PASSWORD_CHANGE_FAIL', user.username, 'Eski parol noto\'g\'ri');
      return { ok: false, error: 'Eski parol noto\'g\'ri.' };
    }

    // Parol tarixini tekshirish (oxirgi N ta parolni qayta ishlatmaslik).
    var history = _parseHistory(user.passwordHistory);
    for (var i = 0; i < history.length; i++) {
      if (Security.verifyPassword(payload.newPassword, history[i].salt, history[i].hash)) {
        return { ok: false, error: 'Yangi parol oxirgi parollardan biri bilan bir xil.' };
      }
    }

    var newSalt = Security.generateSalt();
    var newHash = Security.hashPassword(payload.newPassword, newSalt);

    history.unshift({ salt: user.salt, hash: user.passwordHash });
    var depth = Config.value('passwordHistoryDepth', 5);
    history = history.slice(0, depth);

    _updateUserRow(user.username, {
      passwordHash: newHash,
      salt: newSalt,
      mustChangePassword: false,
      passwordHistory: JSON.stringify(history),
      updatedAt: Utils.formatDateTime(new Date())
    });

    AppLog.action(ACTION_TYPE.PASSWORD_CHANGE, user.username, 'Parol o\'zgartirildi');
    return { ok: true };
  }

  /**
   * Parol tarixini parse qiladi.
   * @param {string} raw
   * @returns {Array<{salt: string, hash: string}>}
   */
  function _parseHistory(raw) {
    try {
      var h = JSON.parse(raw || '[]');
      return Array.isArray(h) ? h : [];
    } catch (e) { return []; }
  }

  /* ----------------- FOYDALANUVCHILARNI BOSHQARISH ---------------------- */

  /**
   * Yangi foydalanuvchi yaratadi (faqat administrator).
   * @param {Object} session
   * @param {Object} userData {username, password, role, region, district, employeeId, email}
   * @returns {{ok: boolean, error?: string}}
   */
  function createUser(session, userData) {
    Security.require(session, PERMISSIONS.MANAGE_USERS);
    var v = Validation.validateUser(userData);
    if (!v.ok) return { ok: false, error: v.errors.join(' ') };

    if (findByUsername(userData.username)) {
      return { ok: false, error: 'Bunday foydalanuvchi nomi allaqachon mavjud.' };
    }
    var pwd = userData.password || _randomPassword();
    var policy = Validation.validatePassword(pwd);
    if (!policy.ok) return { ok: false, error: policy.errors.join(' ') };

    var salt = '';
    var hash = Security.hashPassword(pwd, salt);
    var now = Utils.formatDateTime(new Date());

    var row = _buildUserRow({
      username: userData.username,
      passwordHash: hash,
      salt: salt,
      role: Utils.str(userData.role).toUpperCase(),
      region: '',
      district: Utils.str(userData.district),
      employeeId: Utils.str(userData.employeeId),
      fullName: Utils.str(userData.fullName),
      status: 'active',
      mustChangePassword: false,
      passwordHistory: '[]',
      lastLogin: '',
      failedAttempts: 0,
      lockedUntil: '',
      createdAt: now,
      updatedAt: now
    });

    _ensureLoginSheet();
    Repository.appendRow(SHEETS.LOGIN, row);
    AppLog.action(ACTION_TYPE.USER_CREATE, session.username,
      'Yangi foydalanuvchi: ' + userData.username);

    return { ok: true, generatedPassword: userData.password ? null : pwd };
  }

  /**
   * Foydalanuvchini yangilaydi (rol, hudud, status).
   * @param {Object} session
   * @param {string} username
   * @param {Object} updates
   * @returns {{ok: boolean, error?: string}}
   */
  function updateUser(session, username, updates) {
    Security.require(session, PERMISSIONS.MANAGE_USERS);
    var allowed = {};
    if (updates.role) allowed.role = Utils.str(updates.role).toUpperCase();
    if (updates.district != null) allowed.district = Utils.str(updates.district);
    if (updates.fullName != null) allowed.fullName = Utils.str(updates.fullName);
    if (updates.status) allowed.status = Utils.str(updates.status);
    if (updates.employeeId != null) allowed.employeeId = Utils.str(updates.employeeId);
    // Admin parolni bevosita o'rnatishi/qayta berishi mumkin (ochiq saqlanadi).
    if (updates.password) {
      var pol = Validation.validatePassword(updates.password);
      if (!pol.ok) return { ok: false, error: pol.errors.join(' ') };
      allowed.passwordHash = Security.hashPassword(updates.password, '');
      allowed.salt = '';
      allowed.mustChangePassword = false;
    }
    allowed.updatedAt = Utils.formatDateTime(new Date());

    var ok = _updateUserRow(username, allowed);
    if (ok) {
      AppLog.action(ACTION_TYPE.USER_UPDATE, session.username,
        'Foydalanuvchi yangilandi: ' + username);
    }
    return { ok: ok, error: ok ? null : 'Foydalanuvchi topilmadi.' };
  }

  /**
   * Administrator tomonidan parolni tiklash (reset).
   * @param {Object} session
   * @param {string} username
   * @returns {{ok: boolean, password?: string, error?: string}}
   */
  function resetPassword(session, username) {
    Security.require(session, PERMISSIONS.MANAGE_USERS);
    var user = findByUsername(username);
    if (!user) return { ok: false, error: 'Foydalanuvchi topilmadi.' };
    var pwd = _randomPassword();
    _updateUserRow(username, {
      passwordHash: Security.hashPassword(pwd, ''), salt: '', mustChangePassword: false,
      failedAttempts: 0, lockedUntil: '', updatedAt: Utils.formatDateTime(new Date())
    });
    AppLog.action(ACTION_TYPE.PASSWORD_CHANGE, session.username,
      'Parol tiklandi: ' + username);
    return { ok: true, password: pwd };
  }

  /**
   * Barcha foydalanuvchilar ro'yxati. Admin parolni ko'rishi mumkin (ochiq saqlanadi),
   * chunki login-parolni admin beradi va yo'qolganda qayta beradi.
   * @param {Object} session
   * @returns {Array<Object>}
   */
  function listUsers(session) {
    Security.require(session, PERMISSIONS.MANAGE_USERS);
    return _loadUsers().map(function (u) {
      return {
        username: u.username,
        password: Utils.str(u.passwordHash),
        fullName: Utils.str(u.fullName),
        role: u.role,
        roleLabel: ROLE_LABEL[Utils.str(u.role).toUpperCase()] || u.role,
        district: u.district,
        employeeId: u.employeeId,
        status: u.status,
        lastLogin: u.lastLogin
      };
    });
  }

  /**
   * Qatorni LOGIN_COLUMNS tartibida quradi.
   * @param {Object} obj
   * @returns {Array}
   */
  function _buildUserRow(obj) {
    return LOGIN_COLUMNS.map(function (col) {
      return obj[col] !== undefined ? obj[col] : '';
    });
  }

  /**
   * Tasodifiy boshlang'ich parol.
   * @returns {string}
   */
  function _randomPassword() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    var s = '';
    for (var i = 0; i < 10; i++) {
      s += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return s + '1a';
  }

  /**
   * Truthy tekshiruvi (TRUE/true/1/ha).
   * @param {*} v
   * @returns {boolean}
   */
  function _truthy(v) {
    var s = Utils.normalize(v);
    return s === 'true' || s === '1' || s === 'ha' || s === 'yes' || v === true;
  }

  /**
   * Birinchi ishga tushirishda standart administratorni yaratadi.
   * Username: admin, Parol: Admin@2026 (birinchi kirishda o'zgartirish majburiy).
   * @returns {{created: boolean, username?: string, password?: string}}
   */
  function seedAdmin() {
    _ensureLoginSheet();
    var users = _loadUsers();
    var adminUser = null;
    for (var i = 0; i < users.length; i++) {
      if (Utils.str(users[i].role).toUpperCase() === ROLES.ADMIN) { adminUser = users[i]; break; }
    }

    if (adminUser) {
      // MIGRATSIYA: eski heshlangan parol (64 hex) bo'lsa — ochiq parolga tiklaymiz,
      // aks holda admin ochiq rejimga o'tgandan keyin kira olmay qoladi.
      if (_looksLikeHash(adminUser.passwordHash)) {
        _updateUserRow(adminUser.username, {
          passwordHash: 'Admin@2026', salt: '', mustChangePassword: true,
          updatedAt: Utils.formatDateTime(new Date())
        });
        return { created: false, repaired: true, username: adminUser.username, password: 'Admin@2026' };
      }
      return { created: false };
    }

    var pwd = 'Admin@2026';
    var now = Utils.formatDateTime(new Date());
    var row = _buildUserRow({
      username: 'admin',
      passwordHash: Security.hashPassword(pwd, ''),
      salt: '',
      role: ROLES.ADMIN,
      region: '',
      district: '',
      employeeId: 'ADMIN-001',
      status: 'active',
      mustChangePassword: true,
      passwordHistory: '[]',
      lastLogin: '',
      failedAttempts: 0,
      lockedUntil: '',
      createdAt: now,
      updatedAt: now
    });
    Repository.appendRow(SHEETS.LOGIN, row);
    return { created: true, username: 'admin', password: pwd };
  }

  /**
   * Qiymat eski SHA-256 hesh ko'rinishidami (64 ta hex belgi)?
   * @param {*} v
   * @returns {boolean}
   */
  function _looksLikeHash(v) {
    return /^[0-9a-f]{64}$/i.test(Utils.str(v));
  }

  /**
   * MIGRATSIYA (admin Apps Script muharririda bir marta ishlatishi mumkin):
   * heshlangan parolga ega barcha foydalanuvchilarga vaqtinchalik OCHIQ parol beradi.
   * Natijada yangi parollar ro'yxati qaytadi — admin ularni tarqatadi.
   * @returns {Array<{username: string, password: string}>}
   */
  function migratePasswordsToPlaintext() {
    var users = _loadUsers();
    var out = [];
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      if (_looksLikeHash(u.passwordHash)) {
        var pwd = _randomPassword();
        _updateUserRow(u.username, {
          passwordHash: pwd, salt: '', mustChangePassword: false,
          updatedAt: Utils.formatDateTime(new Date())
        });
        out.push({ username: u.username, password: pwd });
      }
    }
    return out;
  }

  /**
   * Logout amali.
   * @param {string} token
   */
  function logout(token, username) {
    Security.destroySession(token);
    if (username) AppLog.action(ACTION_TYPE.LOGOUT, username, 'Tizimdan chiqdi');
  }

  return {
    authenticate: authenticate,
    changePassword: changePassword,
    createUser: createUser,
    updateUser: updateUser,
    resetPassword: resetPassword,
    listUsers: listUsers,
    findByUsername: findByUsername,
    seedAdmin: seedAdmin,
    migratePasswordsToPlaintext: migratePasswordsToPlaintext,
    logout: logout
  };
})();
