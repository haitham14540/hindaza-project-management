# HINDAZA Project Management

نظام داخلي لإدارة مشاريع ومهام فريق HINDAZA Engineering BIM. يدعم حسابات المدير والموظفين، المشاريع، المهام، مراجعة المسؤول، سجل الملاحظات، الإشعارات، مؤقت العمل متعدد الجلسات، المهام الخاصة، والتقارير الأسبوعية والشهرية.

## المتطلبات

- Node.js 22.13 أو أحدث
- حساب Cloudflare يدعم Workers وD1
- GitHub repository مرتبط بـCloudflare Workers Builds

## التشغيل محليًا

```bash
npm ci
npm run db:migrate:local
npm run dev
```

ملفات البناء الحالية تستخدم Bash، لذلك على Windows استخدم Git Bash أو WSL.

## الإعداد لأول مرة على Cloudflare

### 1. إنشاء قاعدة البيانات

بعد تسجيل الدخول إلى Wrangler:

```bash
npx wrangler login
npx wrangler d1 create hindaza-project-management-db
```

انسخ قيمة `database_id` التي يعرضها Cloudflare، ثم ضعها داخل `wrangler.jsonc` بدل القيمة:

```text
00000000-0000-0000-0000-000000000000
```

لا تغيّر اسم الربط `DB` لأن التطبيق يعتمد عليه.

### 2. تطبيق جداول قاعدة البيانات

```bash
npm run db:migrate:remote
```

### 3. النشر المباشر

```bash
npm run deploy:cloudflare
```

أمر النشر ينفّذ البناء أولًا، ثم يرفع Worker والملفات الموجودة في `dist/client`. هذا يمنع خطأ Cloudflare السابق المتعلق بعدم وجود مجلد `dist/client`.

### 4. إعداد مفتاح إنشاء المدير

بعد أول نشر، أضف Secret باسم `SETUP_KEY` من:

`Cloudflare Dashboard → Workers & Pages → hindaza-project-management → Settings → Variables and Secrets`

اختر قيمة قوية لا تقل عن 16 حرفًا، ولا تحفظها داخل GitHub. عند فتح التطبيق لأول مرة سيطلب منك هذا المفتاح لإنشاء حساب المدير الأساسي.

## الربط التلقائي مع GitHub وCloudflare

عند إنشاء Worker من GitHub استخدم الإعدادات التالية:

| الإعداد | القيمة |
|---|---|
| Repository | `haitham14540/hindaza-project-management` |
| Production branch | `main` |
| Root directory | `/` |
| Build command | اتركه فارغًا |
| Deploy command | `npm run deploy:cloudflare` |
| Node version | `22.13` أو أحدث |

بعد ربط المستودع، أي تحديث جديد على فرع `main` سيُبنى ويُنشر تلقائيًا.

## الأمان

- لا ترفع `.env` أو `.dev.vars` أو API tokens إلى GitHub.
- لا تضع `SETUP_KEY` داخل `wrangler.jsonc`.
- حساب الموظف التجريبي غير موجود في حزمة GitHub الإنتاجية. أضف الموظفين من بوابة الفريق بعد إنشاء حساب المدير.
- كلمات المرور تُخزّن كـPBKDF2 hash داخل D1 ولا تُحفظ كنص واضح.

## نقل بيانات النسخة الحالية

1. افتح النسخة الحالية بحساب المدير.
2. انتقل إلى **الفريق · Team**.
3. اختر **تنزيل Backup** واحفظ ملف JSON في مكان آمن.
4. بعد نشر التطبيق الجديد وإنشاء حساب المدير الأول، افتح بوابة الفريق واختر **استعادة البيانات**.
5. حدد ملف الـBackup. سيستبدل التطبيق الجديد بياناته بمحتويات الملف، ثم يسجّل خروجك تلقائيًا.
6. سجّل الدخول باستخدام حساب المدير وكلمة المرور الموجودين في النسخة القديمة.

النسخة الاحتياطية تشمل الموظفين ومعلومات تسجيل الدخول المشفرة والمشاريع والمهام والملاحظات والإشعارات وسجلات الوقت. لا تشمل جلسات الدخول النشطة، ولا يجب رفع ملف الـBackup إلى GitHub.

## أوامر الفحص

```bash
npm run lint
npm test
npm run deploy:dry-run
```

## بنية المشروع

- `app/` واجهة التطبيق ومسارات API
- `db/` تعريف قاعدة البيانات
- `drizzle/` ترحيلات D1
- `worker/` نقطة تشغيل Cloudflare Worker
- `public/` شعار HINDAZA والأصول العامة
- `wrangler.jsonc` إعداد Cloudflare وD1

رفع الكود إلى GitHub وإنشاء D1 جديدة لا ينقل البيانات تلقائيًا؛ استخدم خطوات Backup & Restore أعلاه بعد تشغيل التطبيق الجديد.
