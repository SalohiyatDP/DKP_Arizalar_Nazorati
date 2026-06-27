# DKP ARIZALAR NAZORATI

> **Davlat Kadastr Palatasi** uchun korporativ darajadagi arizalarni nazorat qilish va tahlil platformasi.
> Google Apps Script + Google Sheets asosida qurilgan, kunlik foydalanishga mo'ljallangan ishlab chiqarish (production) tizimi.

---

## 📌 Loyiha haqida

Tizim har kuni import qilinadigan standart Excel hisobotlari (**HISOBOT** varag'i) asosida ishlaydi.
Hozirgi hajm **18 000+** qator, kelajakda **100 000+** qatorgача kengayishga moslashtirilgan.

Asosiy maqsad — kadastr arizalarini quyidagi kesimlarda nazorat qilish va tahlil etish:

- Turar / Noturar joy arizalari
- Ish kunlari bo'yicha muddat (deadline) hisoblash (shanba, yakshanba va bayramlarsiz)
- Oylik to'langan va kutilayotgan to'lov summalari
- Muhandis va tuman samaradorligi
- Reyting va moliyaviy dashboard, muddat nazorati

---

## 🏛️ Asosiy imkoniyatlar

| Bo'lim | Tavsif |
|--------|--------|
| **Boshqaruv paneli** | KPI vidjetlar, grafiklar (holat, turar/noturar, tendensiya, to'lov), so'nggi faollik |
| **Arizalar** | Kaskad filtrlash, tezkor qidiruv, sahifalash, tafsilotlar, eksport |
| **Moliya** | Daromad, qarz, yig'ilish darajasi, oylararo taqqoslash |
| **Hisobotlar** | Muddati o'tgan, bugun tugaydigan, muhandis/tuman, moliyaviy, samaradorlik, to'lov |
| **Reytinglar** | Muhandis, tuman reytingi (ball asosida) |
| **Import** | Bir tugmali import: zaxira → tekshirish → transformatsiya → statistika → kesh |
| **Foydalanuvchilar** | Administrator hisoblarni yaratadi, rollarni boshqaradi, parolni tiklaydi |
| **Audit loglar** | Kirish, import, eksport va amallar tarixi |

---

## 🔐 Rollar va ruxsatlar

Tizim **bitta viloyatdan** boshqariladi — alohida viloyat darajasi yo'q.

| Rol | Ko'rish doirasi |
|-----|------------------|
| **Administrator** | Butun tizim (barcha tumanlar), foydalanuvchilar, import, sozlamalar, loglar |
| **Bosh muhandis** | Faqat o'z tumani monitoring paneli (ko'rish, moliya, hisobot) |
| **Kadastr muhandis** | Faqat o'z tumani monitoring paneli (ko'rish, moliya, hisobot) |

> Barcha ruxsat tekshiruvlari **server tomonida** amalga oshiriladi. Frontend'ga hech qachon ishonilmaydi.

> ⚠️ **Parollar ochiq saqlanadi** (heshlanmaydi) — login-parolni administrator beradi va yo'qolganda
> qayta beradi (Foydalanuvchilar bo'limida parol ko'rinadi). Bu ichki tizim talabi; tashqi tarmoqqa
> ochiq joylashtirilmasligi tavsiya etiladi. Eski heshlangan parollar uchun: DKP Nazorat menyusi →
> "Parollarni ochiq formatga o'tkazish".

> 📊 **Ko'rsatkichlar oylik:** asosiy panel standart holda joriy oyning 1-sanasidan boshlab ma'lumotni
> ko'rsatadi; jarayondagi arizalar va kutilayotgan to'lovlar yangi oyga avtomatik o'tib turadi.


---

## 📅 Ish kunlari (muddat) dvigateli

Muddatlar **faqat ish kunlari** bo'yicha hisoblanadi (`BusinessCalendar.gs`):

- **Shanba** va **Yakshanba** — dam olish kunlari.
- **HOLIDAYS** varag'idagi sanalar — bayram/dam olish kunlari (administrator tahrirlaydi).

Asosiy funksiyalar (Excel `WORKDAY` / `NETWORKDAYS` ekvivalentlari JavaScriptda qayta yozilgan):

- `isWorkingDay(date)` — kun ish kunimi
- `nextWorkingDay(date)` — keyingi ish kuni
- `addWorkingDays(date, n)` — N ta ish kuni qo'shish
- `workingDaysBetween(a, b)` — orasidagi ish kunlari soni
- `remainingWorkingDays(deadline)` — muddatgacha qolgan ish kunlari

### Muddat holatlari va ranglari

