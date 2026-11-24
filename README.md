# Faktorito

Membership and invoice management for gyms. A gym owner adds members, issues invoices, tracks who is paid up and until when, and talks to members through announcements. Members get their own panel with their subscription, invoices and notifications, all updated live.

The interface is Persian (fa-IR, right to left). A Persian version of this document is in [README.fa.md](README.fa.md).

## Contents

* [Features](#features)
* [Tech stack](#tech-stack)
* [Quick start](#quick-start)
* [Configuration](#configuration)
* [How it works](#how-it-works)
* [Project structure](#project-structure)
* [Security](#security)
* [Real time](#real-time)
* [Design and accessibility](#design-and-accessibility)
* [Testing](#testing)
* [License](#license)

## Features

**Accounts**
* One shared sign-up and login for everybody (`/register`, `/login`), with a 6 digit e-mail code (OTP) to verify the account, login with a code, password reset and e-mail change.
* Anybody can create a gym from inside their own panel at `/gym/create` after accepting the gym owner terms. That promotes the account to owner.
* Account deletion is a request: the account is deactivated at once and an admin reviews it.

**For gym owners**
* Members with an automatic code (`M-0001`), phone, status (active, frozen, inactive) and soft delete (nothing is removed from the database, members can be restored).
* Plans with a name and a price. A plan has no duration.
* Invoices for a member, with extra items and discounts. The subscription period (none, 1, 2, 3, 4, 6 or 12 months) is chosen on the invoice, and paying it extends the member's subscription by that period.
* Auto-issue: for one member, "issue this plan every 1, 2, 3, 4, 6 or 12 months". Edit, pause, run now or delete it at any time.
* Subscription overview: for every member, the date the subscription ends, how many days are left and a bar showing the remaining share.
* Freezing a subscription: the frozen days are added back when the member is unfrozen (at most 180 days).
* Announcements shown in every member's panel for 1 hour up to 7 days (24 hours by default).
* Sales report for 7, 30 or 90 days: daily revenue and revenue by plan.
* Public invoice page with a QR code, four themes (Aurora, Midnight, Mono and the black and gold Luxe), a generated SVG avatar for the gym and a signature drawn on a canvas.

**For members**
* A panel with the gym they belong to, their subscription, invoices, announcements and notifications.
* An account belongs to at most one gym at a time. A member leaves the gym from their panel, or the owner removes them. A gym owner cannot be a member of another gym, and a gym member cannot create a gym.

**For admins**
* Roles `admin` and `moderator` with a permission matrix and a rule that nobody acts on an account of equal or higher rank. Account and invoice review, suspension, role changes and deletion requests.

## Tech stack

* Node.js 20 or newer, ES modules
* Express 5, EJS templates, Tailwind (CDN) and Bootstrap Icons
* MongoDB with Mongoose, sessions in MongoDB (connect-mongo)
* Socket.IO for real time, on the same session as the web app
* Nodemailer with Gmail, used only for one-time codes
* Joi for validation (all messages in Persian), Helmet, express-rate-limit
* Tests with the built-in `node:test` runner, jsdom and axe-core

## Quick start

Requirements: Node.js 20+ and a running MongoDB.

```bash
git clone https://github.com/aydope/faktorito.git
cd faktorito
npm ci
npm run seed                # optional demo data
npm run dev                 # http://localhost:3001
```

The seed creates a demo gym with 20 members, paid and unpaid invoices and an auto-issue rule:

| Account | E-mail | Password |
|---|---|---|
| Gym owner | demo@faktorito.local | Demo@1234 |
| Member | member@faktorito.local | Demo@1234 |

Without Gmail credentials the one-time codes are printed to the server console, so you can sign up locally without sending any mail.

| Script | What it does |
|---|---|
| `npm run dev` | Start with nodemon in development mode |
| `npm start` | Start in production mode |
| `npm test` | Run all tests (no database needed) |
| `npm run seed` | Create the demo data |
| `npm run backfill:public-ids` | Give old invoices an unguessable public id |

## Configuration

Required in production: `MONGODB_URI`, `SESSION_SECRET` (at least 32 characters), `GMAIL_USER` and `GMAIL_PASSWORD`. The server refuses to start with a clear message if one of them is missing.

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `SESSION_SECRET` | Signs session cookies |
| `GMAIL_USER`, `GMAIL_PASSWORD` | Sender account. The password must be a Google App Password (2-Step Verification on), not the normal password. Spaces in it are fine |
| `MAIL_FROM_NAME` | Display name of the sender |
| `APP_URL` | Public base URL used in links and the QR code |
| `PORT` | HTTP port (default 3001) |
| `TRUST_PROXY` | 1 behind one reverse proxy (Railway, Nginx), 0 otherwise |
| `CORS_ORIGIN` | Extra allowed origins, comma separated |
| `REDIS_URL` | Optional Redis for rate limiting |
| `OTP_SECRET` | Secret for hashing one-time codes (defaults to `SESSION_SECRET`) |
| `QUOTA_TIMEZONE` | Time zone that defines "a day" for the daily quotas (default `Asia/Tehran`) |
| `DISABLE_JOBS` | 1 to skip the background jobs |
| `LEGAL_ENTITY`, `CONTACT_EMAIL`, `LEGAL_JURISDICTION`, `RETENTION_DAYS` | Filled into the terms and privacy pages |
| `LIMIT_*` | Optional per-owner limits, see below |

Limits per gym owner (defaults in `src/config/limits.js`): 500 members, 7 plans, 200 invoices per 24 hours, 50 unpaid invoices at a time, 100 active auto-issue rules, 5 announcements per 24 hours, 60 new members per 24 hours. Usage is shown on the settings page.

## How it works

**Roles and panels**

| Role | Panel | Can |
|---|---|---|
| `member` | `/me` | See their gym, subscription, invoices, announcements. Leave the gym. Create a gym |
| `owner` | `/dashboard` | Manage members, plans, invoices, auto-issue, announcements, reports and settings |
| `admin` | `/admin` | Review users and invoices, suspend, review deletion requests |
| `moderator` | `/admin` | Everything an admin can, plus role changes and deletion. Cannot be granted from the UI |

**Subscriptions.** Plans only hold a name and a price. The period belongs to the invoice (or to the auto-issue rule, which uses its interval as the period). When an invoice is paid, the member's subscription end date moves forward by that period. Paying early adds to the remaining time, paying late starts from today.

**Auto-issue.** Due dates are counted from the first date in whole intervals, so a rule that starts on the 31st issues on Feb 28 and then on Mar 31 instead of drifting. After a long outage only one invoice is issued, not a backlog. A frozen member or an earlier unpaid invoice skips the cycle.

**Daily budgets for the whole service.** Both are counted in MongoDB with one atomic update, so they stay exact across restarts and several instances:
* At most 25 new registrations per day.
* At most 25 + 1 e-mails per day. Only one-time codes are e-mailed. Invoices, reminders and announcements are shown in the app and pushed live, never mailed.

A failed attempt gives its slot back. When a budget is used up the visitor gets a clear message and a `Retry-After` header, and the sign-up page shows it before anyone types.

## Project structure

The layout follows the original repository and only adds folders.

```
app.js                 entry point (env check, database, migrations, server, jobs)
src/
  createApp.js         Express app (security, sessions, routes, error handling)
  config/              env check, security, session, permissions, limits, legal, migrations
  middleware/          auth, account status, CSRF, validation, errors
  models/              User, Member, Plan, Invoice, AutoInvoice, Announcement,
                       Notification, Otp, DailyQuota
  routes/              pages, auth, gym, members, invoices, autoInvoices,
                       announcements, reports, branding, panel, admin
  services/            members, invoices, OTP, mail, quotas, limits, notifications, reports
  jobs/                auto-issue and expiry reminders
  realtime/            Socket.IO server and live topics
  validators/          Joi schemas and the Persian message dictionary
  utils/               avatar, invoice sheet, signature, duration and period helpers
  emails/              the one-time code mail
views/                 EJS pages and partials
public/                realtime.js, a11y.js, a11y.css, cookie-consent.js
scripts/               seed and maintenance scripts
tests/                 unit, HTTP, jsdom and end-to-end socket tests
```

## Security

* CSRF protection by checking `Sec-Fetch-Site` and `Origin` on every state-changing request.
* Passwords hashed with bcrypt, one-time codes stored only as keyed hashes, attempt limits and cooldowns, sessions invalidated after a password change.
* Every query is scoped to the signed-in owner. Inputs that reach MongoDB are coerced to plain strings or enums, and search text is regex-escaped.
* Strict Helmet settings and rate limits, stronger on sign-up and login.
* Public invoices use a random id and show only a masked phone number.
* The error page and JSON errors show a status code, a short safe message and a tracking code. Stacks and raw messages never reach the browser, even in development. Details go to the server log under the same tracking code.
* Uploads do not exist: the signature is sent as drawn points, validated and turned into an SVG path on the server, and the avatar is generated from the owner id.
* All validation messages are Persian, and unknown fields are dropped before they reach the code.

## Real time

One Socket.IO connection per page, authenticated with the web session. Each user only joins their own room, and suspended or signed-out visitors cannot connect.

* Notifications arrive live and are stored. They are marked read when they were actually seen: the panel is open, the tab is visible and the item stayed in view for about a second. Clicking one reads it at once, and reading syncs across tabs and devices.
* Pages refresh themselves. The server sends a `live` event with topics (`invoices`, `members`, `dashboard`, `reports`, `announcements`, `me`) and the page re-reads only the regions marked `data-live`, or runs its own handler. Nothing is replaced while a dialog is open or a field is being edited.
* After a lost connection everything is re-synced, and a small dot beside the bell shows the connection state.

## Design and accessibility

The interface is dark, RTL and built around a few shared parts: a shell with a sidebar and a notification bell, cards, one invoice sheet shared by the landing page, the public invoice and the settings preview, and a generated avatar for every gym.

Implemented:
* A skip link, real landmarks (`header`, `nav`, `aside`, `main`, `footer`) and a focusable `main` target.
* Visible keyboard focus on every control.
* Names for icon-only buttons, decorative icons hidden from screen readers, announced toasts and field errors.
* Dialogs with a role, focus moved in, Tab kept inside, Escape to close and focus returned to the opener. The closed off-canvas menu cannot be reached with Tab.
* Muted text colors raised to at least 4.5:1 on every dark surface (the original gray-500 was 4.0:1 on cards and gray-600 2.6:1), type never below 11px on invoices, touch targets of 44px on touch screens and reduced motion respected.
* Responsive layouts, including the error page, which scrolls on short screens.

How it is checked:
* axe-core runs over every page template in the test suite and must report no violations.
* The dialog, skip link, naming and live-region behavior are tested in jsdom.
* The contrast numbers for the muted text and focus ring are computed in the tests.

Not checked, so do not take it as proven: color contrast of every individual element in a real browser, a screen reader pass, a Lighthouse run, and any usability testing with real gym owners and members.

## Testing

```bash
npm test
```

Runs about 200 tests without a database: validators, permissions, quotas, the register flow over HTTP, error pages, the real client script in jsdom, axe on all pages and the real Socket.IO server with real clients.

A flow test against a real MongoDB is included and skipped unless you opt in. It signs up, creates a gym, adds a member, issues and pays an invoice, tests announcements, auto-issue, notifications, leaving a gym and the daily quotas. It wipes the database, so it refuses to run unless the database name ends with `_it`, `_test` or `_tmp`:

```bash
INTEGRATION_MONGODB_URI=mongodb://127.0.0.1:27017/faktorito_it npm test
```

## License

MIT, see [LICENSE](LICENSE).
