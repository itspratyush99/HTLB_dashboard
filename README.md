# Candidate Tracker

Internal recruitment panel for ZBM and HOS hiring. Daily Naukri uploads, stage tracking, bulk-sender exports and analytics.

**Built with:** Next.js · Supabase (database + login) · Vercel (hosting). All free tiers.

> **Status: Phase 1** (database, login, layout and navigation). This README grows with each phase. The full version, including Vercel deployment, comes in Phase 6.

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
src/app/login/         login page
src/app/(app)/         every logged-in page (zbm, hos, dashboard, analytics, uploads, activity, settings)
src/components/        navigation, page header, ui/ (shadcn-style building blocks)
src/lib/supabase/      database connection (browser, server, middleware)
src/lib/dates.ts       IST date formatting (DD-MMM-YYYY)
samples/               your Naukri and bulk-sender sample files (not committed)
```
