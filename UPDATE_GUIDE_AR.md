# تحديث إصلاح أعضاء المشاريع

يعالج هذا التحديث خطأ:

```text
One or more project members are invalid.
```

السبب هو وجود رابط قديم داخل المشروع لموظف حُذف أو تغير دوره أو أصبح غير نشط. عند تعديل المشروع، يحفظ النظام المعلومات الجديدة ويزيل الرابط غير الصالح تلقائيًا بدل رفض العملية كاملة.

## طريقة التطبيق

فك ضغط ملف التحديث. انسخ مجلدات `app` و`tests` إلى المجلد الأساسي للمشروع، ووافق على استبدال الملفات الثلاثة الموجودة.

أو من Git Bash، عدّل المسارين في الأمر التالي حسب مكان ملفاتك:

```bash
cp -a "/c/PATH/HINDAZA_Project_Member_Fix_v27/." "/c/PATH/hindaza-project-management-sync/"
```

ثم ادخل إلى مجلد المشروع:

```bash
cd "/c/PATH/hindaza-project-management-sync"
```

نفّذ الفحص:

```bash
npm run lint
npm test
```

ثم ارفع التحديث:

```bash
git add app/api/projects/route.ts app/task-dashboard.tsx tests/roles-and-workflow.test.mjs
git commit -m "Fix invalid project members on project update"
git push origin main
```

إذا كان GitHub مرتبطًا بـCloudflare، يبدأ النشر تلقائيًا. إذا لم يبدأ:

```bash
npm run deploy:cloudflare
```

لا يحتاج هذا الإصلاح إلى ترحيل جديد لقاعدة البيانات، ولا يحتاج إلى تعديل `wrangler.jsonc`، ولا يحذف المشاريع أو المهام أو الموظفين.

