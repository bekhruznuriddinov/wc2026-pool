const user = requireAuth();
renderUserBar(user);

let allMatches = [];
let myPicks = {};
let currentRoundId = null;
let roundStatuses = {};

async function init() {
  document.getElementById("loading").style.display = "flex";
  try {
    // Load all rounds
    const roundsSnap = await db.collection("rounds").orderBy("order").get();
    const rounds = roundsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (rounds.length === 0) {
      document.getElementById("loading").style.display = "none";
      document.getElementById("noRounds").style.display = "block";
      return;
    }

    rounds.forEach(r => { roundStatuses[r.id] = r.status; });

    // Build round tabs
    buildRoundTabs(rounds);

    // Load user's picks
    const picksDoc = await db.collection("predictions").doc(user.userId).get();
    myPicks = picksDoc.exists ? (picksDoc.data().picks || {}) : {};

    // Default to first open round, else first round
    const openRound = rounds.find(r => r.status === "open");
    const firstRound = rounds[0];
    currentRoundId = (openRound || firstRound).id;

    await loadRound(currentRoundId, rounds);

  } catch (err) {
    console.error(err);
    document.getElementById("loading").innerHTML =
      '<p class="text-muted">Failed to load matches. Check your Firebase config.</p>';
  }
}

function buildRoundTabs(rounds) {
  const nav = document.getElementById("roundTabs");
  nav.innerHTML = rounds.map(r => `
    <button class="round-tab" data-round="${r.id}" onclick="switchRound('${r.id}')">
      ${r.name}
      <span class="badge badge-${r.status}" style="margin-left:6px;font-size:0.65rem">${r.status}</span>
    </button>
  `).join("");
}

async function switchRound(roundId) {
  if (roundId === currentRoundId) return;
  currentRoundId = roundId;
  document.querySelectorAll(".round-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.round === roundId);
  });
  document.getElementById("loading").style.display = "flex";
  document.getElementById("roundContent").style.display = "none";

  const roundsSnap = await db.collection("rounds").orderBy("order").get();
  const rounds = roundsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  await loadRound(roundId, rounds);
}

async function loadRound(roundId, rounds) {
  const round = rounds.find(r => r.id === roundId);

  // Activate tab
  document.querySelectorAll(".round-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.round === roundId);
  });

  // Load matches for this round
  const matchSnap = await db.collection("matches")
    .where("roundId", "==", roundId)
    .orderBy("matchNum")
    .get();

  allMatches = matchSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  document.getElementById("loading").style.display = "none";
  document.getElementById("roundContent").style.display = "block";

  renderRound(round, rounds);
}

function renderRound(round, rounds) {
  const isOpen = round.status === "open";
  const isComplete = round.status === "complete";

  // Round header
  let deadlineStr = "";
  if (round.deadline) {
    const d = round.deadline.toDate ? round.deadline.toDate() : new Date(round.deadline);
    deadlineStr = `Deadline: ${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`;
  }

  document.getElementById("roundHeader").innerHTML = `
    <div class="round-info">
      <h2>${round.name}</h2>
      <p>${deadlineStr || ""} &nbsp; ${ROUND_POINTS[round.id]} pt${ROUND_POINTS[round.id] > 1 ? "s" : ""} per correct pick</p>
    </div>
    <span class="badge badge-${round.status}">${round.status}</span>
  `;

  // Status alert
  let alertHtml = "";
  if (!isOpen && !isComplete) {
    alertHtml = `<div class="alert alert-warning">This round isn't open yet. Check back soon.</div>`;
  } else if (isComplete) {
    const earned = calcRoundScore(round.id);
    const total = allMatches.length * ROUND_POINTS[round.id];
    alertHtml = `<div class="alert alert-info">Round complete — you scored <strong>${earned}/${total} pts</strong> in this round.</div>`;
  } else if (isOpen) {
    const pickedCount = allMatches.filter(m => myPicks[m.id]).length;
    const remaining = allMatches.length - pickedCount;
    if (remaining > 0) {
      alertHtml = `<div class="alert alert-warning">You have <strong>${remaining} unpicked match${remaining > 1 ? "es" : ""}</strong> — submit before the deadline.</div>`;
    } else {
      alertHtml = `<div class="alert alert-success">All matches picked! Submit your predictions.</div>`;
    }
  }
  document.getElementById("roundAlert").innerHTML = alertHtml;

  // Matches
  document.getElementById("matchesList").innerHTML = allMatches.length
    ? allMatches.map(m => matchCard(m, round, isOpen)).join("")
    : `<div class="empty-state"><div class="icon">⏳</div><h3>No matches yet</h3><p>The admin hasn't added matches for this round yet.</p></div>`;

  // Submit bar
  const submitBar = document.getElementById("submitBar");
  if (isOpen && allMatches.length > 0) {
    const count = allMatches.filter(m => myPicks[m.id]).length;
    submitBar.style.display = "flex";
    document.getElementById("pickCount").textContent = `${count}/${allMatches.length} picked`;
    document.getElementById("submitBtn").disabled = count === 0;
  } else {
    submitBar.style.display = "none";
  }
}

