/**
 * ============================================================================
 * Constants.gs — Tizim konstantalari
 * ----------------------------------------------------------------------------
 * Varaq nomlari, ustun indekslari, status kodlari, ranglar va rollar shu yerda
 * markazlashtirilgan. Hech qayerda matn ko'rinishidagi "magic value" ishlatilmaydi.
 * ============================================================================
 */

/** Spreadsheetdagi varaqlar nomlari (mavjud varaqlar — qayta yaratilmaydi). */
var SHEETS = {
  DASHBOARD: 'DASHBOARD',
  HISOBOT: 'HISOBOT',
  DATA: 'DATA',
  STATISTICS: 'STATISTICS',
  FINANCE: 'FINANCE',
  LOGIN: 'LOGIN',
  EMPLOYEES: 'EMPLOYEES',
  SETTINGS: 'SETTINGS',
  HOLIDAYS: 'HOLIDAYS',
  SERVICE_RULES: 'SERVICE_RULES',
  AREA_RULES: 'AREA_RULES',
  EXPORT: 'EXPORT',
  BACKUP: 'BACKUP',
  IMPORT_LOG: 'IMPORT_LOG',
  LOGIN_LOG: 'LOGIN_LOG',
  ACTION_LOG: 'ACTION_LOG',
  MONTHLY_STATS: 'MONTHLY_STATS',
  CACHE: 'CACHE'
};

/**
 * HISOBOT varag'ining standart ustunlari (logik kalit -> sarlavha variantlari).
 * Birinchi variant — DKP standart hisobotidagi aniq nom. Import vaqtida avval
 * to'liq, so'ng qisman moslik bo'yicha avtomatik moslashtiriladi.
 */
var HISOBOT_FIELDS = {
  applicationNo:    ['Ariza raqami', 'ARIZA RAQAMI', 'APPLICATION NUMBER'],
  transactionNo:    ['Tranzaksiya raqami', 'TRANZAKSIYA RAQAMI', 'TRANSACTION NUMBER'],
  cadastreNo:       ['Kadastr raqami', 'KADASTR RAQAMI', 'CADASTRE NUMBER'],
  customer:         ['Buyurtmachi', 'Mulkdor', 'MIJOZ', 'ARIZACHI', 'CUSTOMER'],
  pnfl:             ['PNFL', 'JSHSHIR', 'PINFL'],
  tin:              ['STIR', 'INN', 'TIN'],
  region:           ['Viloyat', 'VILOYAT', 'REGION', 'HUDUD'],
  district:         ['Tuman', 'TUMAN', 'DISTRICT'],
  engineer:         ['Ijrochi muhandis', 'MUHANDIS', 'ENGINEER', 'IJROCHI MUHANDIS'],
  registrator:      ['Ijrochi registrator', 'REGISTRATOR', 'Registrator'],
  applicationType:  ['Ariza turi', 'ARIZA TURI', 'APPLICATION TYPE', 'Ariza maqsadi'],
  objectType:       ['Obyekt turi', 'OBYEKT TURI', 'OBJECT TYPE'],
  serviceCode:      ['Tranzaksiya turi', 'XIZMAT KODI', 'SERVICE CODE'],
  area:             ['Umumiy yer maydoni', 'MAYDON', 'AREA', 'YUZA'],
  registerDate:     ['Ariza kelib tushgan sana', 'QABUL SANASI', 'KIRISH SANASI', 'ARIZA SANASI'],
  deadlineDate:     ['IJRO MUDDATI', 'MUDDAT SANASI', 'DEADLINE'],
  completeDate:     ['Oxirgi jarayon sana', 'BAJARILGAN SANA', 'TUGATILGAN SANA'],
  issuedDate:       ['To\'lovga chiqarilgan sana', 'TO\'LOVGA CHIQARILGAN SANA'],
  status:           ['Tizimdagi holati', 'HOLAT', 'ARIZA HOLATI', 'STATUS'],
  paymentDate:      ['To\'langan sana', 'TO\'LOV SANASI', 'PAYMENT DATE'],
  paymentStatus:    ['To\'lov holati', 'TO\'LOV HOLATI', 'PAYMENT STATUS'],
  note:             ['Rad etish izohi', 'IZOH', 'NOTE', 'QAYD'],

  // To'lov uchta qismdan iborat — har biri alohida o'qiladi va enrichRow'da yig'iladi.
  amountCadastre:   ['Kadastr to\'lov summasi'],
  amountReg:        ['Registratsiya to\'lov summasi'],
  amountAddr:       ['Manzil to\'lov summasi'],
  paidCadastre:     ['Kadastr to\'langan summasi'],
  paidReg:          ['Registratsiya to\'langan summasi'],
  paidAddr:         ['Manzil to\'langan summasi'],

  // Umumiy zaxira maydonlari (agar yuqoridagilar topilmasa).
  amount:           ['Jami to\'lov summasi', 'TO\'LOV SUMMASI', 'SUMMA', 'AMOUNT'],
  paidAmount:       ['Jami to\'langan summa', 'TO\'LANGAN SUMMA', 'PAID AMOUNT']
};