| Holat | Rang |
|-------|------|
| Bajarilgan | 🟢 Yashil |
| Jarayonda | 🟢 Yashil |
| 3 kun qoldi | 🟡 Sariq |
| 1–2 kun qoldi | 🟠 To'q sariq |
| Bugun tugaydi | 🔴 Qizil |
| Muddati o'tgan | ⚫ Qora |

---

## ⏱️ Ariza muddatini hisoblash (`MUDDAT_QOIDALARI` varag'i)

Ariza ijro muddati (ish kunlari) **ustuvor qoidalar** bo'yicha avtomatik hisoblanadi
(Excel formulasining aniq ekvivalenti — `BusinessLogic.computeDeadlineDays`). Qoidalar
yuqoridan pastga tekshiriladi — **birinchi mos kelgani** ishlatiladi.

Qiymatlar **`MUDDAT_QOIDALARI`** varag'ida saqlanadi (tizim avtomatik yaratadi va standart
qiymatlar bilan to'ldiradi). Varaqni "Ariza muddati" bo'limidan (UI) yoki to'g'ridan-to'g'ri
tahrirlash mumkin. Faqat **kun sonini** o'zgartirasiz; tuzilma (shartlar tartibi) va maydon
chegaralari kodda turadi.

**Varaq ustunlari:** `KALIT` · `TAVSIF` · `QIYMAT (ish kuni)`

Standart qoidalar va qiymatlari (formuladan olingan):

| KALIT | Shart | QIYMAT |
|-------|-------|--------|
| `manba:Kadastr muhandisi` | Ariza manbasi = "Kadastr muhandisi" | 3 |
| `manba:UZKAD` | Ariza manbasi = "UZKAD" | 5 |
| `flag:FREE` | Kadastr passport olish turi = "FREE" | 5 |
| `ariza:Registratsiya (tashqi - UZKAD da bor)` | Ariza turi (aniq moslik) | 1 |
| `ariza:Avtoyo'l va suv xo'jaligi obyektining kadastr pasportini shakllantirish va ro'yxatga olish` | Ariza turi | 7 |
| `ariza:Notarius uchun ma'lumotnoma (uz)` | Ariza turi | 1 |
| `ariza:Qurilishi tugallangan ko'chmas mulkni foydalanishga qabul qilish` | Ariza turi | 10 |
| `turar:yer_maydoni` | Turar obyekt/kompozit + Obyekt turi 2 = "Turar yer maydoni" | 7 |
| `turar:default` | Turar obyekt/kompozit (boshqa) | 10 |
| `noturar:daraxtlar` | Noturar + Priznak = "Ko'p yillik daraxtlar xizmati" | 15 |
| `noturar:yer_yoki_davlat` | Noturar yer maydoni / Davlat ijara yer uchastkasi | 7 |
| `umumiy:turar` | Umumiy foydalanish — "Turar" deb aniqlangan | 10 |
| `maydon:<100` | Maydon < 100 m² | 10 |
| `maydon:<=1000` | Maydon 100–1000 m² | 12 |
| `maydon:<=5000` | Maydon 1000–5000 m² | 17 |
| `maydon:<=15000` | Maydon 5000–15000 m² | 22 |
| `maydon:<=50000` | Maydon 15000–50000 m² | 28 |
| `maydon:>50000` | Maydon > 50000 m² | 37 |
| `default` | Hech qaysi qoidaga mos kelmasa | 10 |

**Yangi aniq qoida qo'shish:** UI orqali yoki varaqda `manba:<qiymat>`, `ariza:<qiymat>` yoki
`flag:<qiymat>` ko'rinishida yangi qator qo'shing. `turar:*`, `noturar:*`, `maydon:*` va
`default` — tuzilmaviy kalitlar (o'chirilmaydi, faqat qiymati o'zgartiriladi).

> Formula ishlashi uchun standart hisobot fayli quyidagi ustunlarni saqlashi shart:
> `Ariza turi`, `Obyekt turi 2`, `Priznak`, `Ariza manbasi`, `Kadastr passport olish turi`,
> `Tashqi o'lchovlar bo'yicha maydon`.

---

## 🗂️ Spreadsheet varaqlari

