# دليل رفع HINDAZA Project Management إلى GitHub وCloudflare

هذه الحزمة هي الإصدار التجريبي الكامل رقم **44**. تحتوي على كود التطبيق، قاعدة البيانات وتعريفاتها، جميع ترحيلات D1، الشعار، واجهات المهام ومشاكل المشاريع، الاختبارات، وإعدادات Cloudflare.

> مهم: الحزمة لا تحتوي على بيانات قاعدة D1 الفعلية ولا الملفات المرفوعة إلى R2 ولا كلمات السر. للحفاظ على بيانات التطبيق الحالي، اربط الكود بنفس D1 وR2 الموجودين في حساب Cloudflare.

## المتطلبات

- Git for Windows، ويتضمن Git Bash.
- Node.js 22.13 أو أحدث.
- حساب GitHub.
- حساب Cloudflare المرتبط بالمستودع.

تحقق من البرامج داخل Git Bash:

```bash
git --version
node -v
npm -v
```

## 1. فتح Git Bash من المجلد الجديد

1. فك ضغط ملف ZIP في أي مكان تختاره على القرص `C:` أو أي قرص آخر.
2. افتح المجلد الناتج في File Explorer.
3. اضغط بزر الفأرة الأيمن داخل مساحة فارغة في المجلد.
4. اختر **Open Git Bash here**. في Windows 11 قد تحتاج أولًا إلى **Show more options**.
5. تأكد أنك داخل المجلد الصحيح:

```bash
pwd
ls
```

يجب أن ترى ملفات مثل `package.json` و`wrangler.jsonc` ومجلدات `app` و`db` و`drizzle`.

## 2. الطريقة الآمنة لمزامنة النسخة مع GitHub

استخدم نسخة جديدة من المستودع حتى نتجنب تعارضات المحاولات السابقة.

انتقل إلى المجلد الأب، ثم استنسخ المستودع في مجلد جديد:

```bash
cd ..
git clone https://github.com/haitham14540/hindaza-project-management.git hindaza-project-management-sync
```

بعد انتهاء الاستنساخ:

1. افتح مجلد الحزمة `HINDAZA_Project_Management_v44_GitHub`.
2. انسخ **جميع الملفات والمجلدات** الموجودة داخله، بما فيها `.openai` و`.npmrc` و`.gitignore`.
3. الصقها داخل مجلد `hindaza-project-management-sync` واختر **Replace** عند السؤال.
4. لا تحذف مجلد `.git` الموجود داخل `hindaza-project-management-sync`.

بعد ذلك افتح Git Bash داخل مجلد `hindaza-project-management-sync` أو نفّذ:

```bash
cd ../hindaza-project-management-sync
git status
```

## 3. ضبط اسم المستخدم في Git عند الحاجة

نفّذ هذين الأمرين مرة واحدة فقط على جهازك، واستخدم بريد حساب GitHub الخاص بك:

```bash
git config --global user.name "Haitham AbuSalem"
git config --global user.email "YOUR_GITHUB_EMAIL"
```

## 4. ربط قاعدة D1 الحالية قبل الرفع

ملف `wrangler.jsonc` يحتوي مؤقتًا على:

```text
00000000-0000-0000-0000-000000000000
```

استبدله برقم قاعدة D1 الحالية في Cloudflare. يمكنك الحصول عليه من:

`Cloudflare Dashboard → Storage & Databases → D1 → hindaza-project-management-db`

أو بعد تسجيل الدخول من Git Bash:

```bash
npx wrangler login
npx wrangler d1 list
```

انسخ قيمة `uuid` الخاصة بقاعدة `hindaza-project-management-db` وضعها في `database_id` داخل `wrangler.jsonc`.

لا تنشئ قاعدة جديدة إذا كنت تريد الاحتفاظ بالمستخدمين والمشاريع والمهام الحالية.

## 5. التأكد من R2

التطبيق يستخدم حاوية الملفات التالية:

