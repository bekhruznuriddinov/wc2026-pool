# World Cup 2026 — Office Predictions Pool

A round-by-round predictions game hosted on GitHub Pages with Firebase as the backend. Coworkers pick match winners each round, earn points for correct predictions, and compete on a live leaderboard.

## Scoring

| Round | Points per correct pick |
|---|---|
| Round of 32 | 1 pt |
| Round of 16 | 2 pts |
| Quarter-finals | 4 pts |
| Semi-finals | 8 pts |
| 3rd Place | 4 pts |
| Final | 16 pts |

---

## Setup (one-time, ~15 minutes)

### 1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a new project (no need to enable Google Analytics).
2. In the left sidebar, click **Firestore Database** → **Create database** → start in **production mode** → choose a region close to you.
3. Click **Project settings** (gear icon) → **Your apps** → click the **`</>`** (Web) button → register an app (name it anything) → copy the config object.

### 2. Add Firestore security rules

In the Firebase console → **Firestore** → **Rules**, paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Anyone can read users, matches, rounds, leaderboard
    match /users/{userId} {
      allow read: if true;
      allow write: if true;  // tighten this in production
    }
    match /rounds/{roundId} {
      allow read: if true;
      allow write: if false;  // admin only via Firebase console
    }
    match /matches/{matchId} {
      allow read: if true;
      allow write: if false;
    }
    match /predictions/{userId} {
      allow read: if true;
      allow write: if true;
    }
    match /settings/{doc} {
      allow read: if true;
      allow write: if false;
    }
  }
}
```

> For the admin panel to work from the browser, temporarily set `allow write: if true` on rounds/matches/settings, or use the Firebase console directly to enter data.

### 3. Configure the app

Open **`js/firebase.js`** and replace the placeholder values:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",           // ← from Firebase console
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const ADMIN_EMAIL = "your@email.com"; // ← your work email for admin access
```

### 4. Deploy to GitHub Pages

```bash
# Create a new GitHub repo (e.g. "wc2026-pool"), then:
git init
git add .
git commit -m "Initial World Cup 2026 pool"
git remote add origin https://github.com/YOUR_USERNAME/wc2026-pool.git
git push -u origin main
```

Then in GitHub: **Settings → Pages → Source: main branch → / (root)** → Save.

Your site will be live at `https://YOUR_USERNAME.github.io/wc2026-pool/`

---

## Running the pool

### Before each round

1. Visit `admin.html` while logged in with your admin email.
2. **Create the round** (e.g. "Round of 32", ID: `r32`, order: 1, set a deadline).
3. **Bulk-add matches** — create 16 empty slots for R32 (or the right count per round).
4. **Fill in team names** — once the group stage ends and matchups are known, type in the teams.
5. **Open the round** — click "Open" on the round. Coworkers can now submit picks.
6. **Close picks** before the first match kicks off.

### After each round

1. Enter match results in the matches table (select winner from dropdown).
2. Mark the round as **Complete**.
3. Click **Recalculate all scores** — leaderboard updates instantly.

---

## Pages

| Page | URL | Who |
|---|---|---|
| Login | `/index.html` | Everyone |
| My Picks | `/predictions.html` | Logged-in players |
| Leaderboard | `/leaderboard.html` | Public |
| Admin | `/admin.html` | Admin email only |

---

## Notes

- **No passwords** — users log in with name + email. Anyone with a coworker's email could submit picks as them. For an office pool this is fine; add Firebase Auth (email link or Google) if you need stronger security.
- **Buy-ins** — the buy-in amount is stored in settings (admin panel) as a reference only. Payment collection is handled separately.
- **Ties** — players with equal points share a rank; next rank is skipped.
