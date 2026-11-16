# Candidate Tracker

Internal recruitment panel for ZBM and HOS hiring. Daily Naukri uploads, stage tracking, bulk-sender exports and analytics.

**Built with:** Next.js · Supabase (database + login) · Vercel (hosting). All free tiers.

> **Status: Phase 3.** Login, layout, Naukri upload with duplicate checks, Upload History, and the ZBM / HOS candidate tables with filters and the bulk-sender export are done. Next: Phase 4, moving candidates between stages, interviewers, and the Activity Log page.

---

## Phase 1 setup (about 20 minutes, no coding needed)

### Step 1: Create the Supabase project

1. Go to **https://supabase.com** and sign up (or log in with GitHub or Google).
2. Click **New project**.
   - **Name:** `candidate-tracker`
   - **Database password:** click *Generate*, then save it in your password manager.
   - **Region:** **South Asia (Mumbai)**, which is fastest for India.
3. Click **Create new project** and wait 1–2 minutes until it's ready.

### Step 2: Create the database tables

1. In the left sidebar, open **SQL Editor** and click **New query**.
2. Open the file `supabase/migrations/0001_init.sql` from this project in Notepad or TextEdit. Select all, copy, and paste it into the editor.
3. Click **Run** (bottom right). You should see **"Success. No rows returned."**
4. To check: open **Table Editor** in the sidebar. You should see 9 tables, and `stages` should have 6 rows.

> Then do the same with **`0002_uploads.sql`** and **`0003_candidate_search.sql`**: New query → paste → Run, one file at a time. Always run the files in number order.
>
> Run each migration file **once only**. Running it twice gives "already exists" errors, which are harmless but not needed.

### Step 3: Make the panel invite-only

1. Go to **Authentication → Sign In / Providers** (on older dashboards: *Authentication → Providers*).
2. Turn **OFF** "Allow new users to sign up", then click **Save**.
   From now on, only people you add yourself can log in.

### Step 4: Add yourself (you become admin)

1. Go to **Authentication → Users → Add user → Create new user**.
2. Enter your email and a strong password, tick **Auto Confirm User**, and click **Create user**.
   **The first user ever added becomes the admin automatically.**
3. Set your display name. In **SQL Editor**, run (with your own email and name):
   ```sql
   update profiles set full_name = 'Lakshay' where email = 'you@example.com';
   ```

**Adding a team member** follows the same steps 1–3, with their email and name. Send them their password privately, and they appear in Settings → Team users. A simpler "add user" screen inside the app comes in Phase 6.

**Removing access without losing their history:**
```sql
update profiles set is_active = false where email = 'person@example.com';
```

### Step 5: Get your two API values

Go to **Project Settings → API** (or *API Keys*) and copy:
- **Project URL**, e.g. `https://abcdxyz.supabase.co`
- **anon / public key** (on newer dashboards this is the *Publishable key*, starting `sb_publishable_`)

> Never use the **service_role / secret** key here. It bypasses all security.

### Step 6: Make it live (GitHub + Vercel)

**A. Put the code on GitHub (private)**
1. On **github.com**, click **+ → New repository**. Name it `candidate-tracker`, choose **Private**, and click **Create repository**.
2. Click the **"uploading an existing file"** link. Drag in **everything inside** this folder (not the folder itself), then click **Commit changes**.
   **Never upload:** `node_modules`, `.next`, `.env.local` or the sample files in `samples/`.
   On a Mac, press **Cmd + Shift + .** in Finder to show hidden files like `.gitignore`.

**B. Deploy on Vercel**
1. On **vercel.com**, choose **Continue with GitHub**, then **Add New… → Project → Import** `candidate-tracker`.
2. Under **Environment Variables**, add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (from Step 5).
3. Click **Deploy**. After about 2 minutes you get your live link, e.g. `candidate-tracker-abc.vercel.app`.

**C. Point Supabase at the live link**
In Supabase, go to **Authentication → URL Configuration**. Set **Site URL** to your Vercel link and click **Save**.

> Vercel's free (Hobby) plan is for non-commercial use only. Business use needs Vercel Pro (US$20/month).

**Updating later:**
1. Run any new SQL file in Supabase **first**.
2. In GitHub, click **Add file → Upload files**, drag in the new code, and click **Commit changes**.
3. Vercel redeploys automatically.

If you change an environment variable, redeploy from **Vercel → Deployments → ⋯ → Redeploy**.

### Optional: run the app on your computer

