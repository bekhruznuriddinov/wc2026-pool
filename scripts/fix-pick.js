// Admin one-off: fix a player's pick for a specific match.
// Driven entirely by env vars set from the workflow_dispatch inputs.

const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
  const playerName = process.env.PLAYER_NAME;
  const team1      = process.env.TEAM1;
  const team2      = process.env.TEAM2;
  const pickWinner = process.env.PICK_WINNER;
  const score1     = process.env.SCORE1;
  const score2     = process.env.SCORE2;

  console.log(`Looking for player: ${playerName}`);
  console.log(`Match: ${team1} vs ${team2}`);
  console.log(`Pick winner: ${pickWinner}`);
  if (score1 !== "" && score2 !== "") console.log(`Score: ${score1}-${score2}`);

  // Find player
  const usersSnap = await db.collection("users").get();
  const userDoc = usersSnap.docs.find(d =>
    (d.data().name || "").toLowerCase().startsWith(playerName.toLowerCase())
  );
  if (!userDoc) { console.error(`No user found starting with "${playerName}"`); process.exit(1); }
  console.log(`Found user: ${userDoc.data().name} (${userDoc.id})`);

  // Find match
  const matchesSnap = await db.collection("matches").get();
  const matchDoc = matchesSnap.docs.find(d => {
    const { team1: t1, team2: t2 } = d.data();
    return (t1 === team1 && t2 === team2) || (t1 === team2 && t2 === team1);
  });
  if (!matchDoc) { console.error(`Match "${team1} vs ${team2}" not found`); process.exit(1); }
  const matchData = matchDoc.data();
  console.log(`Found match: ${matchData.team1} vs ${matchData.team2} (${matchDoc.id})`);

  // Determine winner side
  const winnerSide = matchData.team1 === pickWinner ? "team1" :
                     matchData.team2 === pickWinner ? "team2" : null;
  if (!winnerSide) { console.error(`"${pickWinner}" is not one of the teams in this match`); process.exit(1); }
  console.log(`${pickWinner} is ${winnerSide}`);

  // Build pick object
  const pick = { winner: winnerSide };
  if (score1 !== "" && score2 !== "") {
    pick.score1 = score1;
    pick.score2 = score2;
  }

  // Write to Firestore
  await db.collection("predictions").doc(userDoc.id).set(
    { picks: { [matchDoc.id]: pick } },
    { merge: true }
  );

  console.log(`Done — updated ${userDoc.data().name}'s pick: ${JSON.stringify(pick)}`);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
