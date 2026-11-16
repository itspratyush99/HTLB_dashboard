<p align="center"><img src="public/brand/htlb-logo.png" alt="HTLB Systems" width="140"></p>

# HTLB Candidate Tracker

The internal recruitment panel of **HTLB Systems** for hiring **Zonal Business Managers (ZBM)** and **Heads of States (HOS)** from Naukri.

**Live:** https://htlb-dashboard.vercel.app

**What the team does with it:**
- Upload the daily Naukri export. Duplicates are caught automatically.
- Track every candidate through the hiring stages.
- Filter on any column, and export straight into the bulk message sender's format.
- Move candidates to their next stage in bulk, with interviewers assigned at 1:1 Aligned.
- See a full history of every candidate and every action.
- Watch progress and bottlenecks on the Dashboard and in Analytics.

**Built with free tools:** Next.js, Supabase (database and login) and Vercel (hosting). It works on laptops and phones.

---

## Contents
1. [First-time setup](#1-first-time-setup-about-30-minutes-no-coding)
2. [Going live on Vercel](#2-going-live-on-vercel)
3. [Updating the live site](#3-updating-the-live-site)
4. [Environment variables](#4-environment-variables)
5. [Team users: adding, removing, passwords](#5-team-users)
6. [The daily routine](#6-the-daily-routine)
7. [Rules reference](#7-rules-reference)
8. [Using it on a phone](#8-using-it-on-a-phone)
9. [Supabase free tier: pausing](#9-supabase-free-tier-pausing)
10. [How the data is protected](#10-how-the-data-is-protected)
11. [Troubleshooting](#11-troubleshooting)
12. [For developers](#12-for-developers)

---

## 1. First-time setup (about 30 minutes, no coding)

### 1.1 Create the Supabase project
1. Go to **https://supabase.com** and sign up (or log in with GitHub or Google).
2. Click **New project**.
   - **Name:** `htlb-candidate-tracker`
   - **Database password:** click *Generate*, then save it in your password manager.
   - **Region:** **South Asia (Mumbai)**.
3. Click **Create new project** and wait 1–2 minutes.

### 1.2 Create the database (6 SQL files, in order)
The files are in `supabase/migrations/`. For **each file, in this order**:
1. Open **SQL Editor → New query**.
2. Open the file in Notepad or TextEdit, select all, copy, and paste it into the editor.
3. Click **Run** and wait for **"Success. No rows returned."**

| # | File | What it adds |
|---|---|---|
| 1 | `0001_init.sql` | Tables, security rules, the 6 stages, interviewers Pratyush / Parul / Umer, role keywords, limits |
| 2 | `0002_uploads.sql` | Upload support and duplicate lookups |
| 3 | `0003_candidate_search.sql` | Table search, filters, sorting, export |
| 4 | `0004_moves_and_history.sql` | Stage moves, interviewers, history, Activity Log |
| 5 | `0005_dashboard_analytics.sql` | Dashboard and Analytics |
| 6 | `0006_settings.sql` | Editable Settings and team-user safety rules |

> Supabase may warn about **"destructive operations"** on files 2, 4 and 6. That's expected: they replace a helper column or function with a newer version. **Run query** is safe, and no candidate data is removed.
>
> Run each file **once**. Running one twice can give "already exists" errors, which are harmless.

### 1.3 Make it invite-only
Go to **Authentication → Sign In / Providers**, turn **OFF** "Allow new users to sign up", and click **Save**.

### 1.4 Add yourself (you become admin)
1. Go to **Authentication → Users → Add user → Create new user**.
2. Enter your email and a strong password, tick **Auto Confirm User**, and click **Create user**.
   **The first user ever added becomes admin automatically.**
3. Set your display name, either later in the app under **Settings → Team users**, or now in **SQL Editor**:
   ```sql
   update profiles set full_name = 'Your Name' where email = 'you@example.com';
   ```

### 1.5 Copy three values
Go to **Project Settings → API** (or *API Keys*) and copy:

| Value | Where it goes | Secret? |
|---|---|---|
| **Project URL** | `NEXT_PUBLIC_SUPABASE_URL` | No |
| **anon / publishable key** | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No: it can't read anything without a login |
| **service_role / secret key** | `SUPABASE_SERVICE_ROLE_KEY` | **Yes.** Only ever paste it into Vercel. Never share it, put it in a file, or send it in chat. |

---

## 2. Going live on Vercel

### 2.1 Put the code on GitHub (private)
1. On **github.com**, click **+ → New repository**. Name it `htlb-dashboard`, choose **Private**, and click **Create repository**.
2. Click **"uploading an existing file"**. Drag in **everything inside** the project folder, then click **Commit changes**.

**Never upload these:**
- `node_modules`
- `.next`
- `.env.local`
- the sample files in `samples/`, which contain real candidates' data

On a Mac, press **Cmd + Shift + .** in Finder to show hidden files such as `.gitignore`, so they're uploaded too.

### 2.2 Deploy
1. On **vercel.com**, choose **Continue with GitHub**, then **Add New… → Project → Import** your repository.
2. Under **Environment Variables**, add all three values from 1.5 (see [section 4](#4-environment-variables)).
3. Click **Deploy**. After about 2 minutes the panel is live, e.g. `htlb-dashboard.vercel.app`.

### 2.3 Tell Supabase the live address
In Supabase, go to **Authentication → URL Configuration**, set **Site URL** to your Vercel address (e.g. `https://htlb-dashboard.vercel.app`), and click **Save**.

> **Vercel plan:** the free **Hobby** plan is for **non-commercial use only**. An internal company tool counts as business use, so HTLB should move the project to **Vercel Pro** (US$20/month). Nothing in the setup changes when you upgrade.

---

## 3. Updating the live site

Whenever you receive a new version:
1. **SQL first.** If the new version has a new file in `supabase/migrations/`, run **only that new file** in Supabase → SQL Editor.
2. In GitHub, click **Add file → Upload files**. Drag in everything inside the new folder (same exclusions as above), then click **Commit changes**.
3. Vercel redeploys automatically within about 2 minutes. Watch **Deployments** until it says **Ready**.

### Upgrading from Phase 5 to this final version
1. Run **`0006_settings.sql`** in the SQL Editor.
2. In **Vercel → Project → Settings → Environment Variables**, add **`SUPABASE_SERVICE_ROLE_KEY`** (the secret key from 1.5). Tick all environments and click **Save**.
3. Upload the new files to GitHub and click **Commit changes**. This also triggers the redeploy that picks up the new variable.

If you only change an environment variable, redeploy from **Vercel → Deployments → ⋯ → Redeploy**.

---

## 4. Environment variables

| Name | Required | Value | Used for |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Project URL, e.g. `https://abcd.supabase.co` | Connecting to the database |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | anon / publishable key | Login. Data still needs a logged-in team member. |
| `SUPABASE_SERVICE_ROLE_KEY` | Recommended | service_role / secret key | **Settings → Team users**: adding people and resetting passwords. Used only on the server, and only for admins. |

For running on your own computer, copy `.env.example` to `.env.local` and fill it in. `.env.local` is never uploaded.

---

## 5. Team users

### Adding a team member
**From the panel (admins):**
1. Go to **Settings → Team users → Add a team member**.
2. Enter their name and email. A strong password is suggested; tick **Make admin** if needed.
3. Click **Add team member**.
4. Share the email and password **privately**, e.g. a direct WhatsApp message. They can log in straight away.

**From Supabase** (if `SUPABASE_SERVICE_ROLE_KEY` isn't set):
1. Go to **Authentication → Users → Add user → Create new user**.
2. Enter their email and a password, and tick **Auto Confirm User**.
3. Set their name in **Settings → Team users**.

### Managing access
**Admins and members:**
- **Admins** can add people, change access, and reset passwords.
- **Everyone** can use every other part of the panel, including the other Settings tabs. Each person can change their own display name.

**Removing someone without losing their history:**
- In **Settings → Team users**, click **Switch off**. They're locked out immediately, and everything they did stays in the history.
- **Switch on** brings them back.

**Forgotten password:**
- In **Settings → Team users**, click the 🔑 key icon and choose **Set password**, then share the new password privately.

**Safety rules:**
- Nobody can remove their own admin access.
- There is always at least one active admin.

---

## 6. The daily routine

1. **Upload:** in **Upload History → Upload Naukri file**, drop today's export.
   - Review the preview: new, duplicates, possible duplicates, unassigned, errors.
   - Click **Import**.
2. **Filter:** in **ZBM** or **HOS**, open **Filters**, tick the stage, then **Apply filters**.
3. **Select:** tick the top checkbox, then **Select all … matching the filters**.
4. **Export:** click **Export for Bulk Sender** and choose Tags if needed, then **Download CSV**.
   - Upload the file to the bulk sender **without opening it in Excel**.
5. **Move:** back in the panel, click **Move these … exported candidates to stage…**, choose the next stage, and confirm.
   - For **1:1 Aligned**, pick the interviewer.
6. **Check:**
   - **Dashboard** for today's numbers.
   - **Analytics → Bottlenecks** for candidates stuck too long, or stages converting poorly.
   - "Open them" opens those candidates, ready to export or move.

---

## 7. Rules reference

### 7.1 Uploads and duplicates

1. Download the export from Naukri and drop it on the upload page. It's read **in your browser**, and nothing is saved until you click Import.
2. **Role** is detected from Job Title using the keyword rules in Settings, ignoring letter case. "ZBM" and "HOS" only count as whole words, so "Hospital" isn't HOS. If no keyword matches, or both roles match, the row goes to the **Unassigned** tab, where you choose ZBM, HOS or Skip.
3. **Duplicates** are checked within each role, after trimming spaces and ignoring letter case:
   - **Exact** (name + mobile + email all match): skipped. The existing candidate's stage and history stay as they are.
   - **Possible** (mobile *or* email matches, but something differs): you choose **Skip** (the default) or **Add as new** for each row.
   - The same person listed twice in one file is caught too.
4. **Cleaning rules:**
   - "NA" becomes empty.
   - Dates are converted from DD-MMM-YYYY.
   - The first valid 10-digit mobile is the main number. Anything else in the cell is stored as an alternate number.
   - The first email is the main email. Any other email in the cell is stored as an alternate (Naukri sometimes lists two).
   - Experience is converted to months.
   - Salary is converted to INR lakhs, whatever currency is written.
   - The hidden link behind "View profile" is saved.
   - Screening answers (Ans(...) columns) are saved per question.
   - The full original row is kept as well.
5. **Rows that can't be imported** (no name, or neither a valid mobile nor an email) appear in **Errors**. Imported rows with a problem, such as a phone number damaged by Excel, appear in **Warnings**.
6. New candidates always start in **Shortlisted**. An upload never changes or deletes an existing candidate.

If the internet drops during an import, the upload shows **"Stopped part-way"** in Upload History. Upload the same file again: the candidates already saved are skipped as exact duplicates, and only the missing ones are added.

### 7.2 Bulk-sender export

- **Columns, in this order:** `Name,Mobile Number,Source,Tags,booking_at`
- **Name:** trimmed, and quoted only if it contains a comma.
- **Mobile Number:** `91` plus the 10-digit mobile, digits only, e.g. `919962791460`.
- **Source:** always `ORGANIC`. **booking_at:** always empty.
- **Tags:** empty, or the candidate's stage, interviewer, or custom text, chosen in the dialog.
- **File format:** UTF-8 with BOM, LF line endings, one newline after the last row.
- **Skipped:** candidates without a valid mobile, and a second candidate with the same mobile. Both are listed after the download.
- **File name:** `ROLE_Stage_DD-MMM-YYYY.csv`. "1:1 Aligned" becomes `1-1-Aligned`, and exports covering several stages are called `Mixed`.
- **Every export is recorded** in the Activity Log: who, when, role, stage filter, count, and the exact candidates.
- **Don't open and save the CSV in Excel before uploading it**, because Excel turns the mobile numbers into `9.19963E+11`. To look at it, use Notepad.

`npm test` includes a byte-for-byte check against `samples/bulk_sender_sample.csv`: it rebuilds that file from its names and numbers and compares every byte.

### 7.3 Stage moves and interviewers

- Candidates can be moved to **any** stage, forwards or backwards. The confirmation always says how many are moving, from where and to where.
- Moving into a stage marked "asks for interviewer" (1:1 Aligned) **requires** choosing one interviewer. All candidates in that move get the same interviewer, and it can be changed later per candidate or in bulk.
- When candidates leave 1:1 Aligned, **they keep their interviewer tag**. It can be removed with **Interviewer… → No interviewer**.
- Every move records who did it, the time (IST), the candidate, the from → to stage, and a **bulk action ID**, so a bulk move shows as one entry in the Activity Log.
- Moving candidates who are already in the chosen stage changes nothing for them, and the confirmation says so.

### 7.4 How Analytics counts

All days are India time (IST).
- **Enters a stage:** a candidate enters Shortlisted when uploaded, and any other stage when moved into it.
- **Funnel:** how many candidates entered each stage between From and To, and how many of them have since reached any later stage (skipping a stage counts). For example, Shortlisted → JD Cleared = 38% means 38% of the candidates who entered Shortlisted in the period have moved further.
- **Compared with:** the same number of days just before your From date.
- **Time in stage:** days from entering a stage to leaving it, for stays that started in the period. The median is the typical stay, while a few very long stays pull the average up.
- **Stuck:** in the same stage for more than "max days in a stage" (default 3). The last stage (Webinar Invitation) doesn't count.
- **Bottleneck alerts:**
  - conversion below the minimum % (default 30%), only when at least 5 candidates entered the stage, since tiny numbers give silly percentages
  - a median stay over the day limit
  - any stuck group

  Both limits are set in **Settings → Bottleneck limits**.
- **Interviewer filter:** limits everything to candidates who currently have that interviewer.

### 7.5 Settings
- **Stages:**
  - Rename one, change its colour, reorder with the ↑ / ↓ arrows, add new ones at the end, and choose where new candidates start.
  - Mark which stage asks for an interviewer.
  - A stage can only be deleted when it holds no candidates and isn't the starting stage. Its history stays readable either way.
- **Interviewers:**
  - Add, rename, recolour, or switch on and off.
  - Removing someone who still has candidates switches them off instead, so tags and history are kept.
- **Role keywords:**
  - Add or remove keywords, and choose *Contains* or *Whole word* for each.
  - Use **Try a job title** to test a title before an upload.
- **Bottleneck limits:** max days in a stage (1–90) and minimum conversion (1–100%).
- **Every settings change** is recorded in the Activity Log.

---

## 8. Using it on a phone

The panel works on phones:
- a menu replaces the top navigation
- candidates appear as cards
- dialogs and filters fit the screen

**To add it to your home screen like an app:**
- **iPhone (Safari):** open the panel, tap **Share → Add to Home Screen**.
- **Android (Chrome):** tap **⋮ → Add to Home screen** (or **Install app**).

---

## 9. Supabase free tier: pausing

A free Supabase project **pauses after about 7 days without activity**. Daily use prevents this.

If it does pause, the login page says **"Can't reach the database"**. To fix it:
1. Log in at **supabase.com** and open the project.
2. Click **Restore project**.
3. Wait a few minutes, then reload the panel.

No data is lost. Free projects get no automatic backups, so consider Supabase Pro once the team relies on the panel daily.

---

## 10. How the data is protected

- **Login and access**
  - **Row Level Security** is on for every table. Without logging in as an active team member, nothing can be read, not even through the public key.
  - Public sign-up is off. Only admins (or the Supabase dashboard) can create accounts.
  - Switched-off users lose access immediately.
- **Data that can't be lost or faked**
  - Candidates, uploads and the Activity Log **can't be deleted** from the panel.
  - An upload never changes an existing candidate's stage.
  - "Who did it" is stamped by the database from the login session, so it can't be faked from the browser.
- **Keys and files**
  - The secret service key is used only on the server, and only after checking the person is an admin.
  - Naukri files are read **in your browser**. Only the cleaned rows are sent to the database.
  - The panel isn't indexed by search engines, and `samples/` (real candidate data) is excluded from git.

---

## 11. Troubleshooting

| Problem | Fix |
|---|---|
| "Can't reach the database" at login | The Supabase project is paused. See section 9. Otherwise, check your internet connection. |
| "Wrong email or password" | Check the address. An admin can set a new password in Settings → Team users. |
| "Your access is switched off" | An admin can click **Switch on** in Settings → Team users. |
| A page says a function "does not exist" | A SQL file wasn't run. Run the missing `supabase/migrations` file(s) in order. |
| Settings: "Adding users needs SUPABASE_SERVICE_ROLE_KEY" | Add that variable in Vercel (section 4), then redeploy. |
| The bulk sender rejects the CSV, or numbers look like `9.19963E+11` | The file was opened and saved in Excel. Export again and upload it untouched. |
| Upload says "doesn't look like a Naukri export" | Use the candidate export from Naukri. The file needs at least *Job Title*, *Name* and a phone or email column. |
| An upload shows "Stopped part-way" | Upload the same file again. Saved candidates are skipped as exact duplicates, and only the missing ones are added. |
| Vercel build failed | **Vercel → Deployments →** click the failed one and read the red error. Usually a file was missed in the GitHub upload, so upload the full folder again. |

---

## 12. For developers

**Run locally:**
1. Install Node.js LTS.
2. Copy `.env.example` to `.env.local` and fill it in.
3. Run `npm install`, then `npm run dev`.
4. Open http://localhost:3000.

**Tests:** `npm test` runs about 50 checks:
- the Naukri parser, including a test against `samples/naukri_sample.xlsx` when present
- the duplicate rules and the filters
- the history wording and the bottleneck rules
- a **byte-for-byte** comparison of the bulk-sender export with `samples/bulk_sender_sample.csv`

**Brand:** colours and names are in `src/lib/brand.ts` and `src/app/globals.css`. The logos are in `public/brand/`, and the app icons in `src/app/icon.png`, `apple-icon.png` and `favicon.ico`.

```
supabase/migrations/        SQL files 0001–0006: run in order (one new file per release)
src/app/login/              sign-in page
src/app/(app)/              logged-in pages: zbm, hos, dashboard, analytics, uploads, activity, settings
src/app/(app)/settings/     settings page + server-only team-user actions
src/components/             navigation, frosted backdrop, page header, ui/ building blocks
src/components/candidates/  ZBM/HOS table, filters, columns, export, move dialogs, candidate panel
src/components/upload/      upload page: drop zone, preview, decisions
src/components/analytics/   charts, funnel, time in stage, stuck list
src/components/activity/    Activity Log
src/components/settings/    Settings tabs
src/lib/naukri/             reading Naukri files, cleaning, role detection, duplicate checks, import
src/lib/export/             bulk-sender CSV builder
src/lib/candidates/         filter definitions, history wording
src/lib/analytics/          bottleneck rules
src/lib/supabase/           database connection (browser, server, middleware)
samples/                    your Naukri and bulk-sender samples (not committed)
```
