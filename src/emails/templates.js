// Every dynamic value goes through esc(): names come from users.
export const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const BRAND = "#7c3aed";

const layout = ({
  preheader,
  title,
  intro,
  content = "",
  button = null,
  footer = "",
}) => `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body dir="rtl" style="margin:0;padding:0;background:#0b0b12;font-family:Tahoma,'Segoe UI',Arial,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader || title)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b12;padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#14141f;border:1px solid #28283a;border-radius:20px;overflow:hidden;direction:rtl;">
    <tr><td dir="rtl" style="background:linear-gradient(135deg,${BRAND},#a78bfa);padding:22px 28px;color:#fff;font-size:22px;font-weight:bold;">فاکتوریتو</td></tr>
    <tr><td dir="rtl" style="padding:30px 28px 8px;color:#e5e7eb;font-size:18px;font-weight:bold;">${esc(title)}</td></tr>
    <tr><td dir="rtl" style="padding:0 28px 8px;color:#9ca3af;font-size:14px;line-height:2;">${intro}</td></tr>
    <tr><td dir="rtl" style="padding:8px 28px 8px;">${content}</td></tr>
    ${
      button
        ? `<tr><td align="center" style="padding:14px 28px 6px;"><a href="${esc(button.href)}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:12px 28px;border-radius:12px;font-size:14px;font-weight:bold;">${esc(button.label)}</a></td></tr>`
        : ""
    }
    <tr><td dir="rtl" style="padding:22px 28px 28px;color:#6b7280;font-size:12px;line-height:1.9;border-top:1px solid #28283a;">${footer || "اگر این درخواست از طرف شما نبوده، این ایمیل را نادیده بگیرید."}</td></tr>
  </table>
</td></tr>
</table>
</body></html>`;

const codeBox = (code) =>
  `<div style="margin:6px 0;background:#0b0b12;border:1px dashed #4c1d95;border-radius:14px;padding:18px;text-align:center;direction:ltr;font-size:34px;font-weight:bold;letter-spacing:10px;color:#c4b5fd;font-family:'Courier New',monospace;">${esc(code)}</div>`;

const OTP_COPY = {
  verify: {
    subject: "کد تأیید ایمیل شما",
    title: "تأیید ایمیل",
    intro: "برای فعال‌سازی حساب، کد زیر را در صفحه‌ی تأیید وارد کنید.",
  },
  login: {
    subject: "کد ورود به فاکتوریتو",
    title: "کد ورود یک‌بارمصرف",
    intro: "برای ورود به حساب، کد زیر را وارد کنید.",
  },
  reset: {
    subject: "بازیابی رمز عبور",
    title: "بازیابی رمز عبور",
    intro: "برای تعیین رمز عبور جدید، این کد را در صفحه‌ی بازیابی وارد کنید.",
  },
  email_change: {
    subject: "تأیید ایمیل جدید",
    title: "تأیید آدرس ایمیل جدید",
    intro: "برای تغییر ایمیل حساب، این کد را وارد کنید.",
  },
};

export const otpEmail = ({ purpose, code, minutes, username }) => {
  const copy = OTP_COPY[purpose] || OTP_COPY.verify;
  return {
    subject: copy.subject,
    html: layout({
      preheader: `کد شما: ${code}`,
      title: copy.title,
      intro: `${username ? `سلام ${esc(username)}،<br>` : ""}${copy.intro}`,
      content:
        codeBox(code) +
        `<div style="color:#9ca3af;font-size:12px;text-align:center;margin-top:10px;">این کد تا ${esc(minutes)} دقیقه معتبر است. آن را با کسی به اشتراک نگذارید.</div>`,
    }),
    text: `${copy.title}\n\nکد شما: ${code}\nاعتبار: ${minutes} دقیقه\n`,
  };
};
