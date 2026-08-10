# رفع HINDAZA Project Management V76 إلى GitHub

هذه الحزمة تحتوي على كود النسخة المعتمدة **V76**، وتشمل الواجهة، واجهات API، مخطط قاعدة البيانات، ملفات الترحيل، الاختبارات، الأصول، وإعدادات البناء.

> تنبيه: بيانات التشغيل الموجودة حاليًا داخل قاعدة D1 والمرفقات المحفوظة في R2 وكلمات المرور والقيم السرية ليست جزءًا من حزمة الكود. احتفظ بنسخة احتياطية من داخل التطبيق بصورة منفصلة عند الحاجة إلى نقل البيانات.

## الطريقة الآمنة الموصى بها

ارفع V76 في فرع مستقل، ثم ادمجه مع `main` من GitHub. بهذه الطريقة تبقى النسخة الحالية قابلة للاسترجاع.

### 1. فك الضغط

فك الملف في هذا المسار مثلًا:

```text
C:\Users\ADMIN\hindaza-project-management-v76
```

### 2. إنشاء نسخة نظيفة من مستودع GitHub

افتح **Git Bash** ونفّذ الأوامر التالية فقط:

```bash
cd /c/Users/ADMIN
git clone https://github.com/haitham14540/hindaza-project-management.git hindaza-project-management-github
cd /c/Users/ADMIN/hindaza-project-management-github
git switch -c release/v76 origin/main
```

إذا كان المجلد `hindaza-project-management-github` موجودًا مسبقًا، غيّر اسمه أو احذفه بعد التأكد أنه لا يحتوي عملًا غير محفوظ، ثم أعد أمر `git clone`.

### 3. نسخ ملفات V76 فوق النسخة المستنسخة

من **PowerShell** نفّذ:

```powershell
Get-ChildItem -Force "C:\Users\ADMIN\hindaza-project-management-v76" | Copy-Item -Destination "C:\Users\ADMIN\hindaza-project-management-github" -Recurse -Force
```

لا تنسخ أي مجلد باسم `.git` من المصدر. الحزمة المرفقة لا تحتويه أصلًا.

### 4. فحص الملفات وتثبيت المتطلبات

ارجع إلى **Git Bash**:

```bash
cd /c/Users/ADMIN/hindaza-project-management-github
git status
npm ci
npm test
```

يجب أن تنتهي الاختبارات دون أخطاء قبل الرفع.

### 5. حفظ النسخة ورفع الفرع

```bash
git add -A
git commit -m "Publish HINDAZA Project Management V76"
git push -u origin release/v76
```

### 6. دمج الفرع مع main

افتح صفحة المستودع:

```text
https://github.com/haitham14540/hindaza-project-management
```

ثم:

1. افتح **Pull requests**.
2. اختر **New pull request**.
3. اجعل `base` هو `main` و`compare` هو `release/v76`.
4. اضغط **Create pull request**.
5. راجع الملفات، ثم اضغط **Merge pull request**.
6. أكد الدمج.

لا تكتب كلمات مثل `Open:` أو `Click:` أو رابط GitHub مباشرة داخل Git Bash؛ هذه تعليمات وليست أوامر. افتح الرابط من المتصفح.

### 7. تأكيد أن main يحمل V76

```bash
cd /c/Users/ADMIN/hindaza-project-management-github
git switch main
git pull origin main
git log -1 --oneline
git status
```

المفترض أن يعرض `git status` العبارة:

```text
nothing to commit, working tree clean
```

## في حال ظهور non-fast-forward

لا تستخدم `git push --force` على `main`. نفّذ:

```bash
git fetch origin
git rebase origin/main
git push -u origin release/v76
```

إذا ظهر تعارض، أوقف العملية وأرسل صورة الرسالة قبل اختيار أي ملف أو حذفه.

## تشغيل التطبيق محليًا

```bash
npm ci
npm run dev
```

## بناء نسخة الإنتاج

```bash
npm run build
```