/** DATA varag'ida ishlatiladigan kanonik ustun tartibi (transformatsiyadan keyin). */
var DATA_COLUMNS = [
  'rowId', 'applicationNo', 'transactionNo', 'cadastreNo', 'customer', 'pnfl', 'tin',
  'region', 'district', 'engineer', 'registrator', 'applicationType', 'objectType', 'serviceCode',
  'residency', 'area', 'registerDate', 'deadlineDate', 'completeDate', 'issuedDate', 'status',
  'deadlineStatus', 'remainingDays', 'progressPercent', 'colorStatus', 'issued',
  'amount', 'paidAmount', 'debtAmount', 'paymentStatus', 'paymentDate', 'note',
  'year', 'month', 'importBatch', 'updatedAt'
];

/** Ariza muddat holatlari. */
var DEADLINE_STATUS = {
  COMPLETED: 'COMPLETED',       // Bajarilgan
  IN_PROGRESS: 'IN_PROGRESS',   // Jarayonda
  DUE_TODAY: 'DUE_TODAY',       // Bugun tugaydi
  ONE_DAY: 'ONE_DAY',           // 1 kun qoldi
  TWO_DAYS: 'TWO_DAYS',         // 2 kun qoldi
  THREE_DAYS: 'THREE_DAYS',     // 3 kun qoldi
  EXPIRED: 'EXPIRED'            // Muddati o'tgan
};

/** Muddat holatining o'zbekcha nomlari. */
var DEADLINE_STATUS_LABEL = {
  COMPLETED: 'Bajarilgan',
  IN_PROGRESS: 'Jarayonda',
  DUE_TODAY: 'Bugun tugaydi',
  ONE_DAY: '1 kun qoldi',
  TWO_DAYS: '2 kun qoldi',
  THREE_DAYS: '3 kun qoldi',
  EXPIRED: 'Muddati o\'tgan'
};

/** Rang holatlari (UI uchun). */
var COLOR_STATUS = {
  GREEN: 'GREEN',     // Bajarilgan / xavfsiz
  YELLOW: 'YELLOW',   // 3 kun
  ORANGE: 'ORANGE',   // 1-2 kun
  RED: 'RED',         // Bugun / kritik
  BLACK: 'BLACK'      // Muddati o'tgan
};

/** Rang HEX qiymatlari. */
var COLOR_HEX = {
  GREEN: '#2e7d32',
  YELLOW: '#f9a825',
  ORANGE: '#ef6c00',
  RED: '#c62828',
  BLACK: '#212121'
};

/** To'lov holatlari. */
var PAYMENT_STATUS = {
  PAID: 'PAID',           // To'langan
  PARTIAL: 'PARTIAL',     // Qisman
  UNPAID: 'UNPAID',       // To'lanmagan
  WAITING: 'WAITING'      // Kutilmoqda
};

var PAYMENT_STATUS_LABEL = {
  PAID: 'To\'langan',
  PARTIAL: 'Qisman to\'langan',
  UNPAID: 'To\'lanmagan',
  WAITING: 'To\'lov kutilmoqda'
};

/** Ariza yakuniy holatlari (HISOBOT status normalizatsiyasi uchun). */
var APP_STATUS = {
  NEW: 'NEW',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED'
};

/** Status matnlarini kanonik holatga keltirish lug'ati. */
var STATUS_DICTIONARY = {
  'yangi': APP_STATUS.NEW,
  'new': APP_STATUS.NEW,
  'jarayonda': APP_STATUS.IN_PROGRESS,
  'ijroda': APP_STATUS.IN_PROGRESS,
  'in progress': APP_STATUS.IN_PROGRESS,
  'bajarilgan': APP_STATUS.COMPLETED,
  'tugatilgan': APP_STATUS.COMPLETED,
  'completed': APP_STATUS.COMPLETED,
  'rad etilgan': APP_STATUS.REJECTED,
  'rejected': APP_STATUS.REJECTED,
  'bekor qilingan': APP_STATUS.CANCELLED,
  'cancelled': APP_STATUS.CANCELLED
};

