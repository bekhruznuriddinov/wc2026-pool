// Syncs WC 2026 match data from football-data.org to Firestore:
//   - Kickoff times for all upcoming/live matches (keeps cards accurate)
//   - Results + scores for finished matches
// Run via GitHub Actions on a schedule — see ../.github/workflows/update-results.yml

const https = require("https");
const admin = require("firebase-admin");

// Map football-data.org team names → names used in our Firestore matches
const TEAM_MAP = {
  "Côte d'Ivoire": "Ivory Coast",
  "United States": "USA",
  "Democratic Republic of Congo": "DR Congo",
  "Congo DR": "DR Congo",
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

// Knockout stage match statuses we care about
const FINISHED_STATUSES = new Set(["FINISHED"]);
const UPCOMING_STATUSES = new Set(["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED"]);

async function main() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  console.log("Fetching all WC 2026 matches from football-data.org...");
  const data = await fetchJSON(
    "https://api.football-data.org/v4/competitions/WC/matches?season=2026",
    { "X-Auth-Token": process.env.FOOTBALL_DATA_API_KEY }
  );

  const apiMatches = data.matches || [];
  console.log(`API returned ${apiMatches.length} total match(es)`);

  // Load all Firestore matches
  const snap = await db.collection("matches").get();
  const firestoreMatches = snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));

  const batch = db.batch();
  let kickoffsUpdated = 0;
  let resultsUpdated = 0;
  let skipped = 0;

  for (const m of apiMatches) {
    const apiHome = normalize(m.homeTeam?.name || "");
    const apiAway = normalize(m.awayTeam?.name || "");

    // Skip if team names aren't real yet (TBD brackets)
    if (!apiHome || !apiAway || apiHome === "TBD" || apiAway === "TBD") continue;

    // Find matching Firestore doc by team names
    const fsMatch = firestoreMatches.find(
      (fm) =>
        (fm.team1 === apiHome && fm.team2 === apiAway) ||
        (fm.team1 === apiAway && fm.team2 === apiHome)
    );

    if (!fsMatch) continue; // group stage or unknown — skip silently

    const status = m.status;
    const updates = {};

    // Always sync kickoff time if we have one from the API
    if (m.utcDate) {
      const apiKickoff = new Date(m.utcDate);
      const fsKickoff = fsMatch.kickoff
        ? (fsMatch.kickoff.toDate ? fsMatch.kickoff.toDate() : new Date(fsMatch.kickoff))
        : null;

      const needsUpdate = !fsKickoff || Math.abs(apiKickoff - fsKickoff) > 60000; // >1 min diff
      if (needsUpdate) {
        updates.kickoff = apiKickoff;
        kickoffsUpdated++;
        console.log(`  [kickoff] ${fsMatch.team1} vs ${fsMatch.team2} → ${apiKickoff.toISOString()}`);
      }
    }

    // Sync result for finished matches
    if (FINISHED_STATUSES.has(status) && !fsMatch.result) {
      const score = m.score?.fullTime;
      const winner = m.score?.winner;

      if (score && winner && winner !== "DRAW") {
        const homeIsTeam1 = fsMatch.team1 === apiHome;
        const result =
          winner === "HOME_TEAM"
            ? homeIsTeam1 ? "team1" : "team2"
            : homeIsTeam1 ? "team2" : "team1";

        const score1 = homeIsTeam1 ? score.home : score.away;
        const score2 = homeIsTeam1 ? score.away : score.home;

        updates.result = result;
        updates.score1 = score1;
        updates.score2 = score2;
        updates.updatedByBot = true;

        const winnerName = result === "team1" ? fsMatch.team1 : fsMatch.team2;
        console.log(
          `  [result]  ${fsMatch.team1} ${score1}–${score2} ${fsMatch.team2}  →  ${winnerName} wins`
        );
        resultsUpdated++;
      }
    } else if (FINISHED_STATUSES.has(status) && fsMatch.result) {
      skipped++;
    }

    if (Object.keys(updates).length > 0) {
      batch.update(fsMatch.ref, updates);
    }
  }

  const totalChanges = kickoffsUpdated + resultsUpdated;
  if (totalChanges > 0) {
    await batch.commit();
    console.log(`\nDone — ${kickoffsUpdated} kickoff(s) synced, ${resultsUpdated} result(s) written. ${skipped} already had results.`);
  } else {
    console.log(`\nNo changes needed. ${skipped} match(es) already recorded.`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