Tizim quyidagi varaqlardan foydalanadi. Mavjud bo'lmasa — **avtomatik yaratiladi**
(`MUDDAT_QOIDALARI`, `HOLIDAYS`, `SERVICE_RULES` standart qiymatlar bilan to'ldiriladi):

`DASHBOARD`, `HISOBOT`, `DATA`, `STATISTICS`, `FINANCE`, `LOGIN`, `EMPLOYEES`,
`SETTINGS`, `HOLIDAYS`, `SERVICE_RULES`, `AREA_RULES`, `MUDDAT_QOIDALARI`, `EXPORT`,
`BACKUP`, `IMPORT_LOG`, `LOGIN_LOG`, `ACTION_LOG`, `MONTHLY_STATS`, `CACHE`

> **HISOBOT** — asosiy ma'lumot manbai. Ustun sarlavhalari import vaqtida avtomatik
> moslashtiriladi (`Repository.hisobotHeaderMapper`), shuning uchun turli nomlanishlarni qo'llab-quvvatlaydi.


---

## 🧱 Kod tuzilmasi (arxitektura)

Loyiha modulli qurilgan (MVC + Repository + Service + Utility qatlamlari):

### Server (`.gs`)

| Fayl | Vazifasi |
|------|----------|
| `Config.gs` | Markaziy konfiguratsiya (SETTINGS varaq + standart qiymatlar) |
| `Constants.gs` | Varaq nomlari, status/rang kodlari, rollar, ruxsatlar |
| `Utils.gs` | Sana, matn, raqam, xavfsizlik, massiv yordamchilari |
| `Cache.gs` | Uch qatlamli kesh (memory + CacheService + Properties) |
| `Repository.gs` | Spreadsheet o'qish/yozish (ommaviy, chunk) |
| `Validation.gs` | Kirish ma'lumotlarini tekshirish |
| `BusinessCalendar.gs` | Ish kunlari va muddat hisoblash |
| `BusinessLogic.gs` | Status, residency, SLA, progress, to'lov hisoblash |
| `Import.gs` | Bir tugmali import + rollback |
| `Statistics.gs` | Statistik tahlil va reytinglar |
| `Finance.gs` | Moliyaviy tahlil |
| `Dashboard.gs` | Markaziy so'rov xizmati (scope, filtr, sahifalash) |
| `Security.gs` | Parol heshlash, sessiya, CSRF, ruxsat |
| `Login.gs` | Autentifikatsiya, foydalanuvchilar boshqaruvi |
| `Reports.gs` | Tayyor hisobotlar |
| `Export.gs` | CSV / Excel / PDF / chop etish |
| `Notification.gs` | AppLog (audit) + bildirishnomalar |
| `Menu.gs` | Spreadsheet menyusi |
| `Triggers.gs` | Davriy vazifalar (kunlik/soatlik) |
| `Code.gs` | `doGet` router + barcha API endpointlar |

### Frontend (`.html`)

`layout`, `navbar`, `sidebar`, `footer`, `loading`, `error`, `login`, `dashboard`,
`profile`, `changePassword` + `theme` / `style` (CSS) + `script` / `login.js` / `dashboard.js` (JS).


---

## ⚡ Ishlash unumdorligi (100 000+ qator)

- Bitta `getValues()` / `setValues()` bilan ommaviy o'qish-yozish
- Chunk (bo'lak) bo'yicha yozuv (`importChunkSize`)
- Map / Dictionary indekslash (`Utils.indexBy`, `groupBy`)
- Oldindan hisoblangan statistika va kesh (`CacheService` + memory)
- Server tomonida filtrlash va sahifalash (Virtual Table)
- Qidiruvda debounce, importда LockService (concurrency himoyasi)

---

## 🛡️ Xavfsizlik

- Parol **salt + ko'p iteratsiyali SHA-256** zanjiri bilan heshlanadi
- Sessiya tokenlari (`CacheService` + `PropertiesService`), muddati avtomatik tugaydi
- **CSRF** tokeni holat o'zgartiruvchi har bir amalda tekshiriladi
- Login urinishlari cheklanadi va hisob vaqtincha bloklanadi
- Parol tarixi (oxirgi parollarni qayta ishlatmaslik)
- XSS himoyasi (HTML ekranlash), rol/ruxsat tekshiruvi server tomonida

---

## 🚀 O'rnatish va ishga tushirish

Ikki usul mavjud. **Clasp orqali o'rnatish tavsiya etiladi** — barcha fayllar
bir zumda, to'g'ri nomlar bilan yuklanadi va versiyalar aralashib ketmaydi.

### A usul — Clasp orqali (tavsiya etiladi) ✅

**Talab:** [Node.js](https://nodejs.org) o'rnatilgan bo'lishi kerak.

1. Repozitoriyni yuklab oling (clone yoki ZIP) va papkaga kiring:
   ```bash
   git clone https://github.com/SalohiyatDP/DKP_Arizalar_Nazorati.git
   cd DKP_Arizalar_Nazorati
   ```
2. Clasp'ni o'rnating va Google hisobingizga kiring:
   ```bash
   npm install            # @google/clasp ni o'rnatadi
   npm run login          # brauzerda Google hisobni tasdiqlaysiz
   ```
   > Birinchi marta foydalanyapsizmi? [Apps Script API](https://script.google.com/home/usersettings)
   > ni **yoqib qo'ying** (Settings → Google Apps Script API → ON).
3. **Script ID** ni oling: Spreadsheet → **Kengaytmalar → Apps Script** →
   **Loyiha sozlamalari (⚙️) → "Script ID"** ni nusxalang.
4. `.clasp.json` faylini yarating (namuna `.clasp.json.example` da bor):
   ```json
   { "scriptId": "SIZNING_SCRIPT_ID", "rootDir": "." }
   ```
5. Barcha fayllarni yuklang:
   ```bash
   npm run push           # = clasp push -f
   ```
6. Apps Script muharririda `appsscript.json` saqlanganini tekshiring.
7. Spreadsheet menyusidan **DKP Nazorat → Administrator yaratish** ni bosing.
8. **Deploy → New deployment → Web app** orqali joylashtiring va URL'dan kiring.

**Foydali clasp buyruqlari:**

| Buyruq | Vazifasi |
|--------|----------|
| `npm run push` | Barcha o'zgarishlarni yuklash (`clasp push -f`) |
| `npm run pull` | Apps Script'dan o'zgarishlarni olib kelish |
| `npm run watch` | O'zgarishlarni avtomatik yuklab turish |
| `npm run open` | Loyihani brauzerda ochish |
| `npm run deploy` | Yangi deployment yaratish |
| `npm run logs` | Server loglarini ko'rish |

> `.claspignore` fayli faqat `.gs`, `.html` va `appsscript.json` fayllarini
> yuklaydi — README, package.json va boshqalar yuklanmaydi.

### B usul — Qo'lda nusxalash

1. Spreadsheet → **Kengaytmalar → Apps Script** ni oching.
2. Har bir faylni qo'lda yarating va tarkibini nusxalang.

> ⚠️ **HTML fayl nomlari aniq bo'lishi shart** (Apps Script `.html` ni o'zi qo'shadi):
> | Repozitoriy fayli | Apps Script'dagi nom |
> |---|---|
> | `script.html` | **script** |
> | `login.js.html` | **login.js** |
> | `dashboard.js.html` | **dashboard.js** |
> | `dashboard.html` | **dashboard** |
>
> Agar `login.js` ni "login" deb nomlasangiz — `include()` ishlamaydi va sahifa buziladi.
> Shu sababli **Clasp usuli ancha ishonchli**.

3. `appsscript.json` ni saqlang, administratorni yarating, Web app sifatida joylashtiring.

### Standart kirish

```
Login:  admin
Parol:  Admin@2026
```

> ⚠️ Birinchi kirishdan so'ng parolni o'zgartirish **majburiy**.

### Triggerlarni o'rnatish

Apps Script muharririda `installTriggers` funksiyasini bir marta ishga tushiring —
kunlik texnik xizmat va soatlik muddat yangilanishi avtomatik bo'ladi.


---

## 🔄 Import jarayoni

Bir tugma bosilganda quyidagi oqim bajariladi (`Import.run`):

```
Zaxira → Import (HISOBOT) → Tekshirish → Transformatsiya → Biznes mantiq →
Statistika → Moliya → Kesh → Dashboard → Loglar → Tayyor
```

Xato yuz bersa, **DATA** varag'i avtomatik ravishda **BACKUP**'dan tiklanadi (rollback).

---

## ⚙️ Sozlamalar (SETTINGS varag'i)

Administrator `SETTINGS` varag'idan quyidagilarni o'zgartirishi mumkin:

`APP_NAME`, `ORGANIZATION`, `SESSION_TTL_MIN`, `PAGE_SIZE`, `CACHE_TTL_SEC`,
`DEFAULT_DEADLINE_DAYS`, `PASSWORD_MIN_LENGTH`,
`MAX_LOGIN_ATTEMPTS`, `NOTIFY_EMAIL_ENABLED`, `NOTIFY_ADMIN_EMAIL`, `DARK_MODE_DEFAULT`

---

## 📊 Texnologiyalar

- Google Apps Script (V8 runtime)
- Google Sheets (ma'lumotlar bazasi)
- HTML / CSS / JavaScript
- Material Design 3 (responsiv, Dark / Light rejim)
- Google Charts (grafiklar)

---

## 📄 Litsenziya

Ushbu tizim **Davlat Kadastr Palatasi** ichki foydalanishi uchun ishlab chiqilgan.

---

*DKP Arizalar Nazorati — Enterprise Analytics Platform · v1.0.0*