```text
hindaza-project-management-files
```

تحقق من وجودها:

```bash
npx wrangler r2 bucket list
```

إذا كانت موجودة، لا تنشئها مرة أخرى ولا تغيّر اسمها في `wrangler.jsonc`.

## 6. تثبيت الحزم وفحص التطبيق

من داخل مجلد `hindaza-project-management-sync`:

```bash
npm ci
npm run lint
npm test
```

قد تستغرق الاختبارات بضع دقائق. لا تتابع الرفع إذا ظهر خطأ أحمر؛ احتفظ بصورة الخطأ كاملة.

## 7. تطبيق تحديثات قاعدة البيانات الحالية

بعد وضع رقم D1 الصحيح:

```bash
npm run db:migrate:remote
```

هذا الأمر يطبق الترحيلات الجديدة على قاعدة البيانات نفسها، ولا يفترض أن يحذف البيانات الحالية.

قبل أي ترحيل مهم، يفضل تنزيل Backup من حساب المالك والاحتفاظ به خارج مجلد المشروع.

## 8. رفع الملفات إلى GitHub

اعرض التغييرات أولًا:

```bash
git status
```

ثم نفّذ:

```bash
git add -A
git commit -m "Update HINDAZA project management to version 44"
git push origin main
```

إذا ظهر أن المستودع محدث ولا توجد تغييرات، فهذا يعني أن الملفات الموجودة في GitHub مطابقة للحزمة.

## 9. إذا رفض GitHub عملية Push

إذا ظهر الخطأ `fetch first`، لا تستخدم `push --force`. نفّذ:

```bash
git pull --rebase origin main
git push origin main
```

إذا ظهر تعارض أثناء `rebase`، أوقف العملية بأمان:

```bash
git rebase --abort
```

ثم أرسل صورة كاملة للخطأ قبل تنفيذ أوامر أخرى.

## 10. المزامنة مع Cloudflare

إذا كان مشروع Cloudflare مرتبطًا بالمستودع وفرع `main`، يبدأ النشر تلقائيًا بعد نجاح `git push`.

الإعدادات المطلوبة في Cloudflare:

| الإعداد | القيمة |
|---|---|
| Repository | `haitham14540/hindaza-project-management` |
| Production branch | `main` |
| Root directory | `/` |
| Build command | يترك فارغًا |
| Deploy command | `npm run deploy:cloudflare` |
| Node.js | `22.13` أو أحدث |

تابع النشر من:

`Cloudflare Dashboard → Workers & Pages → hindaza-project-management → Deployments`

إذا لم يكن الربط التلقائي مفعلًا، يمكنك النشر يدويًا من Git Bash:

```bash
npx wrangler login
npm run deploy:cloudflare
```

## 11. التحقق بعد النشر

افتح الموقع واختبر بالترتيب:

1. تسجيل دخول المالك.
2. ظهور الموظفين والمشاريع والمهام.
3. فتح Project Issues ومشاهدة المشاكل والمرفقات.
4. تعديل مشروع موجود.
5. إضافة مهمة تجريبية ثم حذفها.
6. فتح التنبيهات والتأكد من المحاذاة الجديدة.

## حماية البيانات

- لا ترفع ملفات Backup إلى GitHub.
- لا ترفع `.env` أو `.dev.vars` أو أي Token.
- لا تضع `SETUP_KEY` داخل الكود.
- استخدام نفس `database_id` يحافظ على اتصال التطبيق بقاعدة البيانات الحالية.
- استخدام نفس اسم R2 يحافظ على اتصال التطبيق بالمرفقات الحالية.

## تحديثات التطبيق لاحقًا

بعد أي تعديل مستقبلي داخل مجلد `hindaza-project-management-sync`:

```bash
git status
git add -A
git commit -m "Describe the update"
git pull --rebase origin main
git push origin main
```

بعد `push` سيبدأ Cloudflare نشر النسخة الجديدة تلقائيًا عند تفعيل Git integration.
