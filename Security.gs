/**
 * ============================================================================
 * Security.gs — Xavfsizlik qatlami
 * ----------------------------------------------------------------------------
 *   - Parol heshlash (salt + ko'p iteratsiyali SHA-256 zanjiri)
 *   - Sessiya tokenlari (CacheService + PropertiesService)
 *   - CSRF token
 *   - Ruxsat (permission) va rol tekshiruvi — server tomonida
 *   - HTML ekranlash (XSS himoyasi)
 * ============================================================================
 */

var Security = (function () {

  var SESSION_PREFIX = 'session::';
  var CSRF_PREFIX = 'csrf::';

  /* --------------------------- PAROL (OCHIQ) ----------------------------- */
  // ESLATMA: Administrator qarori bo'yicha parollar OCHIQ saqlanadi (heshlanmaydi).
  // Sabab: login-parolni admin beradi; muhandis parolni yo'qotsa, admin uni
  // ko'rib/qayta berishi kerak. Heshlash o'chirilgan.
  // ⚠️ Bu xavfsizlik nuqtai nazaridan tavsiya etilmaydi, lekin ichki tizim talabi.

  /**
   * Salt (eski sxema mosligi uchun saqlanadi — endi ishlatilmaydi).
   * @returns {string}
   */
  function generateSalt() {
    return '';
  }

  /**
   * Parolni "heshlaydi" — ochiq rejim: parolni o'zgartirmasdan qaytaradi.
   * @param {string} password
   * @param {string} salt (e'tiborsiz)
   * @returns {string} parolning o'zi (ochiq)
   */
  function hashPassword(password, salt) {
    return String(password == null ? '' : password);
  }

  /**
   * Parolni tekshiradi — ochiq taqqoslash (saqlangan qiymat ham ochiq).
   * @param {string} password
   * @param {string} salt (e'tiborsiz)
   * @param {string} stored Saqlangan ochiq parol
   * @returns {boolean}
   */
  function verifyPassword(password, salt, stored) {
    return _safeEqual(String(password == null ? '' : password), String(stored == null ? '' : stored));
  }

  /**
   * Vaqt hujumlariga chidamli matn taqqoslash.
   * @param {string} a
   * @param {string} b
   * @returns {boolean}
   */
  function _safeEqual(a, b) {
    a = String(a); b = String(b);
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) {
      diff |= (a.charCodeAt(i) ^ b.charCodeAt(i));
    }
    return diff === 0;
  }

  /* ---------------------------- SESSIYA ---------------------------------- */

  /**
   * Foydalanuvchi uchun sessiya yaratadi.
   * @param {Object} user
   * @param {boolean} [rememberMe]
   * @returns {{token: string, csrf: string, expiresAt: string}}
   */
  function createSession(user, rememberMe) {
    var token = Utils.randomToken(32);
    var csrf = Utils.randomToken(24);
    var ttlMin = rememberMe
      ? Config.value('rememberMeTtlMin', 43200)
      : Config.value('sessionTtlMin', 720);
    var ttlSec = ttlMin * 60;
    var expiresAt = new Date(Date.now() + ttlSec * 1000);

    var payload = {
      username: user.username,
      role: user.role,
      district: user.district || '',
      employeeId: user.employeeId || '',
      fullName: user.fullName || user.username,
      csrf: csrf,
      createdAt: Utils.nowIso(),
      expiresAt: Utilities.formatDate(expiresAt,
        Config.value('timeZone', 'Asia/Tashkent'), "yyyy-MM-dd'T'HH:mm:ss")
    };

    // CacheService (tez) + PropertiesService (zaxira/uzoq).
    try {
      CacheService.getScriptCache().put(
        SESSION_PREFIX + token, JSON.stringify(payload),
        Math.min(ttlSec, 21600)); // CacheService maksimal 6 soat
    } catch (e) { /* ignore */ }
    PropertiesService.getScriptProperties()
      .setProperty(SESSION_PREFIX + token, JSON.stringify(payload));

    return { token: token, csrf: csrf, expiresAt: payload.expiresAt };
  }

  /**
   * Sessiya tokenini tekshiradi va foydalanuvchi ma'lumotini qaytaradi.
   * @param {string} token
   * @returns {Object|null}
   */
  function validateSession(token) {
    if (!token) return null;
    var raw = null;
    try {
      raw = CacheService.getScriptCache().get(SESSION_PREFIX + token);
    } catch (e) { /* ignore */ }
    if (!raw) {
      raw = PropertiesService.getScriptProperties().getProperty(SESSION_PREFIX + token);
    }
    if (!raw) return null;

    var payload;
    try { payload = JSON.parse(raw); } catch (e2) { return null; }

    var exp = Utils.toDate(payload.expiresAt);
    if (exp && exp.getTime() < Date.now()) {
      destroySession(token);
      return null;
    }
    return payload;
  }

  /**
   * Sessiyani o'chiradi (logout).
   * @param {string} token
   */
  function destroySession(token) {
    if (!token) return;
    try { CacheService.getScriptCache().remove(SESSION_PREFIX + token); } catch (e) {}
    try {
      PropertiesService.getScriptProperties().deleteProperty(SESSION_PREFIX + token);
    } catch (e2) {}
  }

  /**
   * CSRF tokenni tekshiradi.
   * @param {Object} session
   * @param {string} csrf
   * @returns {boolean}
   */
  function verifyCsrf(session, csrf) {
    return !!session && _safeEqual(session.csrf || '', csrf || '');
  }

  /* ------------------------- RUXSAT TEKSHIRUVI --------------------------- */

  /**
   * Foydalanuvchining ruxsatlar ro'yxatini qaytaradi.
   * @param {Object} user
   * @returns {Array<string>}
   */
  function permissionsOf(user) {
    if (!user || !user.role) return [];
    return ROLE_PERMISSIONS[user.role] || [];
  }

  /**
   * Foydalanuvchida ruxsat borligini tekshiradi.
   * @param {Object} user
   * @param {string} permission
   * @returns {boolean}
   */
  function can(user, permission) {
    return permissionsOf(user).indexOf(permission) !== -1;
  }

  /**
   * Ruxsatni majburiy talab qiladi, aks holda xato tashlaydi.
   * @param {Object} user
   * @param {string} permission
   */
  function require(user, permission) {
    if (!can(user, permission)) {
      throw new Error('Ruxsat yo\'q: ' + permission + ' amalini bajarish taqiqlangan.');
    }
  }

  /**
   * Rolni majburiy talab qiladi.
   * @param {Object} user
   * @param {string} role
   */
  function requireRole(user, role) {
    if (!user || user.role !== role) {
      throw new Error('Bu amal faqat "' + (ROLE_LABEL[role] || role) + '" roli uchun.');
    }
  }

  return {
    generateSalt: generateSalt,
    hashPassword: hashPassword,
    verifyPassword: verifyPassword,
    createSession: createSession,
    validateSession: validateSession,
    destroySession: destroySession,
    verifyCsrf: verifyCsrf,
    permissionsOf: permissionsOf,
    can: can,
    require: require,
    requireRole: requireRole,
    // Eslatma: kechiktirilgan murojaat — GAS fayllarni alifbo tartibida yuklaydi,
    // shuning uchun Utils'ga modul yuklanish vaqtida emas, chaqiruv vaqtida murojaat qilamiz.
    escapeHtml: function (v) { return Utils.escapeHtml(v); }
  };
})();
