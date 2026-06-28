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

// Country flags
const FLAGS = {
  "South Africa": "🇿🇦", "Canada": "🇨🇦", "Germany": "🇩🇪",
  "Paraguay": "🇵🇾", "Netherlands": "🇳🇱", "Morocco": "🇲🇦",
  "Brazil": "🇧🇷", "Japan": "🇯🇵", "France": "🇫🇷",
  "Sweden": "🇸🇪", "Ivory Coast": "🇨🇮", "Norway": "🇳🇴",
  "Mexico": "🇲🇽", "Ecuador": "🇪🇨", "England": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  "DR Congo": "🇨🇩", "Congo DR": "🇨🇩", "USA": "🇺🇸",
  "Bosnia & Herzegovina": "🇧🇦", "Belgium": "🇧🇪", "Senegal": "🇸🇳",
  "Portugal": "🇵🇹", "Croatia": "🇭🇷", "Spain": "🇪🇸",
  "Austria": "🇦🇹", "Switzerland": "🇨🇭", "Algeria": "🇩🇿",
  "Argentina": "🇦🇷", "Cape Verde": "🇨🇻", "Colombia": "🇨🇴",
  "Ghana": "🇬🇭", "Australia": "🇦🇺", "Egypt": "🇪🇬",
};
function flag(name) { return FLAGS[name] || "🏳️"; }

// Points per round
const ROUND_POINTS = {
  r32: 1,
  r16: 2,
  qf: 4,
  sf: 8,
  final: 16,
  third: 4
};

// Round display names and order
const ROUNDS = [
  { id: "r32",   name: "Round of 32",    order: 1 },
  { id: "r16",   name: "Round of 16",    order: 2 },
  { id: "qf",    name: "Quarter-finals", order: 3 },
  { id: "sf",    name: "Semi-finals",    order: 4 },
  { id: "third", name: "3rd Place",      order: 5 },
  { id: "final", name: "Final",          order: 6 },
];
