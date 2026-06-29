// Syncs WC 2026 match data from football-data.org to Firestore:
//   - Kickoff times and results for all known matches (by team name)
//   - Bracket auto-fill: creates/updates R16/QF/SF/Final match docs as
//     teams become known after each round
//   - Auto-creates round documents if missing
//   - Auto-opens rounds 72h before first match; auto-completes when all results in

const https = require("https");
const admin = require("firebase-admin");

const TEAM_MAP = {
  "Côte d'Ivoire": "Ivory Coast",
  "United States": "USA",
  "Democratic Republic of Congo": "DR Congo",
  "Congo DR": "DR Congo",
  "Bosnia and Herzegovina": "Bosnia & Herzegovina",
  "Bosnia-Herzegovina": "Bosnia & Herzegovina",
  "Cape Verde Islands": "Cape Verde",
};
function normalize(name) { return TEAM_MAP[name] || name; }

// Maps football-data.org stage names → our Firestore round IDs
const STAGE_TO_ROUND = {
  "LAST_32":        "r32",
  "LAST_16":        "r16",
  "QUARTER_FINALS": "qf",
  "SEMI_FINALS":    "sf",
  "FINAL":          "final",
  "THIRD_PLACE":    "third",
};

// Metadata for auto-creating round documents
const ROUND_META = {
  r32:   { name: "Round of 32",    order: 1 },
  r16:   { name: "Round of 16",    order: 2 },
  qf:    { name: "Quarter-finals", order: 3 },
  sf:    { name: "Semi-finals",    order: 4 },
  third: { name: "3rd Place",      order: 5 },
  final: { name: "Final",          order: 6 },
};

const FINISHED_STATUSES = new Set(["FINISHED"]);

