# دليل رفع HINDAZA Project Management إلى GitHub وCloudflare

هذه الحزمة هي النسخة التجريبية الأخيرة بعد إصلاح تحميل البيانات، وتحتوي كامل الكود والترحيلات والشعار والاختبارات.

## مهم قبل الرفع

ملف `wrangler.jsonc` داخل الحزمة يحتوي رقم قاعدة بيانات مؤقتًا:

```text
00000000-0000-0000-0000-000000000000
```

إذا كنت تريد الاحتفاظ بالمعلومات الموجودة حاليًا، لا تنشئ قاعدة D1 جديدة. انسخ `database_id` الحقيقي من ملف `wrangler.jsonc` الموجود في مستودعك الحالي، أو من:

`Cloudflare Dashboard → Storage & Databases → D1 → hindaza-project-management-db`

ثم استبدل الرقم المؤقت داخل الحزمة قبل الرفع أو النشر. لا تغيّر أسماء الربط `DB` و`BUCKET` و`IMAGES`.

## الطريقة الموصى بها: Git Bash

### 1. فك ضغط الحزمة

فك الملف في مجلد Downloads. يجب أن يصبح المسار قريبًا من:

```text
C:\Users\ADMIN\Downloads\HINDAZA_Project_Management_v26_GitHub
```

### 2. إنشاء نسخة نظيفة من مستودع GitHub

افتح Git Bash ونفّذ كل أمر منفردًا:

```bash
cd /c/Users/ADMIN
git clone https://github.com/haitham14540/hindaza-project-management.git hindaza-project-management-latest
cd hindaza-project-management-latest
```

استخدام مجلد جديد يمنع مشاكل `rebase` و`non-fast-forward` التي ظهرت سابقًا.

### 3. نسخ ملفات الإصدار الجديد

```bash
cp -a /c/Users/ADMIN/Downloads/HINDAZA_Project_Management_v26_GitHub/. .
```

بعد النسخ افتح `wrangler.jsonc` وتأكد أن `database_id` هو رقم قاعدة D1 الحقيقية، وليس الرقم المؤقت.

### 4. فحص النسخة قبل الرفع

```bash
npm ci
npm run lint
npm test
```

يجب أن تنتهي الاختبارات دون أخطاء.

### 5. تسجيل اسمك في Git مرة واحدة

```bash
git config --global user.name "Haitham Abu Salem"
git config --global user.email "haitham@eng-bim.com"
```

يمكنك تغيير البريد إذا كان بريد حساب GitHub مختلفًا.

### 6. رفع الملفات إلى GitHub

```bash
git add -A
git commit -m "Update HINDAZA Project Management"
git push origin main
```

إذا طلب GitHub تسجيل الدخول، أكمل تسجيل الدخول من نافذة المتصفح التي تظهر.

## تحديث قاعدة البيانات على Cloudflare

بعد التأكد من رقم `database_id` نفّذ:

```bash
npx wrangler login
npm run db:migrate:remote
```

الترحيلات تضيف التحديثات المطلوبة ولا تحذف المعلومات الموجودة.

## النشر

إذا كان GitHub مرتبطًا بـCloudflare، يبدأ النشر تلقائيًا بعد `git push`.

إعدادات Cloudflare الصحيحة:

| الإعداد | القيمة |
|---|---|
| Production branch | `main` |
| Root directory | `/` |
| Build command | فارغ |
| Deploy command | `npm run deploy:cloudflare` |
| Node version | `22.13` أو أحدث |

للنشر يدويًا من Git Bash:

```bash
npm run deploy:cloudflare
```

## إذا ظهر الإصدار القديم بعد نجاح النشر

1. تأكد أن آخر Deployment في Cloudflare حالته `Success` ومرتبط بآخر Commit.
2. افتح الموقع واضغط `Ctrl + F5` مرة واحدة.
3. جرّب نافذة Incognito للتأكد أن المتصفح لا يعرض ملفات قديمة.

## حماية البيانات

- لا ترفع ملفات Backup إلى GitHub.
- لا ترفع `.env` أو `.dev.vars` أو كلمات المرور أو مفاتيح Cloudflare.
- احتفظ بنسخة Backup حديثة قبل تطبيق الترحيلات أو الاستعادة.
- لا تستبدل `database_id` الحالي بقاعدة جديدة إذا كنت تريد بقاء الموظفين والمشاريع والمهام.

