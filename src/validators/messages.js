/**
 * Persian wording for every Joi error. Individual schemas keep their own,
 * more specific messages; these are the defaults that apply whenever a schema
 * has none (wrong type, too long, unknown field, ...), so a visitor can never
 * get an English "is not allowed to be empty".
 */

/** How a field is called in a message. Unknown fields fall back to a neutral word. */
export const FIELD_LABELS = Object.freeze({
  username: "نام کاربری",
  email: "ایمیل",
  password: "رمز عبور",
  currentPassword: "رمز عبور فعلی",
  newPassword: "رمز عبور جدید",
  confirmPassword: "تکرار رمز عبور",
  code: "کد",
  reason: "دلیل",
  acceptTerms: "پذیرش شرایط",
  acceptBusinessTerms: "پذیرش شرایط صاحبان باشگاه",
  clubName: "نام باشگاه",
  clubPhone: "تلفن باشگاه",
  clubAddress: "آدرس باشگاه",
  clubEmail: "ایمیل باشگاه",
  clubCode: "کد باشگاه",
  name: "نام",
  phone: "شماره تلفن",
  notes: "یادداشت",
  note: "یادداشت",
  status: "وضعیت",
  description: "توضیحات",
  price: "قیمت",
  title: "عنوان",
  body: "متن",
  hours: "مدت نمایش",
  memberName: "نام عضو",
  memberPhone: "شماره تلفن عضو",
  memberRef: "عضو",
  memberId: "عضو",
  planId: "پلن",
  periodMonths: "دوره‌ی اشتراک",
  intervalMonths: "بازه‌ی صدور",
  nextIssueAt: "تاریخ صدور",
  items: "آیتم‌ها",
  discounts: "تخفیف‌ها",
  isPaid: "وضعیت پرداخت",
  saveAsMember: "ذخیره به عنوان عضو",
  active: "فعال",
  invoiceTheme: "تم فاکتور",
  strokes: "امضا",
  signerName: "نام زیر امضا",
  signaturePosition: "جای امضا",
  signatureColor: "رنگ امضا",
  removeSignature: "حذف امضا",
  page: "صفحه",
  limit: "تعداد",
  ids: "شناسه‌ها",
});

const DEFAULT_LABEL = "مقدار";

