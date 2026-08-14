# دليل رفع HINDAZA V121 وتفعيل تنبيهات البريد الإلكتروني

هذه الحزمة تحتوي مصدر النسخة **V121** عند الالتزام:

`9e41c7d4245471683f0af120cb95b3b3ca1db33d`

> مهم: النسخة الحالية ترسل التنبيهات داخل التطبيق وتحفظها في جدول `notifications` داخل D1. إرسال البريد الإلكتروني غير مفعّل في V121، ويحتاج إضافة دالة إرسال وربطها بنقاط إنشاء التنبيهات كما هو موضح أدناه.

## 1. رفع المشروع إلى GitHub

أنشئ مستودعًا فارغًا في حساب GitHub `haitham14540`، مثل:

`hindaza-project-management`

ثم افتح الطرفية داخل مجلد المشروع ونفّذ:

```bash
git init
git add .
git commit -m "HINDAZA Project Management V121"
git branch -M main
git remote add origin https://github.com/haitham14540/hindaza-project-management.git
git push -u origin main
```

إذا كان المستودع موجودًا مسبقًا، انسخ الملفات إليه وراجع التغييرات ثم استخدم `git add` و`git commit` و`git push`. لا ترفع ملفات `.env` أو `.dev.vars` أو مفاتيح API أو ملفات النسخ الاحتياطية.

## 2. ربط GitHub بـCloudflare Workers

من Cloudflare Dashboard:

1. افتح **Workers & Pages**.
2. اختر Worker الحالي إذا كنت تريد الحفاظ على بيئته، ثم اربطه بمستودع GitHub من إعدادات Builds، أو اختر **Create application → Import a repository** لمشروع جديد.
3. اختر المستودع والفرع `main`.
4. اجعل Root directory هو `/`.
5. استخدم Deploy command:

```bash
npm run deploy:cloudflare
```

6. استخدم Node.js `22.13` أو أحدث.
7. كل Push جديد إلى `main` سيشغّل البناء والنشر تلقائيًا.

مرجع Cloudflare الرسمي:

https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/

## 3. الحفاظ على D1 وR2 الحاليين

إذا كان الهدف نقل الكود فقط مع الحفاظ على البيانات الحالية، **لا تنشئ D1 أو R2 جديدين**.

1. من Cloudflare افتح قاعدة D1 الحالية وانسخ `database_id`.
2. ضع المعرّف في `wrangler.jsonc` بدل:

```text
00000000-0000-0000-0000-000000000000
```

3. حافظ على اسم الربط `DB`.
4. اربط حاوية R2 الحالية باسم الربط `BUCKET`، وتأكد أن `bucket_name` يطابق الحاوية الحالية.
5. طبّق الترحيلات غير المطبقة فقط:

```bash
npm ci
npm run db:migrate:remote
```

6. أضف `SETUP_KEY` كـSecret إذا كانت البيئة جديدة. لا تضعه في GitHub.

في حال إنشاء بيئة Cloudflare جديدة بالكامل، اتبع خطوات D1 وR2 وBackup/Restore الموجودة في `README.md`.

## 4. اختيار خدمة البريد

الطريقة المباشرة المقترحة هي استخدام Resend كخدمة بريد معاملات عبر HTTPS من Cloudflare Worker. لا تعتمد على Cloudflare Email Routing كبديل تلقائي لإرسال تنبيهات التطبيق؛ Email Routing مخصص أساسًا لاستقبال وإعادة توجيه البريد، بينما التطبيق يحتاج API إرسال معاملات.

### إعداد النطاق

1. أنشئ حسابًا في Resend.
2. أضف نطاقًا فرعيًا مخصصًا للإرسال، مثل:

```text
notify.hindaza.com
```

3. أضف سجلات SPF وDKIM التي يعرضها Resend إلى DNS في Cloudflare، أو استخدم الربط التلقائي مع Cloudflare.
4. انتظر حتى تصبح حالة النطاق `Verified`.
5. أنشئ API key بصلاحية الإرسال.

مراجع Resend الرسمية:

- https://resend.com/docs/dashboard/domains/introduction
- https://resend.com/docs/knowledge-base/cloudflare
- https://resend.com/docs/api-reference/emails/send-email

## 5. حفظ إعدادات البريد في Cloudflare

أضف هذه القيم إلى Worker من **Settings → Variables and Secrets**:

| الاسم | النوع | مثال |
|---|---|---|
| `RESEND_API_KEY` | Secret | `re_...` |
| `EMAIL_FROM` | Variable أو Secret | `HINDAZA Tasks <notifications@notify.hindaza.com>` |
| `APP_BASE_URL` | Variable | رابط التطبيق المنشور بدون `/` في النهاية |
| `EMAIL_NOTIFICATIONS_ENABLED` | Variable | `true` |

يمكن إضافة المفتاح من الطرفية أيضًا:

```bash
npx wrangler secret put RESEND_API_KEY
```

لا تضع قيمة المفتاح في `wrangler.jsonc` ولا في GitHub. للاختبار المحلي استخدم `.dev.vars` وأضفه إلى `.gitignore`.

