# تحديث GitHub إلى النسخة النهائية

هذه الحزمة هي النسخة 14 من تطبيق HINDAZA Project Management، وتشمل:

- حسابات المدير والموظفين بصلاحيات منفصلة
- ربط الموظفين بالمشاريع
- الإشعارات وواجهات RFI وProject Issues
- مؤقت متعدد الجلسات لبدء وإيقاف واستئناف المهام
- المهام الخاصة بالموظف وإرسالها للمسؤول
- سجل الملاحظات
- التقارير الأسبوعية والشهرية
- Backup & Restore لنقل البيانات

## مهم قبل رفع الملفات

لم نضع ملف `wrangler.jsonc` داخل هذه الحزمة حتى لا يتم استبدال رقم قاعدة D1 الحالية. احتفظ بملف `wrangler.jsonc` الموجود حاليًا في مستودع GitHub كما هو، وتأكد فقط من أن:

```json
"compatibility_date": "2026-08-01"
```

وأن `database_id` يحتوي على رقم قاعدة D1 الحالية وليس رقمًا تجريبيًا.

## تحديث المستودع من Git Bash

1. فك ضغط الحزمة.
2. انسخ جميع محتويات المجلد إلى:

```text
C:\Users\ADMIN\hindaza-project-management
```

3. وافق على استبدال الملفات الموجودة. لا تحذف ملف `wrangler.jsonc` الموجود في مجلد المشروع.
4. افتح Git Bash داخل مجلد المشروع ونفذ:

```bash
git status
git add -A
git commit -m "Update to latest project management version"
git push origin main
```

سيبدأ Cloudflare نشر النسخة الجديدة تلقائيًا. بعد نجاح النشر نفذ:

```bash
npx wrangler d1 migrations apply DB --remote
```

ثم حدّث الموقع باستخدام `Ctrl + F5`.
