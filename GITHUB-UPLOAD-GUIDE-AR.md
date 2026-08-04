# دليل رفع HINDAZA Project Management إلى GitHub وCloudflare

هذه الحزمة جاهزة للرفع إلى المستودع:

`https://github.com/haitham14540/hindaza-project-management`

لا تحتوي الحزمة على كلمات مرور أو مفتاح `SETUP_KEY` أو بيانات قاعدة البيانات أو ملف Backup.

## أولًا: رفع الملفات إلى GitHub باستخدام Git Bash

فك ضغط الحزمة، ثم افتح Git Bash داخل مجلد المشروع ونفّذ:

```bash
git init
git branch -M main
git remote add origin https://github.com/haitham14540/hindaza-project-management.git
git add .
git commit -m "HINDAZA Project Management v18"
git pull origin main --rebase
git push -u origin main
```

إذا كان المجلد مرتبطًا بالمستودع مسبقًا، استخدم فقط:

```bash
git add .
git commit -m "Update HINDAZA Project Management"
git pull origin main --rebase
git push origin main
```

## ثانيًا: تجهيز Cloudflare

سجّل الدخول ثم أنشئ قاعدة D1 وحاوية R2:

```bash
npx wrangler login
npx wrangler d1 create hindaza-project-management-db
npx wrangler r2 bucket create hindaza-project-management-files
```

ضع رقم `database_id` الناتج داخل `wrangler.jsonc` بدل:

```text
00000000-0000-0000-0000-000000000000
```

ثم طبّق الجداول:

```bash
npm ci
npm run db:migrate:remote
```

## ثالثًا: إعداد مفتاح المالك

في إعدادات Worker على Cloudflare أضف Secret باسم:

```text
SETUP_KEY
```

استخدم قيمة قوية خاصة بك ولا تضفها إلى GitHub أو أي ملف داخل المشروع.

## رابعًا: النشر

للنشر يدويًا:

```bash
npm run deploy:cloudflare
```

وللنشر التلقائي من GitHub استخدم:

- Production branch: `main`
- Root directory: `/`
- Build command: فارغ
- Deploy command: `npm run deploy:cloudflare`
- Node.js: `22.13` أو أحدث

## خامسًا: استعادة البيانات

بعد إنشاء حساب المالك في التطبيق الجديد:

1. افتح السهم بجانب اسم المالك.
2. اختر **Restore Backup**.
3. اختر ملف Backup المحفوظ على جهازك.
4. انتظر رسالة نجاح الاستعادة؛ سيبقى حساب المالك الحالي وكلمة مروره كما هما.

لا ترفع ملف Backup إلى GitHub لأنه يحتوي بيانات النظام ومعلومات الدخول المشفرة.
