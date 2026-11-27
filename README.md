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

### 1.2 Create the database (13 SQL files, in order)
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
| 7 | `0007_access_levels_and_delete.sql` | Access levels (Admin / Team member / Interviewer) and admin delete |
| 8 | `0008_shortlist_tags_and_test_results.sql` | Shortlist tags (72h / 48h / 24h / Hold) and the test-results upload |
| 9 | `0009_rescheduled_tag.sql` | "Rescheduled" tag for 1:1 interviews |
| 10 | `0010_add_from_test_file.sql` | Add people from the test file who aren't in the tracker |
| 11 | `0011_interviewer_list_upload.sql` | Interviewer-list upload and 1:1 dates |
| 12 | `0012_interviewer_list_name_match.sql` | Interviewer list: match by name, mobile or email |
| 13 | `0013_all_tab.sql` | The **All** tab (ZBM + HOS together) |

> Supabase may warn about **"destructive operations"** on files 2, 4, 6, 7, 8, 9, 10, 11, 12 and 13. That's expected: they replace a helper column or function with a newer version. **Run query** is safe, and no candidate data is removed.
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

### Adding the All tab (if you already run 0012)
1. Run **`0013_all_tab.sql`** in the SQL Editor. It only updates the list functions; no data changes.
2. Merge the change on GitHub (or upload the files). The **All** tab appears first in the menu.

The All tab works exactly like ZBM and HOS (search, filters, Shortlisted tags, Rescheduled, export, bulk moves, delete), with a **Role** column. Exports from it are named `All_…csv`. Interviewer logins see only their own candidates there too.

### Name matching for the interviewer list (if you already run 0011)
1. Run **`0012_interviewer_list_name_match.sql`** in the SQL Editor. It only adds a lookup; nothing changes.
2. Upload the new files to GitHub and click **Commit changes**.

### Adding the interviewer-list upload (if you already run 0010)
1. Run **`0011_interviewer_list_upload.sql`** in the SQL Editor (click **Run query** if the warning appears). No candidates change.
2. Upload the new files to GitHub and click **Commit changes**.

### Adding people from the test file (if you already run 0009)
1. Run **`0010_add_from_test_file.sql`** in the SQL Editor (click **Run query** if the warning appears). No candidates change.
2. Upload the new files to GitHub and click **Commit changes**.

### Adding the Rescheduled tag and the logout fix (if you already run 0008)
1. Run **`0009_rescheduled_tag.sql`** in the SQL Editor (click **Run query** if the warning appears). No candidates change.
2. Upload the new files to GitHub and click **Commit changes**. Vercel redeploys in about 2 minutes.

### Adding shortlist tags and test-results upload (if you already run 0007)
1. Run **`0008_shortlist_tags_and_test_results.sql`** in the SQL Editor. Supabase may show the "destructive operations" warning: click **Run query**. It's safe, and no candidates change. Everyone in Shortlisted starts with **No tag**.
2. Upload the new files to GitHub and click **Commit changes**. Vercel redeploys in about 2 minutes.
3. Check **Settings → Shortlist tags** (72h, 48h, 24h, Hold) and the **Test-results upload** stage below it.

### Adding access levels and delete (if you already run the final version)
1. Run **`0007_access_levels_and_delete.sql`** in the SQL Editor. Everyone keeps full access until an admin changes it.
2. Upload the new files to GitHub and click **Commit changes**.

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

### Access levels
An admin sets each person's access in **Settings → Team users → Access**:

| Access | Sees | Can |
|---|---|---|
| **Admin** | Everything | Everything a team member can, plus add people, change access, reset passwords, and **delete candidates** |
| **Team member** | All candidates | Upload, filter, export, move stages, assign interviewers, edit Settings (except Team users) |
| **Interviewer** | **Only candidates tagged with their interviewer name** (e.g. Parul) in ZBM / HOS, Dashboard, Analytics and Activity Log | Filter, export and move the stage of their own candidates. They can't upload, open Settings or Upload History, reassign interviewers, or delete |

**Setting someone up as an interviewer:**
1. Make sure their name exists in **Settings → Interviewers**.
2. Choose **Interviewer: own candidates only**. The matching interviewer is picked automatically ("Parul Sharma" → Parul); change it if needed.

**Rules for interviewer access:**
- **Who interviews whom** is decided by admins and team members when they move candidates to 1:1 Aligned, or with **Interviewer…**.
- **A candidate reassigned to someone else** disappears from the first interviewer's view.
- **These limits are enforced by the database itself**, so an interviewer can't get around them.