مرجع Cloudflare الرسمي:

https://developers.cloudflare.com/workers/configuration/secrets/

## 6. إضافة دالة إرسال البريد

أنشئ ملفًا مثل `lib/email-notifications.ts`. يمكن استخدام `fetch` مباشرة لتجنب إضافة مكتبة جديدة:

```ts
import { env } from "cloudflare:workers";

type EmailNotification = {
  to: string;
  title: string;
  message: string;
  taskId?: number | null;
  issueId?: number | null;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char] || char);
}

export async function sendNotificationEmail(notification: EmailNotification) {
  if (env.EMAIL_NOTIFICATIONS_ENABLED !== "true") return;
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM || !notification.to) return;

  const path = notification.taskId
    ? `/?view=projects&section=tasks&task=${notification.taskId}`
    : notification.issueId
      ? `/?view=projects&section=issues&issue=${notification.issueId}`
      : "/";
  const url = `${String(env.APP_BASE_URL || "").replace(/\/$/, "")}${path}`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [notification.to],
      subject: notification.title,
      html: `<div style="font-family:Arial,sans-serif">
        <h2>HINDAZA Project Management</h2>
        <p>${escapeHtml(notification.message)}</p>
        <p><a href="${escapeHtml(url)}">Open notification</a></p>
      </div>`,
      text: `${notification.message}\n\n${url}`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Email provider returned ${response.status}`);
  }
}
```

أضف الأنواع اللازمة لمتغيرات البيئة إذا كان المشروع يستخدم تعريفًا ثابتًا لـ`Env`.

## 7. ربط البريد بالتنبيهات الحالية

الأفضل إنشاء دالة موحدة مثل `createNotification()` تقوم أولًا بإضافة التنبيه إلى D1، ثم تحاول إرسال البريد لنفس `recipientEmail`. يجب أن يكون البريد **best effort**: فشل خدمة البريد لا يلغي التنبيه الداخلي ولا يعيد العملية الأساسية كخطأ.

نمط الاستخدام:

```ts
await db.insert(notifications).values(notification);

try {
  await sendNotificationEmail({
    to: notification.recipientEmail,
    title: notification.title,
    message: notification.message,
    taskId: notification.taskId,
    issueId: notification.issueId,
  });
} catch (error) {
  console.error("Notification email failed", error);
}
```

طبّق الدالة الموحدة بدل أو بعد إنشاء التنبيه في الملفات التالية:

- `app/api/tasks/route.ts`
- `app/api/task-comments/route.ts`
- `app/api/task-subtasks/route.ts`
- `app/api/task-timer/route.ts`
- `app/api/issues/route.ts`
- `app/api/issue-comments/route.ts`
- `app/api/issues/convert/route.ts`

بهذا تبقى قواعد V121 كما هي: البريد يذهب فقط إلى نفس مستلم التنبيه الداخلي الذي تحدده صلاحيات التطبيق، ولا يتم إنشاء قائمة مستلمين جديدة.

## 8. نقاط الأمان والجودة

- لا ترسل كلمات المرور أو محتوى المرفقات في البريد.
- ضع عنوان المهمة أو المشكلة ورسالة مختصرة ورابطًا فقط.
- اهرب أي نص مستخدم داخل HTML لمنع HTML injection.
- لا تجعل فشل البريد يفشل إنشاء المهمة أو الملاحظة.
- سجل فشل الإرسال في Worker Logs من دون تسجيل API key.
- أضف لاحقًا خيارًا لكل مستخدم لتفعيل أو تعطيل بريد التنبيهات إذا أردت ذلك؛ هذا يحتاج حقلًا جديدًا في جدول `users` وترحيل D1.
- عند كثرة الرسائل، استخدم Cloudflare Queues لإرسال البريد خارج طلب المستخدم وإعادة المحاولة بأمان.

## 9. الاختبار قبل التفعيل العام

1. اجعل `EMAIL_NOTIFICATIONS_ENABLED=false` أثناء نشر الكود أول مرة.
2. فعّل الإرسال إلى حساب اختبار واحد.
3. اختبر على الأقل:
   - إسناد مهمة جديدة.
   - إضافة ملاحظة من الموظف.
   - إضافة ملاحظة من المسؤول.
   - إرسال مهمة خاصة للمسؤول.
   - تحويل مشكلة إلى مهمة.
   - ملاحظات المشكلة ورد العميل.
4. راجع أن التنبيه الداخلي والبريد يذهبان إلى الشخص نفسه.
5. راجع Worker Logs وأخطاء Resend.
6. بعد نجاح الاختبار، غيّر `EMAIL_NOTIFICATIONS_ENABLED=true` ثم أعد النشر.

## 10. أوامر الفحص والنشر

```bash
npm ci
npm test
npm run deploy:dry-run
npm run db:migrate:remote
npm run deploy:cloudflare
```

لا تنفّذ `db:migrate:remote` إلا بعد التأكد أن `wrangler.jsonc` يشير إلى قاعدة D1 الصحيحة.