function matchCard(match, round, isOpen) {
  const myPick = myPicks[match.id];
  const result = match.result;
  const isLocked = round.status !== "open";
  const tbd1 = !match.team1 || match.team1 === "TBD";
  const tbd2 = !match.team2 || match.team2 === "TBD";

  function teamClass(side) {
    if (isLocked && result) {
      if (myPick === side) return result === side ? "correct" : "wrong";
    }
    if (myPick === side) return "selected";
    return "";
  }

  function resultLabel() {
    if (!result) return "";
    const winner = result === "team1" ? match.team1 : match.team2;
    const icon = myPick && myPick === result ? "✓" : myPick ? "✗" : "–";
    const color = myPick && myPick === result ? "text-green" : myPick ? "text-red" : "text-muted";
    return `<span class="${color}">${icon} ${winner} won &nbsp;·&nbsp; ${ROUND_POINTS[round.id]} pt${myPick === result ? "s earned" : "s missed"}</span>`;
  }

  const clickable = isOpen && !isLocked && !tbd1 && !tbd2;

  return `
  <div class="match-card" id="match-${match.id}">
    <div class="match-number">Match ${match.matchNum}</div>
    <div class="match-teams">
      <button class="team-btn ${teamClass("team1")} ${isLocked ? "locked" : ""}"
        ${clickable ? `onclick="pick('${match.id}', 'team1')"` : "disabled"}
        style="${!clickable ? "cursor:default" : ""}">
        <span class="team-name">${match.team1 || "TBD"}</span>
      </button>
      <div class="vs">VS</div>
      <button class="team-btn ${teamClass("team2")} ${isLocked ? "locked" : ""}"
        ${clickable ? `onclick="pick('${match.id}', 'team2')"` : "disabled"}
        style="${!clickable ? "cursor:default" : ""}">
        <span class="team-name">${match.team2 || "TBD"}</span>
      </button>
    </div>
    ${result || myPick ? `<div class="match-result">${resultLabel()}${!result && myPick ? `<span class="text-muted text-small">Your pick: ${myPick === "team1" ? match.team1 : match.team2}</span>` : ""}</div>` : ""}
  </div>`;
}

function pick(matchId, side) {
  // Toggle off if same pick
  if (myPicks[matchId] === side) {
    delete myPicks[matchId];
  } else {
    myPicks[matchId] = side;
  }

  const match = allMatches.find(m => m.id === matchId);
  const roundTab = document.querySelector(`.round-tab[data-round="${currentRoundId}"]`);
  const round = { id: currentRoundId, status: "open" };

  // Re-render just this card
  const card = document.getElementById(`match-${matchId}`);
  if (card) card.outerHTML = matchCard(match, round, true);

  // Update pick counter
  const count = allMatches.filter(m => myPicks[m.id]).length;
  document.getElementById("pickCount").textContent = `${count}/${allMatches.length} picked`;
  document.getElementById("submitBtn").disabled = count === 0;
}

async function submitPicks() {
  const btn = document.getElementById("submitBtn");
  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    // Verify round still open
    const roundDoc = await db.collection("rounds").doc(currentRoundId).get();
    if (!roundDoc.exists || roundDoc.data().status !== "open") {
      showToast("This round is no longer open for predictions.", "error");
      btn.disabled = false;
      btn.textContent = "Submit predictions";
      return;
    }

    await db.collection("predictions").doc(user.userId).set({
      picks: myPicks,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    showToast("Predictions saved!", "success");
    btn.textContent = "Submit predictions";
    btn.disabled = false;

    // Update pick count alert
    const roundAlert = document.getElementById("roundAlert");
    roundAlert.innerHTML = `<div class="alert alert-success">Predictions saved — good luck!</div>`;

  } catch (err) {
    console.error(err);
    showToast("Failed to save. Try again.", "error");
    btn.disabled = false;
    btn.textContent = "Submit predictions";
  }
}

function calcRoundScore(roundId) {
  return allMatches.reduce((sum, m) => {
    if (m.result && myPicks[m.id] === m.result) return sum + ROUND_POINTS[roundId];
    return sum;
  }, 0);
}

function showToast(msg, type = "info") {
  const t = document.createElement("div");
  t.className = `alert alert-${type}`;
  t.textContent = msg;
  t.style.cssText = "position:fixed;bottom:5rem;right:1rem;max-width:300px;z-index:99;";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

init();