**Making someone an admin:**
- Choose **Admin** in their Access dropdown.
- Nobody can remove their own admin access, and there is always at least one active admin.

Each person can change their own display name.

**Removing someone without losing their history:**
- In **Settings → Team users**, click **Switch off**. They're locked out immediately, and everything they did stays in the history.
- **Switch on** brings them back.

**Forgotten password:**
- In **Settings → Team users**, click the 🔑 key icon and choose **Set password**, then share the new password privately.

### Deleting candidates (admins only)
1. **Select the candidates.** In ZBM / HOS, select them, or open one candidate's panel.
2. **Click Delete….** You'll see the list of people being deleted.
3. **If the candidate asked for their data to be removed**, tick **Also remove their names from the Activity Log**.
4. **Type the number** of candidates, then click **Delete permanently**.

**What happens:**
- Their details are removed for everyone, **permanently**. The free Supabase plan has no backups, so export them first if you might need them.
- The Activity Log records who deleted how many (and their names, unless you ticked the box).
- Their earlier history lines stay, unlinked.

---

## 6. The daily routine

Same steps for **ZBM** and **HOS**. Only Admins and Team members can do this, not Interviewer logins.

1. **Test results first:** in **Upload History → Upload test results**, drop the assessment CSV or Excel.
   - The preview shows who will move to *JD and Assessment Test Cleared*, who already moved, and who isn't in the tracker.
   - Click **Move N**. These people stop getting reminders.
2. **24h → Hold:** in **ZBM**, click the **24h** chip, then **Select all N**, then **Export for Bulk Sender → Download CSV**.
   - Send the final message from the bulk sender.
   - Back in the panel, click **Move these N from 24h to Hold**.
3. **48h → 24h:** the same with the **48h** chip.
4. **72h → 48h:** the same with the **72h** chip.
5. **Naukri upload:** in **Upload History → Upload Naukri file**, drop today's export and click **Import**. New candidates arrive in Shortlisted with **No tag**.
6. **No tag → 72h:** the same with the **No tag** chip.
7. Repeat for **HOS**, then check the **Dashboard**.

The chips show live counts, and clicking one clears any earlier selection, so groups never mix. Upload the CSV to the bulk sender **without opening it in Excel**.

For other stages: open **Filters**, tick the stage, **Select all**, **Export**, then **Move these … exported candidates to stage…** (for 1:1 Aligned, pick the interviewer).

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

### 7.4 Shortlist tags and test results

