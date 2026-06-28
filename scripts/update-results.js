// Fetches finished WC 2026 match results from football-data.org
// and writes them directly to Firestore.
// Run via GitHub Actions on a schedule — see ../.github/workflows/update-results.yml

const https = require("https");
const admin = require("firebase-admin");

// Map football-data.org team names → names used in our Firestore matches
const TEAM_MAP = {
  "Côte d'Ivoire": "Ivory Coast",
  "United States": "USA",
  "Democratic Republic of Congo": "Congo DR",
  "DR Congo": "Congo DR",
  "Bosnia and Herzegovina": "Bosnia & Herzegovina",
  "Bosnia-Herzegovina": "Bosnia & Herzegovina",
  "Cape Verde Islands": "Cape Verde",
};

function normalize(name) {
  return TEAM_MAP[name] || name;
}

function fetchJSON(url, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    https
      .get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}\nResponse: ${body.slice(0, 300)}`));
          }
        });
      })
      .on("error", reject);
  });
}

async function main() {
  // Init Firebase Admin from service account secret
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  console.log("Fetching finished WC 2026 matches from football-data.org...");
  const data = await fetchJSON(
    "https://api.football-data.org/v4/competitions/WC/matches?season=2026&status=FINISHED",
    { "X-Auth-Token": process.env.FOOTBALL_DATA_API_KEY }
  );

  const apiMatches = data.matches || [];
  console.log(`API returned ${apiMatches.length} finished match(es)`);

  if (apiMatches.length === 0) {
    console.log("Nothing to update.");
    return;
  }

  // Load all matches from Firestore
  const snap = await db.collection("matches").get();
  const firestoreMatches = snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));

  const batch = db.batch();
  let updated = 0;
  let skipped = 0;

  for (const m of apiMatches) {
    const score = m.score?.fullTime;
    const winner = m.score?.winner; // HOME_TEAM | AWAY_TEAM | DRAW

    // Skip group stage draws — our pool only covers knockout rounds (no draws)
    if (!score || !winner || winner === "DRAW") continue;

    const apiHome = normalize(m.homeTeam.name);
    const apiAway = normalize(m.awayTeam.name);

    // Find the corresponding Firestore match by team names
    const fsMatch = firestoreMatches.find(
      (fm) =>
        (fm.team1 === apiHome && fm.team2 === apiAway) ||
        (fm.team1 === apiAway && fm.team2 === apiHome)
    );

    if (!fsMatch) {
      console.log(`  [skip] No Firestore match found for: ${apiHome} vs ${apiAway}`);
      continue;
    }

    if (fsMatch.result) {
      skipped++;
      continue; // already recorded
    }

    // Map winner to team1/team2
    const homeIsTeam1 = fsMatch.team1 === apiHome;
    const result =
      winner === "HOME_TEAM"
        ? homeIsTeam1 ? "team1" : "team2"
        : homeIsTeam1 ? "team2" : "team1";

    // Score from team1's perspective
    const score1 = homeIsTeam1 ? score.home : score.away;
    const score2 = homeIsTeam1 ? score.away : score.home;

    batch.update(fsMatch.ref, {
      result,
      score1,
      score2,
      updatedByBot: true,
    });

    const winnerName = result === "team1" ? fsMatch.team1 : fsMatch.team2;
    console.log(
      `  [update] ${fsMatch.team1} ${score1}–${score2} ${fsMatch.team2}  →  ${winnerName} wins`
    );
    updated++;
  }

  if (updated > 0) {
    await batch.commit();
    console.log(`\nDone — updated ${updated} match(es). ${skipped} already had results.`);
  } else {
    console.log(`\nNo new results to write. ${skipped} match(es) already recorded.`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