/** Ko'chmas mulk turi (Residency). */
var RESIDENCY = {
  RESIDENTIAL: 'RESIDENTIAL',         // Turar joy
  NON_RESIDENTIAL: 'NON_RESIDENTIAL'  // Noturar joy
};

var RESIDENCY_LABEL = {
  RESIDENTIAL: 'Turar joy',
  NON_RESIDENTIAL: 'Noturar joy'
};

/** Foydalanuvchi rollari. */
var ROLES = {
  ADMIN: 'ADMIN',
  REGION: 'REGION',
  DISTRICT: 'DISTRICT',
  ENGINEER: 'ENGINEER'
};

var ROLE_LABEL = {
  ADMIN: 'Administrator',
  REGION: 'Viloyat',
  DISTRICT: 'Tuman',
  ENGINEER: 'Kadastr muhandisi'
};

/** Ruxsatlar (permission) ro'yxati. */
var PERMISSIONS = {
  VIEW_DASHBOARD: 'VIEW_DASHBOARD',
  VIEW_ALL_REGIONS: 'VIEW_ALL_REGIONS',
  VIEW_OWN_REGION: 'VIEW_OWN_REGION',
  VIEW_OWN_DISTRICT: 'VIEW_OWN_DISTRICT',
  VIEW_OWN_APPLICATIONS: 'VIEW_OWN_APPLICATIONS',
  RUN_IMPORT: 'RUN_IMPORT',
  RUN_EXPORT: 'RUN_EXPORT',
  MANAGE_USERS: 'MANAGE_USERS',
  MANAGE_SETTINGS: 'MANAGE_SETTINGS',
  VIEW_FINANCE: 'VIEW_FINANCE',
  VIEW_LOGS: 'VIEW_LOGS',
  VIEW_REPORTS: 'VIEW_REPORTS'
};

/** Rol -> ruxsatlar xaritasi (server tomonida tekshiriladi). */
var ROLE_PERMISSIONS = {
  ADMIN: [
    PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_ALL_REGIONS, PERMISSIONS.RUN_IMPORT,
    PERMISSIONS.RUN_EXPORT, PERMISSIONS.MANAGE_USERS, PERMISSIONS.MANAGE_SETTINGS,
    PERMISSIONS.VIEW_FINANCE, PERMISSIONS.VIEW_LOGS, PERMISSIONS.VIEW_REPORTS
  ],
  REGION: [
    PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_OWN_REGION, PERMISSIONS.RUN_EXPORT,
    PERMISSIONS.VIEW_FINANCE, PERMISSIONS.VIEW_REPORTS
  ],
  DISTRICT: [
    PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_OWN_DISTRICT, PERMISSIONS.RUN_EXPORT,
    PERMISSIONS.VIEW_FINANCE, PERMISSIONS.VIEW_REPORTS
  ],
  ENGINEER: [
    PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_OWN_APPLICATIONS, PERMISSIONS.VIEW_REPORTS
  ]
};

/** EMPLOYEES varag'ining ustunlari. */
var EMPLOYEE_COLUMNS = [
  'employeeId', 'fullName', 'role', 'region', 'district', 'phone', 'email', 'status'
];

/** LOGIN varag'ining ustunlari. */
var LOGIN_COLUMNS = [
  'username', 'passwordHash', 'salt', 'role', 'region', 'district', 'employeeId',
  'status', 'mustChangePassword', 'passwordHistory', 'lastLogin', 'failedAttempts',
  'lockedUntil', 'createdAt', 'updatedAt'
];

/** Log darajalari. */
var LOG_LEVEL = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  SECURITY: 'SECURITY'
};

/** Action log turlari. */
var ACTION_TYPE = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  IMPORT: 'IMPORT',
  EXPORT: 'EXPORT',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  USER_CREATE: 'USER_CREATE',
  USER_UPDATE: 'USER_UPDATE',
  SETTINGS_UPDATE: 'SETTINGS_UPDATE',
  VIEW_REPORT: 'VIEW_REPORT',
  ERROR: 'ERROR'
};

/** Standart o'zbekcha oy nomlari. */
var MONTH_NAMES_UZ = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'
];

/** Hafta kunlari (o'zbekcha). */
var WEEKDAY_NAMES_UZ = [
  'Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'
];
