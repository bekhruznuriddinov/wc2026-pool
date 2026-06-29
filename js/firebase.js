// ============================================================
// FIREBASE CONFIG — replace these values with your own project
// Steps: console.firebase.google.com → new project → web app
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyCIEkDPC-itgwg4LYFSzIRABand9QJ1sNk",
  authDomain: "hcap-world-cup-predictions.firebaseapp.com",
  projectId: "hcap-world-cup-predictions",
  storageBucket: "hcap-world-cup-predictions.firebasestorage.app",
  messagingSenderId: "1049708770708",
  appId: "1:1049708770708:web:ef5db55178e957eec60b81"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Admin email — whoever should have access to admin.html
const ADMIN_EMAIL = "bek@hcap.com";

// Country flags — ISO 3166-1 alpha-2 codes for flag-icons library
const FLAGS = {
  "South Africa": "za",  "Canada": "ca",    "Germany": "de",
  "Paraguay": "py",       "Netherlands": "nl","Morocco": "ma",
  "Brazil": "br",         "Japan": "jp",     "France": "fr",
  "Sweden": "se",         "Ivory Coast": "ci","Norway": "no",
  "Mexico": "mx",         "Ecuador": "ec",   "England": "gb-eng",
  "DR Congo": "cd",       "USA": "us",
  "Bosnia & Herzegovina": "ba", "Belgium": "be", "Senegal": "sn",
  "Portugal": "pt",       "Croatia": "hr",   "Spain": "es",
  "Austria": "at",        "Switzerland": "ch","Algeria": "dz",
  "Argentina": "ar",      "Cape Verde": "cv","Colombia": "co",
  "Ghana": "gh",          "Australia": "au", "Egypt": "eg",
};
function flag(name) {
  const code = FLAGS[name];
  if (!code) return '<span style="font-size:1.2rem">🏳️</span>';
  return `<span class="fi fi-${code}" title="${name}"></span>`;
}

// Points per round
const ROUND_POINTS = {
  r32: 1,
  r16: 2,
  qf: 4,
  sf: 8,
  final: 16,
  third: 4
};

// Returns true when the given side was the minority pick and can earn the maverick +1 bonus.
// Requires at least 2 total picks; strictly fewer than half chose this side.
function isMaverick(matchId, side, pickCounts) {
  const c = pickCounts && pickCounts[matchId];
  if (!c) return false;
  const total = (c.team1 || 0) + (c.team2 || 0);
  if (total < 2) return false;
  return (c[side] || 0) < total / 2;
}

// Round display names and order
const ROUNDS = [
  { id: "r32",   name: "Round of 32",    order: 1 },
  { id: "r16",   name: "Round of 16",    order: 2 },
  { id: "qf",    name: "Quarter-finals", order: 3 },
  { id: "sf",    name: "Semi-finals",    order: 4 },
  { id: "third", name: "3rd Place",      order: 5 },
  { id: "final", name: "Final",          order: 6 },
];
