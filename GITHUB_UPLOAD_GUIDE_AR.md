# دليل رفع HINDAZA Project Management v60 إلى GitHub

هذه الحزمة تحتوي على الشفرة المصدرية الكاملة، ملفات قاعدة البيانات، الأصول، الاختبارات، وملفات إعداد البناء. لا تتضمن `node_modules` أو ملفات البناء المؤقتة لأنها تُنشأ تلقائيًا بعد التنزيل.

## المتطلبات

- تثبيت Git: https://git-scm.com/downloads
- تثبيت Node.js 22.13 أو أحدث: https://nodejs.org/
- حساب GitHub وصلاحية الكتابة على المستودع.
- المستودع المستهدف: `https://github.com/haitham14540/hindaza-project-management.git`

## الطريقة الموصى بها: نسخة نظيفة وفرع مراجعة

استخدم هذه الطريقة لتجنب خطأ `non-fast-forward` أو بقاء عملية `REBASE` معلقة.

1. فك ضغط ملف التطبيق في مجلد واضح، مثل:

   `C:\Users\ADMIN\Downloads\hindaza-project-management-v60`

2. افتح **Git Bash** ثم انتقل إلى مجلد مناسب للعمل:

   ```bash
   cd /c/Users/ADMIN
   ```

3. نزّل المستودع الحالي من GitHub داخل مجلد جديد:

   ```bash
   git clone https://github.com/haitham14540/hindaza-project-management.git hindaza-project-management-v60-github
   cd hindaza-project-management-v60-github
   ```

4. أنشئ فرعًا مستقلًا للإصدار الجديد:

   ```bash
   git switch -c release/v60
   ```

5. انسخ **محتويات** مجلد `hindaza-project-management-v60` بعد فك الضغط إلى هذا المجلد، مع الموافقة على استبدال الملفات. لا تحذف مجلد `.git` الموجود داخل مجلد GitHub الجديد.

   من PowerShell يمكن تنفيذ النسخ بالأمر التالي بعد تعديل المسار عند الحاجة:

   ```powershell
   robocopy "C:\Users\ADMIN\Downloads\hindaza-project-management-v60" "C:\Users\ADMIN\hindaza-project-management-v60-github" /E /XD .git node_modules dist .next .wrangler
   ```

   ملاحظة: قد يعيد `robocopy` رمز خروج من 1 إلى 7 رغم نجاح النسخ؛ هذه الرموز تعني عادة أن الملفات نُسخت أو حُدثت.

6. ارجع إلى Git Bash وافحص الملفات:

   ```bash
   git status
   ```

7. ثبّت الاعتماديات وشغّل الفحوصات:

   ```bash
   npm ci
   npm run lint
   npm test
   ```

8. أضف جميع تغييرات الإصدار، ثم أنشئ Commit:

   ```bash
   git add -A
   git commit -m "Publish HINDAZA Project Management v60"
   ```

9. ارفع الفرع إلى GitHub:

   ```bash
   git push -u origin release/v60
   ```

10. افتح صفحة المستودع في GitHub. ستظهر رسالة **Compare & pull request**. اضغط عليها، واجعل:

    - Base branch: `main`
    - Compare branch: `release/v60`
    - العنوان: `Publish HINDAZA Project Management v60`

11. راجع الملفات، ثم أنشئ Pull Request واضغط **Merge pull request** بعد نجاح الفحوصات.

## إذا أردت الرفع مباشرة إلى main

نفّذ هذا فقط بعد الاحتفاظ بنسخة احتياطية والتأكد أن محتوى GitHub الحالي لا يحتوي على تغييرات تريد الاحتفاظ بها:

```bash
git switch main
git pull --rebase origin main
git merge --ff-only release/v60
git push origin main
```

إذا فشل `--ff-only`، لا تستخدم `--force`. أكمل عبر Pull Request كما في الطريقة الموصى بها.

## حل مشكلة REBASE المعلّقة

إذا ظهر في الطرفية `(REBASE 1/1)`، افحص الحالة أولًا:

```bash
git status
```

إذا كنت لا تحتاج متابعة عملية الدمج القديمة:

```bash
git rebase --abort
```

بعدها استخدم طريقة النسخة النظيفة أعلاه. لا تحذف ملفات المشروع ولا تستخدم `git reset --hard`.

## تشغيل التطبيق محليًا

داخل مجلد المشروع:

```bash
npm ci
npm run dev
```

ثم افتح العنوان الذي يظهر في الطرفية. لإجراء الفحص الكامل:

```bash
npm run lint
npm test
```

## قاعدة البيانات والنشر

الأسرار وقيم البيئة لا تُحفظ داخل GitHub. يجب إعدادها في منصة الاستضافة. لتطبيق ترحيلات قاعدة البيانات على Cloudflare D1 بعد ضبط Wrangler:

```bash
npx wrangler d1 migrations apply DB --remote
```

لا تشغّل هذا الأمر قبل التأكد من أن ربط `DB` يشير إلى قاعدة البيانات الصحيحة.

## الملفات غير المضمّنة عمدًا

- `node_modules`: يُنشأ بواسطة `npm ci`.
- `dist` و`.next`: تُنشأ بواسطة البناء.
- `.wrangler`: ملفات محلية مؤقتة.
- كلمات المرور، مفاتيح API، وقيم البيئة السرية.