1. Install **Node.js LTS** from **https://nodejs.org** (the big green button). Restart your computer afterwards.
2. Unzip this project into a folder, e.g. `Documents/candidate-tracker`.
3. In that folder, make a copy of `.env.example` and name the copy `.env.local`. Open it and paste in your two values:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://abcdxyz.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
   ```
4. Open a terminal in the folder:
   - **Windows:** open the folder in File Explorer, click the address bar, type `cmd`, press Enter.
   - **Mac:** right-click the folder → *New Terminal at Folder*.
5. Run these two commands (the first takes a few minutes, but only the first time):
   ```
   npm install
   npm run dev
   ```
6. Open **http://localhost:3000** in your browser and log in.

To stop the app, press `Ctrl + C` in the terminal. To start it again, run `npm run dev`.

### What to test in Phase 1

- [ ] Going to http://localhost:3000 sends you to the login page.
- [ ] A wrong password shows a red "Wrong email or password." message.
- [ ] After logging in, all 7 tabs appear: ZBM | HOS | Dashboard | Analytics | Upload History | Activity Log | Settings.
- [ ] ZBM and HOS show the 6 coloured stage badges, each with a count of 0.
- [ ] **Settings** shows the stages, the interviewers (Pratyush, Parul, Umer), the role keywords, the thresholds (3 days, 30%) and you marked as **Admin**.
- [ ] Your name menu (top right) has **Log out**, which works.
- [ ] Opening http://localhost:3000/settings in a private/incognito window sends you to login.

---

## Phase 2: updating and testing

**Updating a live site that already has Phase 1:**
1. In Supabase, open **SQL Editor → New query**, paste all of `supabase/migrations/0002_uploads.sql`, and click **Run**. You should see "Success".
2. In GitHub, click **Add file → Upload files**. Drag in everything inside the new folder (not `node_modules`, `.next`, `.env.local` or the sample files), then click **Commit changes**.
3. Wait about 2 minutes for Vercel to redeploy, then reload the site.

**What to test**
- [ ] **Upload History → Upload Naukri file**, or the button on the ZBM / HOS tabs, opens the upload page.
- [ ] Drop `naukri_sample.xlsx`. The preview should show **62 total rows, 62 ZBM, 62 new**, 0 errors and 0 warnings.
- [ ] Click **Import 62 candidates**. A green message appears, and ZBM shows **Shortlisted: 62**.
- [ ] **Upload History** has one row. Click it to see the 62 candidates. **View** opens a Naukri profile.
- [ ] Upload the **same file again**. The preview shows **62 duplicates skipped, 0 new**, and the Import button is greyed out.
- [ ] Upload any other .xlsx or .csv (not from Naukri). It's rejected with "doesn't look like a Naukri candidate export" and nothing is saved.

## Phase 3: updating and testing

**Updating a live site that already has Phase 2:**
1. In Supabase, open **SQL Editor → New query**, paste all of `supabase/migrations/0003_candidate_search.sql`, and click **Run**. You should see "Success". This file only adds search functions and changes no data.
2. In GitHub, click **Add file → Upload files**. Drag in everything inside the new folder (same exclusions as always), then click **Commit changes**.
3. Wait about 2 minutes for Vercel to redeploy, then reload.

**What to test**
- [ ] **ZBM** shows the table with "Showing 62 of 62 candidates".
- [ ] Click a column header to sort, and click it again to reverse the order.
- [ ] Type in the search box, e.g. part of a name, a phone number or a company.
- [ ] **Filters**: tick a stage and set an experience range, then **Apply filters**. The chips appear, and **×** removes one.
- [ ] **Columns**: hide and show columns. Your choice is remembered in this browser.
- [ ] Tick the top checkbox, then **Select all 62 matching the filters**.
- [ ] **Export for Bulk Sender** → **Download CSV**. Open the file in **Notepad** (not Excel). The first line should be `Name,Mobile Number,Source,Tags,booking_at`, and each row should look like `Name,91XXXXXXXXXX,ORGANIC,,`.
- [ ] Upload that file to the bulk sender. It should be accepted.
- [ ] After closing the dialog, the selection is still there.
- [ ] Reload the page. Filters, sort and search stay as they were, because they're saved in the page address.

## Bulk-sender export: the rules

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

## Daily upload: how it works

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

## Automated tests (for developers)

`npm test` runs 40 checks: the parser, the duplicate rules, the filters and the bulk-sender export. When `samples/naukri_sample.xlsx` is present, they include your real Naukri file.

## How the data is protected

- **Row Level Security** is on for every table. Without logging in, nothing can be read, not even through the public key.
- Users switched off with `is_active = false` lose access immediately.
- Candidates, uploads and the activity log **cannot be deleted** by anyone using the app.
- "Who did it" is set by the database from the login session, so it can't be faked from the browser.
- Every stage change and interviewer change is logged automatically, with stage names copied in, so the history stays readable even if a stage is renamed later.
- New candidates always start in the default stage (Shortlisted), whatever the app sends.
- `samples/` is excluded from git because it contains real candidate data.

## Supabase free tier: pausing

A free Supabase project **pauses after about 7 days without activity**. Daily use prevents this. If it does pause, the app shows connection errors. To fix it:
1. Log in at supabase.com and open the project.
2. Click **Restore project** and wait a few minutes.

No data is lost.

## Project layout

```
supabase/migrations/   SQL files: run in order in the SQL Editor (one new file per phase)
src/lib/naukri/        Naukri file reading, cleaning rules, role detection, duplicate checks, import
src/components/upload/ upload page: drop zone, preview, decisions
src/components/candidates/ ZBM/HOS table, filter panel, columns, export dialog
src/lib/export/        bulk-sender CSV builder (+ byte-for-byte test)
src/lib/candidates/    filter definitions shared by the table and the database
src/app/login/         login page
src/app/(app)/         every logged-in page (zbm, hos, dashboard, analytics, uploads, activity, settings)
src/components/        navigation, page header, ui/ (shadcn-style building blocks)
src/lib/supabase/      database connection (browser, server, middleware)
src/lib/dates.ts       IST date formatting (DD-MMM-YYYY)
samples/               your Naukri and bulk-sender sample files (not committed)
```
