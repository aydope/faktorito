import QRCode from "qrcode";
import { renderAvatar } from "./avatar.js";
import { planDuration, hasDuration, durationLabel } from "./duration.js";
import { safeSignaturePath, buildSignaturePath } from "./signature.js";

/** Invoice looks an owner can choose from. */
export const THEMES = Object.freeze([
  { key: "aurora", label: "Aurora", hint: "بنفش و مدرن؛ همان ظاهر صفحه‌ی اول" },
  { key: "midnight", label: "Midnight", hint: "آبی شبانه، تمیز و رسمی" },
  { key: "mono", label: "Mono", hint: "سیاه و سفید، مینیمال و اداری" },
  {
    key: "luxe",
    label: "Luxe",
    hint: "مشکی و طلایی، برای برندهای لاکچری و اختصاصی",
  },
]);
export const THEME_KEYS = THEMES.map((t) => t.key);
export const DEFAULT_THEME = "aurora";
export const normalizeTheme = (t) =>
  THEME_KEYS.includes(t) ? t : DEFAULT_THEME;

const HEX = /^#[0-9a-fA-F]{6}$/;
const POSITIONS = ["left", "center", "right"];

const shortDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("fa-IR-u-nu-latn", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

export const makeQr = (url) =>
  QRCode.toString(url, {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
    color: { dark: "#111827", light: "#ffffff" },
  });

const signatureOf = (owner) => {
  const sg = owner?.signature;
  const path = safeSignaturePath(sg?.path);
  if (!path) return null;
  return {
    path,
    color: HEX.test(sg.color || "") ? sg.color : "#111827",
    name: (sg.signerName || "").slice(0, 40),
    position: POSITIONS.includes(sg.position) ? sg.position : "right",
  };
};

const avatarOf = (owner) =>
  renderAvatar(
    String(owner?._id || owner?.id || owner?.clubName || "x"),
    owner?.clubName,
  );

/** What the shared invoice sheet renders, built from a real invoice. */
export const toSheet = ({ invoice, owner, qrSvg = "" }) => {
  const plan = invoice.plan || {};
  const hasPlan = plan.name && (plan.price > 0 || plan.name !== "فروش متفرقه");
  const duration = planDuration(plan);
  const extras = [];
  const discounts = [];
  for (const it of invoice.extraItems || []) {
    if (it.type === "discount" || it.price < 0)
      discounts.push({ name: it.name, price: it.price });
    else extras.push({ name: it.name, price: it.price });
  }
  const name = invoice.member?.name || "-";

  return {
    theme: normalizeTheme(owner?.invoiceTheme),
    domId: "invoiceContainer",
    club: owner?.clubName || "باشگاه",
    phone: owner?.clubPhone || "",
    address: owner?.clubAddress || "",
    avatar: avatarOf(owner),
    tracking: invoice.trackingCode || "",
    isPaid: !!invoice.isPaid,
    paidDate: shortDate(invoice.paidAt),
    number: invoice.invoiceNumber,
    date: invoice.invoiceDate || shortDate(invoice.createdAt),
    member: {
      name,
      phone: invoice.member?.phone || "",
      code: invoice.member?.memberId || "",
      initial: name.trim().charAt(0) || "؟",
    },
    plan: hasPlan
      ? {
          name: plan.name,
          price: plan.price,
          period: hasDuration(duration) ? durationLabel(duration) : "",
        }
      : null,
    extras,
    discounts,
    note: invoice.note || "",
    total: invoice.totalAmount,
    signature: signatureOf(owner),
    qrSvg,
  };
};

const SAMPLE_STROKES = [
  [
    [18, 150],
    [40, 90],
    [62, 40],
    [78, 120],
    [96, 170],
    [118, 110],
    [140, 60],
    [156, 140],
    [176, 168],
  ],
  [
    [196, 150],
    [236, 120],
    [286, 98],
    [340, 108],
    [392, 140],
    [452, 150],
    [520, 120],
    [566, 92],
  ],
];

/** A fully fake invoice for the landing page and the theme preview. */
export const sampleSheet = async ({
  theme = DEFAULT_THEME,
  owner = {},
  origin = "",
} = {}) => {
  const sampleOwner = {
    _id: "sample-gym-owner",
    clubName: "باشگاه ورزشی المپیک",
    clubPhone: "09123456789",
    clubAddress: "تهران، خیابان ولیعصر",
    ...owner,
  };
  const useOwnerSignature = !!safeSignaturePath(owner?.signature?.path);
  const signature = useOwnerSignature
    ? signatureOf(sampleOwner)
    : {
        path: buildSignaturePath(SAMPLE_STROKES),
        color: "#111827",
        name: "مدیریت باشگاه",
        position: "right",
      };

  return {
    theme: normalizeTheme(theme),
    sample: true,
    club: sampleOwner.clubName,
    phone: sampleOwner.clubPhone,
    address: sampleOwner.clubAddress,
    avatar: avatarOf(sampleOwner),
    tracking: "TRK-98765432",
    isPaid: true,
    paidDate: "",
    number: "INV-1405-0042",
    date: "1405/06/15",
    member: {
      name: "محمد رضایی",
      phone: "09123456789",
      code: "M-0042",
      initial: "م",
    },
    plan: { name: "پلن طلایی 3 ماهه", price: 2450000, period: "3 ماهه" },
    extras: [
      { name: "مکمل پروتئین", price: 350000 },
      { name: "جلسه مربی خصوصی", price: 450000 },
    ],
    discounts: [{ name: "تخفیف ویژه (15٪)", price: -487500 }],
    note: "این فاکتور شامل تخفیف ویژه اعضای طلایی می‌باشد.",
    total: 2762500,
    signature,
    qrSvg: await makeQr(`${origin || "https://faktorito.example"}/i/sample`),
  };
};