function fetchJSON(url, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    https
      .get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error(`JSON parse error: ${e.message}\nResponse: ${body.slice(0, 300)}`)); }
        });
      })
      .on("error", reject);
  });
}

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
  console.log(`API returned ${apiMatches.length} match(es)`);

  // Load all current Firestore matches and rounds
  const [matchesSnap, roundsSnap] = await Promise.all([
    db.collection("matches").get(),
    db.collection("rounds").get(),
  ]);
  const firestoreMatches = matchesSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
  const existingRounds = {};
  roundsSnap.docs.forEach((d) => { existingRounds[d.id] = { ref: d.ref, ...d.data() }; });

  // ── Step 1: Update known matches (existing R32 docs matched by team name) ──
  const batch1 = db.batch();
  let kickoffsUpdated = 0, resultsUpdated = 0, skipped = 0;

  for (const m of apiMatches) {
    const apiHome = normalize(m.homeTeam?.name || "");
    const apiAway = normalize(m.awayTeam?.name || "");
    if (!apiHome || !apiAway) continue;

    const fsMatch = firestoreMatches.find(
      (fm) =>
        (fm.team1 === apiHome && fm.team2 === apiAway) ||
        (fm.team1 === apiAway && fm.team2 === apiHome)
    );
    if (!fsMatch) continue;

    const updates = {};

    if (m.utcDate) {
      const apiKo = new Date(m.utcDate);
      const fsKo = fsMatch.kickoff
        ? (fsMatch.kickoff.toDate ? fsMatch.kickoff.toDate() : new Date(fsMatch.kickoff))
        : null;
      if (!fsKo || Math.abs(apiKo - fsKo) > 60000) {
        updates.kickoff = apiKo;
        kickoffsUpdated++;
        console.log(`  [kickoff] ${fsMatch.team1} vs ${fsMatch.team2} → ${apiKo.toISOString()}`);
      }
    }

    if (FINISHED_STATUSES.has(m.status) && !fsMatch.result) {
      const score = m.score?.fullTime;
      const winner = m.score?.winner;
      if (score && winner && winner !== "DRAW") {
        const homeIsTeam1 = fsMatch.team1 === apiHome;
        updates.result   = winner === "HOME_TEAM" ? (homeIsTeam1 ? "team1" : "team2") : (homeIsTeam1 ? "team2" : "team1");
        updates.score1   = homeIsTeam1 ? score.home : score.away;
        updates.score2   = homeIsTeam1 ? score.away : score.home;
        updates.updatedByBot = true;
        const winName = updates.result === "team1" ? fsMatch.team1 : fsMatch.team2;
        console.log(`  [result]  ${fsMatch.team1} ${updates.score1}–${updates.score2} ${fsMatch.team2}  →  ${winName} wins`);
        resultsUpdated++;

        // Also store apiMatchId for future reference
        if (!fsMatch.apiMatchId) updates.apiMatchId = String(m.id);
      }
    } else if (FINISHED_STATUSES.has(m.status) && fsMatch.result) {
      skipped++;
    }

    if (Object.keys(updates).length > 0) batch1.update(fsMatch.ref, updates);
  }

  if (kickoffsUpdated + resultsUpdated > 0) {
    await batch1.commit();
    console.log(`\nMatch updates: ${kickoffsUpdated} kickoff(s), ${resultsUpdated} result(s). ${skipped} already recorded.`);
  } else {
    console.log(`\nNo match changes. ${skipped} already recorded.`);
  }

  // ── Step 2: Auto-fill knockout bracket (R16 → Final) ─────────────────────
  const batch2 = db.batch();
  let bracketChanges = 0;

  for (const m of apiMatches) {
    const roundId = STAGE_TO_ROUND[m.stage];
    if (!roundId) continue;

    const apiHome = normalize(m.homeTeam?.name || "");
    const apiAway = normalize(m.awayTeam?.name || "");
    const apiMatchId = String(m.id);
    const teamsKnown = !!apiHome && !!apiAway;

    // Auto-create round document if it doesn't exist yet
    if (!existingRounds[roundId]) {
      const meta = ROUND_META[roundId];
      const roundRef = db.collection("rounds").doc(roundId);
      batch2.set(roundRef, { name: meta.name, order: meta.order, status: "upcoming" }, { merge: true });
      existingRounds[roundId] = { ref: roundRef, status: "upcoming" };
      console.log(`[bracket] created round: ${roundId}`);
      bracketChanges++;
    }

    // Find matching Firestore document: by apiMatchId first, then by team names
    const fsMatch = firestoreMatches.find(
      (fm) =>
        fm.apiMatchId === apiMatchId ||
        (teamsKnown &&
          fm.roundId === roundId &&
          ((fm.team1 === apiHome && fm.team2 === apiAway) ||
            (fm.team1 === apiAway && fm.team2 === apiHome)))
    );

    if (fsMatch) {
      const upd = {};
      if (!fsMatch.apiMatchId) upd.apiMatchId = apiMatchId;

      // Fill in teams if they just became known
      if (teamsKnown && (!fsMatch.team1 || fsMatch.team1 === "TBD")) {
        upd.team1 = apiHome;
        upd.team2 = apiAway;
        console.log(`[bracket] ${roundId}: teams revealed → ${apiHome} vs ${apiAway}`);
      }

      // Sync kickoff
      if (m.utcDate) {
        const apiKo = new Date(m.utcDate);
        const fsKo = fsMatch.kickoff
          ? (fsMatch.kickoff.toDate ? fsMatch.kickoff.toDate() : new Date(fsMatch.kickoff))
          : null;
        if (!fsKo || Math.abs(apiKo - fsKo) > 60000) upd.kickoff = apiKo;
      }

      // Sync result (use upd.team1 if we just set it above)
      if (FINISHED_STATUSES.has(m.status) && !fsMatch.result && teamsKnown) {
        const score = m.score?.fullTime;
        const winner = m.score?.winner;
        if (score && winner && winner !== "DRAW") {
          const t1 = upd.team1 || fsMatch.team1;
          const homeIsTeam1 = t1 === apiHome;
          upd.result = winner === "HOME_TEAM" ? (homeIsTeam1 ? "team1" : "team2") : (homeIsTeam1 ? "team2" : "team1");
          upd.score1 = homeIsTeam1 ? score.home : score.away;
          upd.score2 = homeIsTeam1 ? score.away : score.home;
          upd.updatedByBot = true;
        }
      }

      if (Object.keys(upd).length > 0) {
        batch2.update(fsMatch.ref, upd);
        bracketChanges++;
      }
    } else {
      // Before creating a new doc, check if there's a TBD placeholder at the same kickoff
      // (admin may have pre-created placeholders that the team-name lookup missed)
      let tbdPlaceholder = null;
      if (m.utcDate) {
        const apiKoMs = new Date(m.utcDate).getTime();
        tbdPlaceholder = firestoreMatches.find(
          (fm) =>
            fm.roundId === roundId &&
            !fm.apiMatchId &&
            (!fm.team1 || fm.team1 === "TBD") &&
            fm.kickoff &&
            Math.abs(
              (fm.kickoff.toDate ? fm.kickoff.toDate() : new Date(fm.kickoff)).getTime() - apiKoMs
            ) < 60_000
        );
      }

      if (tbdPlaceholder) {
        // Claim the placeholder instead of creating a duplicate
        const upd = { apiMatchId };
        if (teamsKnown) { upd.team1 = apiHome; upd.team2 = apiAway; }
        if (m.utcDate) upd.kickoff = new Date(m.utcDate);
        if (FINISHED_STATUSES.has(m.status) && !tbdPlaceholder.result && teamsKnown) {
          const score = m.score?.fullTime;
          const winner = m.score?.winner;
          if (score && winner && winner !== "DRAW") {
            const t1 = upd.team1 || tbdPlaceholder.team1;
            const homeIsTeam1 = t1 === apiHome;
            upd.result = winner === "HOME_TEAM" ? (homeIsTeam1 ? "team1" : "team2") : (homeIsTeam1 ? "team2" : "team1");
            upd.score1 = homeIsTeam1 ? score.home : score.away;
            upd.score2 = homeIsTeam1 ? score.away : score.home;
            upd.updatedByBot = true;
          }
        }
        batch2.update(tbdPlaceholder.ref, upd);
        tbdPlaceholder.apiMatchId = apiMatchId; // prevent re-use within this run
        console.log(`[bracket] ${roundId}: claimed TBD placeholder → ${teamsKnown ? `${apiHome} vs ${apiAway}` : "TBD"}`);
        bracketChanges++;
      } else {
        // No existing doc — create one
        const doc = {
          roundId,
          team1: apiHome || "TBD",
          team2: apiAway || "TBD",
          apiMatchId,
          matchNum: m.id,
          result: null,
          score1: null,
          score2: null,
        };
        if (m.utcDate) doc.kickoff = new Date(m.utcDate);
        const newRef = db.collection("matches").doc();
        batch2.set(newRef, doc);
        console.log(`[bracket] ${roundId}: created ${doc.team1} vs ${doc.team2}`);
        bracketChanges++;
        firestoreMatches.push({ id: newRef.id, ref: newRef, ...doc });
      }
    }
  }

  if (bracketChanges > 0) {
    await batch2.commit();
    console.log(`Bracket: ${bracketChanges} change(s).`);
  } else {
    console.log("Bracket: no changes needed.");
  }

  // ── Step 3: Auto-manage round status ─────────────────────────────────────
  const OPEN_HOURS_BEFORE = 72;
  const now = new Date();

  // Re-fetch everything so we see all changes made above
  const [freshMatchesSnap, freshRoundsSnap] = await Promise.all([
    db.collection("matches").get(),
    db.collection("rounds").get(),
  ]);
  const matchesByRound = {};
  freshMatchesSnap.docs.forEach((d) => {
    const m = { id: d.id, ...d.data() };
    if (!matchesByRound[m.roundId]) matchesByRound[m.roundId] = [];
    matchesByRound[m.roundId].push(m);
  });

  for (const roundDoc of freshRoundsSnap.docs) {
    const round = roundDoc.data();
    const roundId = roundDoc.id;
    const realMatches = (matchesByRound[roundId] || []).filter(
      (m) => m.team1 && m.team1 !== "TBD" && m.team2 && m.team2 !== "TBD"
    );
    if (realMatches.length === 0) continue;

    if (round.status === "upcoming") {
      const kickoffs = realMatches
        .filter((m) => m.kickoff)
        .map((m) => (m.kickoff.toDate ? m.kickoff.toDate() : new Date(m.kickoff)))
        .sort((a, b) => a - b);
      if (kickoffs.length > 0) {
        const hoursUntil = (kickoffs[0] - now) / 36e5;
        if (hoursUntil <= OPEN_HOURS_BEFORE) {
          await roundDoc.ref.update({ status: "open" });
          console.log(`[round] ${roundId} → open (first match in ${Math.round(hoursUntil)}h)`);
        }
      }
    } else if (round.status === "open") {
      if (realMatches.every((m) => m.result)) {
        await roundDoc.ref.update({ status: "complete" });
        console.log(`[round] ${roundId} → complete (all ${realMatches.length} match(es) done)`);
      }
    }
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