- **Tags exist only in Shortlisted.** New candidates start with *No tag*. When a candidate moves to any other stage the tag is removed, and the history notes which tag they had.
- **Tags change only by hand** (the chips, **Tag…** in the selection bar, or **Move these N from X to Y** after an export). There's no timer.
- **The CSV never changes.** Tags are not written into the bulk-sender file, so AI Sensei gets exactly the same columns. Only the file name says the group, e.g. `ZBM_Shortlisted-48h_19-Nov-2026.csv`.
- **Test-results upload:**
  - Accepts CSV or Excel with a *Mobile* column (Name, Percentage and Assessment status are shown when present).
  - Matches by mobile number. Someone in both ZBM and HOS moves in both.
  - Moves everyone in Shortlisted (any tag) to the stage chosen in **Settings → Shortlist tags → Test-results upload**.
  - Leaves alone anyone already in that stage or further, so uploading the same cumulative file again is safe.
  - **People not in the tracker** (by mobile) are **added** to the role in the file name (HTLB-**ZBM**-… or HTLB-**HOS**-…; choose it if the name doesn't say), straight into the test-cleared stage. They get the name, mobile, city, CTC and designation from the file, and show a **From test file** badge. Untick *Add people who aren't in the tracker* to only move people.
  - **Same name in tracker:** if someone with the same name is already in that role (usually the same person who used another number on Naukri), they are **not added** unless you tick *Add these anyway*. Check them and move the existing person by hand.
  - **Later Naukri upload:** when a Naukri row has the same role and mobile as a "from test file" person, it **fills in their details** (email, experience, company, etc.) instead of adding them again. Their stage, tags and history stay. The preview shows them under *From test file*.
  - **Pass mark (optional):** empty means everyone in the file moves. Type e.g. 60 to move only those who scored at least 60%.
  - Each upload is saved in Upload History (type *Test results*) and the Activity Log.
- **Analytics → Which reminder works:** of the candidates who left Shortlisted in the period, how many had each tag at that moment.

### 7.5 Interviewer-list upload

**Upload History → Upload interviewer list.** Drop a booking / calendar export (CSV or Excel) of everyone aligned with one interviewer.

- **Columns** are found by name: name, mobile/phone and email (**any one is enough**), and a booking time (*Start Time*, *booking_at*, *Session Date* + *Session Time*, …). Dates are read day-first (27/11/2026), in India time.
- **Matching order:** **name** first (capitals and extra spaces ignored), then **mobile**, then **email**.
  - Two people with the same name in a role → the mobile / email in the file picks the right one; if it can't, they're listed under *More than one match* and nothing changes.
  - Only first + last name match (e.g. "Prashant Kale" vs "Prashant Suresh Kale") → listed under *Similar name*, used only if you tick it.
- **Choose the interviewer** (Parul, Umer, …). If the file name contains their name (e.g. `Parul_bookings.csv`), they're picked for you.
- **Matched by mobile**, in both ZBM and HOS:
  - Earlier stages → moved to **1:1 Aligned** with that interviewer. The *Found by* column says how each was matched.
  - Already in 1:1 Aligned with **another interviewer** → listed; moved only if you tick *Move these to …*.
  - Already **past** 1:1 Aligned → not moved back.
- **Not in the tracker** → added only when the file has their **name and mobile** (role from the file name, or choose it), straight into 1:1 Aligned with that interviewer, with a *From interviewer list* badge. A later Naukri upload fills in their details. Same-name matches are held back unless ticked, like the test upload.
- **1:1 date:** the booking time is saved and shown in the **1:1 date** column, on phone cards and in the candidate panel.
- **New booking time:** if someone already in 1:1 Aligned comes again with a different time, the new time is saved, and they're marked **Rescheduled** (untick to skip).
- Everything is saved in Upload History (type *Interviewer list*) and the Activity Log. Only admins and team members can upload.

### 7.5b Rescheduled 1:1s

- **Everyone can use it:** admins, team members and interviewer logins. Interviewers can only mark their own candidates.
- **Only in 1:1 Aligned** (any stage that asks for an interviewer). Selected candidates in other stages are skipped, and the message says how many.
- **How:** in ZBM or HOS, click **Rescheduled** / **Not rescheduled** above the table, or tick candidates and use **Rescheduled… → Mark as Rescheduled** (or **Remove Rescheduled**). One candidate: open them and click **Mark Rescheduled**.
- **Clears by itself** when the candidate moves to another stage. Their history keeps "Was rescheduled".
- Shown on the **Dashboard** (per interviewer and in total), in the **Filters** panel, and in the **Activity Log** (filter "Rescheduled 1:1s").

### 7.6 How Analytics counts

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

### 7.7 Settings
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
- **Shortlist tags:** rename, recolour, reorder (the order is the reminder cycle), add, or delete a tag nobody has. Below it, choose the stage the test-results upload moves people to.
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
| An interviewer sees no candidates | No candidates are tagged with their interviewer yet, or their login is linked to the wrong interviewer. Check **Settings → Team users → Access**. |
| No **Delete…** button | Only admins can delete. |
| A page says a function "does not exist" | A SQL file wasn't run. Run the missing `supabase/migrations` file(s) in order. |
| Settings: "Adding users needs SUPABASE_SERVICE_ROLE_KEY" | Add that variable in Vercel (section 4), then redeploy. |
| The bulk sender rejects the CSV, or numbers look like `9.19963E+11` | The file was opened and saved in Excel. Export again and upload it untouched. |
| Upload says "doesn't look like a Naukri export" | Use the candidate export from Naukri. The file needs at least *Job Title*, *Name* and a phone or email column. |
| An upload shows "Stopped part-way" | Upload the same file again. Saved candidates are skipped as exact duplicates, and only the missing ones are added. |
| No **Upload test results** button, or no tag chips | Run `0008_shortlist_tags_and_test_results.sql`. Interviewer logins never see them. |
| Test upload adds many people the first time | Normal: the file holds every result since October. Re-uploading it later adds nobody twice (matched by mobile). |
| Dashboard "New today" jumped after a test upload | People added from the test file count as new that day. |
| Test upload: "No Mobile column" | The file needs a column called Mobile (or Phone / Mobile Number). |
| Log out does nothing | Fixed in this version. Update the site, then press Ctrl+F5 (or close and reopen the tab) once. |
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
supabase/migrations/        SQL files 0001–0013: run in order (one new file per release)
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
