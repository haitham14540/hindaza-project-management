# رفع HINDAZA Project Management إلى GitHub

المستودع المستهدف:

`https://github.com/haitham14540/hindaza-project-management`

## 1. فك الضغط

فك ملف `HINDAZA_Project_Management_Latest_2026-08-06.zip`، ثم افتح Terminal أو Git Bash داخل مجلد المشروع الناتج.

## 2. تحقق من المتطلبات

- Git مثبت على الجهاز.
- Node.js إصدار `22.13.0` أو أحدث.
- تسجيل الدخول إلى حساب GitHub الذي يملك المستودع.

## 3. افحص التطبيق قبل الرفع

```bash
npm ci
npm test
```

يجب أن ينتهي الاختبار دون أخطاء.

## 4. الرفع إلى مستودع فارغ

استخدم هذه الخطوات إذا كان المستودع جديدًا أو فارغًا:

```bash
git init
git branch -M main
git remote add origin https://github.com/haitham14540/hindaza-project-management.git
git add .
git commit -m "Publish latest HINDAZA Project Management app"
git push -u origin main
```

## 5. تحديث مستودع يحتوي ملفات سابقة

الأفضل أخذ نسخة احتياطية من المستودع الحالي أولًا، ثم نفّذ:

```bash
git init
git branch -M main
git remote add origin https://github.com/haitham14540/hindaza-project-management.git
git fetch origin
git add .
git commit -m "Update HINDAZA Project Management"
git pull origin main --rebase
git push -u origin main
```

إذا ظهرت رسالة أن `origin` موجود مسبقًا، استخدم:

```bash
git remote set-url origin https://github.com/haitham14540/hindaza-project-management.git
```

## 6. التحقق بعد الرفع

افتح المستودع في GitHub وتأكد من ظهور `package.json` ومجلدات `app` و`db` و`drizzle` و`tests`، ثم راجع أن آخر Commit هو التحديث الذي رفعته.

## تنبيه أمني

لا ترفع ملفات `.env` أو كلمات المرور أو مفاتيح الوصول أو ملفات النسخ الاحتياطي لبيانات التطبيق. ملف `.gitignore` المرفق يستبعد الملفات المحلية الشائعة، لكن راجع الملفات قبل تنفيذ `git add .`.