/** Joi message templates ({{#label}}, {{#limit}} ... are filled in by Joi). */
export const JOI_MESSAGES_FA = Object.freeze({
  "any.required": "{{#label}} الزامی است",
  "any.invalid": "{{#label}} معتبر نیست",
  "any.only": "{{#label}} معتبر نیست",
  "any.unknown": "{{#label}} مجاز نیست",
  "any.custom": "{{#label}} معتبر نیست",
  "any.ref": "{{#label}} معتبر نیست",

  "string.base": "{{#label}} باید متن باشد",
  "string.empty": "{{#label}} نمی‌تواند خالی باشد",
  "string.min": "{{#label}} باید حداقل {{#limit}} کاراکتر باشد",
  "string.max": "{{#label}} نباید بیشتر از {{#limit}} کاراکتر باشد",
  "string.length": "{{#label}} باید دقیقاً {{#limit}} کاراکتر باشد",
  "string.email": "{{#label}} معتبر نیست",
  "string.hex": "{{#label}} معتبر نیست",
  "string.alphanum": "{{#label}} فقط می‌تواند شامل حروف انگلیسی و عدد باشد",
  "string.pattern.base": "{{#label}} معتبر نیست",
  "string.pattern.name": "{{#label}} معتبر نیست",
  "string.pattern.invert.base": "{{#label}} معتبر نیست",
  "string.uri": "{{#label}} باید یک نشانی معتبر باشد",
  "string.isoDate": "{{#label}} باید تاریخ معتبر باشد",
  "string.lowercase": "{{#label}} باید با حروف کوچک نوشته شود",
  "string.uppercase": "{{#label}} باید با حروف بزرگ نوشته شود",
  "string.trim": "{{#label}} نباید با فاصله شروع یا تمام شود",

  "number.base": "{{#label}} باید عدد باشد",
  "number.integer": "{{#label}} باید عدد صحیح باشد",
  "number.min": "{{#label}} نمی‌تواند کمتر از {{#limit}} باشد",
  "number.max": "{{#label}} نمی‌تواند بیشتر از {{#limit}} باشد",
  "number.greater": "{{#label}} باید بیشتر از {{#limit}} باشد",
  "number.less": "{{#label}} باید کمتر از {{#limit}} باشد",
  "number.positive": "{{#label}} باید مثبت باشد",
  "number.negative": "{{#label}} باید منفی باشد",
  "number.unsafe": "{{#label}} بیش از حد بزرگ است",
  "number.infinity": "{{#label}} معتبر نیست",
  "number.multiple": "{{#label}} باید مضرب {{#multiple}} باشد",

  "boolean.base": "{{#label}} باید درست یا نادرست باشد",

  "date.base": "{{#label}} باید تاریخ معتبر باشد",
  "date.format": "{{#label}} باید تاریخ معتبر باشد",
  "date.min": "{{#label}} نمی‌تواند قبل از {{#limit}} باشد",
  "date.max": "{{#label}} نمی‌تواند بعد از {{#limit}} باشد",
  "date.greater": "{{#label}} باید بعد از {{#limit}} باشد",
  "date.less": "{{#label}} باید قبل از {{#limit}} باشد",

  "array.base": "{{#label}} باید فهرست باشد",
  "array.min": "{{#label}} باید حداقل {{#limit}} مورد داشته باشد",
  "array.max": "{{#label}} نباید بیشتر از {{#limit}} مورد داشته باشد",
  "array.length": "{{#label}} باید دقیقاً {{#limit}} مورد داشته باشد",
  "array.includes": "{{#label}} شامل مقدار نامعتبر است",
  "array.includesRequiredUnknowns": "{{#label}} شامل همه‌ی موارد لازم نیست",
  "array.unique": "{{#label}} شامل مقدار تکراری است",
  "array.sparse": "{{#label}} نباید مورد خالی داشته باشد",

  "object.base": "{{#label}} معتبر نیست",
  "object.unknown": "فیلد «{{#label}}» مجاز نیست",
  "object.min": "حداقل {{#limit}} فیلد باید ارسال شود",
  "object.max": "حداکثر {{#limit}} فیلد مجاز است",
  "object.length": "تعداد فیلدها معتبر نیست",
  "object.missing": "حداقل یکی از فیلدها باید ارسال شود",
  "object.and": "فیلدهای مرتبط باید با هم ارسال شوند",
  "object.with": "{{#label}} بدون {{#peer}} معتبر نیست",
  "object.without": "{{#label}} و {{#peer}} با هم مجاز نیستند",
  "object.nand": "فیلدهای ارسالی با هم سازگار نیستند",
  "object.xor": "فقط یکی از فیلدها باید ارسال شود",
  "object.oxor": "حداکثر یکی از فیلدها باید ارسال شود",
  "object.or": "حداقل یکی از فیلدها باید ارسال شود",
  "object.regex": "{{#label}} معتبر نیست",
  "alternatives.any": "{{#label}} معتبر نیست",
  "alternatives.match": "{{#label}} معتبر نیست",
  "alternatives.types": "{{#label}} معتبر نیست",
  "alternatives.all": "{{#label}} معتبر نیست",
  "alternatives.one": "{{#label}} معتبر نیست",
});

/** The options every validation uses (messages in Persian, labels without quotes so we can translate them). */
export const JOI_OPTIONS = Object.freeze({
  abortEarly: false,
  stripUnknown: true,
  messages: JOI_MESSAGES_FA,
  errors: { wrap: { label: false } },
});

/** "ایمیل", or "آیتم‌ها (ردیف 2)" for the 2nd entry of an array. */
export const labelFor = (detail) => {
  const path = detail.path || [];
  const key = [...path].reverse().find((k) => typeof k === "string");
  const row = path.find((k) => typeof k === "number");
  const base = FIELD_LABELS[key] || DEFAULT_LABEL;
  return row === undefined ? base : `${base} (ردیف ${row + 1})`;
};

/** The final Persian message of one Joi error detail. */
export const messageFor = (detail) => {
  const raw = detail.context?.label;
  if (!raw || !detail.message.includes(raw)) return detail.message;
  return detail.message.replace(raw, labelFor(detail));
};
