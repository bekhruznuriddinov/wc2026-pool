const user = requireAuth();
renderUserBar(user);

let allMatches = [];
let myPicks = {};     // { matchId: { winner: 'team1', score1: 2, score2: 1 } }
let currentRoundId = null;

async function init() {
  document.getElementById("loading").style.display = "flex";
  try {
    const roundsSnap = await db.collection("rounds").orderBy("order").get();
    const rounds = roundsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (rounds.length === 0) {
      document.getElementById("loading").style.display = "none";
      document.getElementById("noRounds").style.display = "block";
      return;
    }

    buildRoundTabs(rounds);

    const picksDoc = await db.collection("predictions").doc(user.userId).get();
    myPicks = picksDoc.exists ? (picksDoc.data().picks || {}) : {};

    const openRound = rounds.find(r => r.status === "open");
    const nonCompleteRound = rounds.find(r => r.status !== "complete");
    currentRoundId = (openRound || nonCompleteRound || rounds[0]).id;
    await loadRound(currentRoundId, rounds);

  } catch (err) {
    console.error(err);
    document.getElementById("loading").innerHTML =
      '<p class="text-muted">Failed to load matches. Check your Firebase config.</p>';
  }
}

function buildRoundTabs(rounds) {
  document.getElementById("roundTabs").innerHTML = rounds.map(r => `
    <button class="round-tab" data-round="${r.id}" onclick="switchRound('${r.id}')">
      ${r.name}
      <span class="badge badge-${r.status}" style="margin-left:6px;font-size:0.65rem">${r.status}</span>
    </button>
  `).join("");
}

async function switchRound(roundId) {
  if (roundId === currentRoundId) return;
  currentRoundId = roundId;
  document.getElementById("loading").style.display = "flex";
  document.getElementById("roundContent").style.display = "none";
  const roundsSnap = await db.collection("rounds").orderBy("order").get();
  const rounds = roundsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  await loadRound(roundId, rounds);
}

async function loadRound(roundId, rounds) {
  const round = rounds.find(r => r.id === roundId);
  document.querySelectorAll(".round-tab").forEach(t =>
    t.classList.toggle("active", t.dataset.round === roundId));

  const matchSnap = await db.collection("matches")
    .where("roundId", "==", roundId)
    .get();
  allMatches = matchSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.matchNum - b.matchNum);

  document.getElementById("loading").style.display = "none";
  document.getElementById("roundContent").style.display = "block";
  renderRound(round);
}

function renderRound(round) {
  const isOpen = round.status === "open";
  const isComplete = round.status === "complete";
  const pts = ROUND_POINTS[round.id];

  let deadlineStr = "";
  if (round.deadline) {
    const d = round.deadline.toDate ? round.deadline.toDate() : new Date(round.deadline);
    deadlineStr = `Deadline: ${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} &nbsp;·&nbsp; `;
  }

  document.getElementById("roundHeader").innerHTML = `
    <div class="round-info">
      <h2>${round.name}</h2>
      <p>${deadlineStr}${pts} pt${pts > 1 ? "s" : ""} per correct winner · +5 exact score · +1 correct margin</p>
    </div>
    <span class="badge badge-${round.status}">${round.status}</span>
  `;

  let alertHtml = "";
  if (!isOpen && !isComplete) {
    alertHtml = `<div class="alert alert-warning">This round isn't open yet. Check back soon.</div>`;
  } else if (isComplete) {
    const earned = calcRoundScore(round.id);
    alertHtml = `<div class="alert alert-info">Round complete — you scored <strong>${earned} pts</strong> in this round.</div>`;
  } else if (isOpen) {
    const now = new Date();
    const pickable = allMatches.filter(m => {
      if (!m.team1 || m.team1 === "TBD") return false;
      const ko = m.kickoff ? (m.kickoff.toDate ? m.kickoff.toDate() : new Date(m.kickoff)) : null;
      return !ko || now < ko;
    });
    const rem = pickable.filter(m => !myPicks[m.id]?.winner).length;
    if (rem > 0) {
      alertHtml = `<div class="alert alert-warning"><strong>${rem} match${rem > 1 ? "es" : ""} unpicked</strong> — save before kickoff. Score predictions are optional but earn bonus points.</div>`;
    } else {
      alertHtml = `<div class="alert alert-success">All open matches picked! Don't forget to save.</div>`;
    }
  }
  document.getElementById("roundAlert").innerHTML = alertHtml;

  document.getElementById("matchesList").innerHTML = allMatches.length
    ? allMatches.map(m => matchCard(m, round)).join("")
    : `<div class="empty-state"><div class="icon">⏳</div><h3>No matches yet</h3><p>The admin hasn't added matches for this round.</p></div>`;

  const submitBar = document.getElementById("submitBar");
  if (isOpen && allMatches.length > 0) {
    submitBar.style.display = "flex";
    updatePickCounter();
  } else {
    submitBar.style.display = "none";
  }
}

function matchCard(match, round) {
  const p = myPicks[match.id] || {};
  const result = match.result;
  const isOpen = round.status === "open";

  // Per-match kickoff enforcement
  const kickoffVal = match.kickoff;
  const kickoff = kickoffVal
    ? (kickoffVal.toDate ? kickoffVal.toDate() : new Date(kickoffVal))
    : null;
  const started = kickoff && new Date() > kickoff;

  const isLocked = !isOpen || started;
  const tbd1 = !match.team1 || match.team1 === "TBD";
  const tbd2 = !match.team2 || match.team2 === "TBD";

  if (tbd1 && tbd2) {
    return `
    <div class="match-card" id="match-${match.id}" style="opacity:0.6">
      <div class="match-number">Match ${match.matchNum} &nbsp;·&nbsp; ${match.date || ""}</div>
      <div style="font-size:0.85rem;color:var(--text-muted);text-align:center;padding:0.5rem 0">
        ${match.bracketLabel || "TBD vs TBD"}
      </div>
    </div>`;
  }

  const clickable = isOpen && !tbd1 && !tbd2 && !started;

  const kickoffBadge = started && !result
    ? `<span style="margin-left:6px;font-size:0.65rem;background:rgba(245,158,11,0.15);color:var(--gold);padding:1px 6px;border-radius:4px;font-weight:600">IN PROGRESS</span>`
    : kickoff && !started && !result
      ? `<span style="margin-left:6px;font-size:0.65rem;color:var(--text-muted)">${kickoff.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>`
      : "";

  function teamClass(side) {
    if (result) {
      if (p.winner === side) return result === side ? "correct" : "wrong";
      if (!p.winner && result === side) return "correct";
    }
    return p.winner === side ? "selected" : "";
  }

  // Bonus points earned display
  function bonusLabel() {
    if (!result || !p.winner) return "";
    const pts = ROUND_POINTS[round.id];
    const a1 = parseInt(match.score1), a2 = parseInt(match.score2);
    const s1 = parseInt(p.score1), s2 = parseInt(p.score2);
    const correctWinner = p.winner === result;
    let earned = correctWinner ? pts : 0;
    let bonusNote = "";
    if (correctWinner && !isNaN(s1) && !isNaN(s2) && !isNaN(a1) && !isNaN(a2)) {
      if (s1 === a1 && s2 === a2) { earned += 5; bonusNote = " +5 exact score!"; }
      else if ((s1 - s2) === (a1 - a2)) { earned += 1; bonusNote = " +1 correct margin"; }
    }
    const color = correctWinner ? "text-green" : "text-red";
    const icon = correctWinner ? "✓" : "✗";
    const scoreStr = (!isNaN(a1) && !isNaN(a2)) ? ` (${a1}–${a2})` : "";
    return `<span class="${color}">${icon} ${earned} pt${earned !== 1 ? "s" : ""}${scoreStr}${bonusNote}</span>`;
  }

  // Show predicted score in locked/complete state
  function predictedScoreLabel() {
    if (!isLocked || (!p.score1 && p.score1 !== 0)) return "";
    return `<span class="text-muted text-small">Your score: ${p.score1}–${p.score2}</span>`;
  }

  const s1val = (p.score1 !== undefined && p.score1 !== null) ? p.score1 : "";
  const s2val = (p.score2 !== undefined && p.score2 !== null) ? p.score2 : "";

  return `
  <div class="match-card" id="match-${match.id}">
    <div class="match-number">Match ${match.matchNum}${match.date ? " &nbsp;·&nbsp; " + match.date : ""}${kickoffBadge}</div>
    <div class="match-teams">
      <button class="team-btn ${teamClass("team1")} ${isLocked ? "locked" : ""}"
        ${clickable ? `onclick="pick('${match.id}','team1')"` : "disabled"}
        style="${!clickable ? "cursor:default" : ""}">
        <span class="team-flag">${flag(match.team1)}</span>
        <span class="team-name">${match.team1}</span>
      </button>

      <div class="score-center">
        ${clickable ? `
          <input class="score-input" type="number" min="0" max="20" placeholder="–"
            value="${s1val}"
            oninput="updateScore('${match.id}','score1',this.value)"
            onclick="event.stopPropagation()">
          <span class="score-dash">:</span>
          <input class="score-input" type="number" min="0" max="20" placeholder="–"
            value="${s2val}"
            oninput="updateScore('${match.id}','score2',this.value)"
            onclick="event.stopPropagation()">
        ` : `
          <span class="score-static">${
            (match.score1 !== undefined && match.score2 !== undefined && match.score1 !== null)
              ? `${match.score1} : ${match.score2}`
              : "vs"
          }</span>
        `}
      </div>

      <button class="team-btn ${teamClass("team2")} ${isLocked ? "locked" : ""}"
        ${clickable ? `onclick="pick('${match.id}','team2')"` : "disabled"}
        style="${!clickable ? "cursor:default" : ""}">
        <span class="team-flag">${flag(match.team2)}</span>
        <span class="team-name">${match.team2}</span>
      </button>
    </div>
    ${(result || p.winner) ? `
      <div class="match-result">
        ${bonusLabel()}
        ${predictedScoreLabel()}
      </div>` : ""}
    ${clickable && !result ? `<div class="score-hint">Optional: predict the score for +5 (exact) or +1 (right margin)</div>` : ""}
  </div>`;
}

function pick(matchId, side) {
  const p = myPicks[matchId] || {};
  if (p.winner === side) {
    // toggle off winner but keep scores
    myPicks[matchId] = { ...p, winner: null };
    if (!myPicks[matchId].winner) delete myPicks[matchId].winner;
  } else {
    myPicks[matchId] = { ...p, winner: side };
  }
  rerenderCard(matchId);
  updatePickCounter();
}

function updateScore(matchId, field, val) {
  const p = myPicks[matchId] || {};
  const num = val === "" ? null : parseInt(val);
  myPicks[matchId] = { ...p, [field]: num };

  // Auto-select winner if both scores filled and unequal
  const updated = myPicks[matchId];
  const s1 = updated.score1, s2 = updated.score2;
  if (s1 !== null && s2 !== null && !isNaN(s1) && !isNaN(s2) && s1 !== s2) {
    myPicks[matchId].winner = s1 > s2 ? "team1" : "team2";
    rerenderCard(matchId);
    updatePickCounter();
  } else {
    // Just update the card classes without re-rendering inputs (preserves focus)
    const match = allMatches.find(m => m.id === matchId);
    const card = document.getElementById(`match-${matchId}`);
    if (card && match) {
      card.querySelector(".team-btn:first-child")?.classList.toggle("selected", myPicks[matchId]?.winner === "team1");
      card.querySelector(".team-btn:last-child")?.classList.toggle("selected", myPicks[matchId]?.winner === "team2");
    }
  }
}

function rerenderCard(matchId) {
  const match = allMatches.find(m => m.id === matchId);
  const round = { id: currentRoundId, status: "open" };
  const card = document.getElementById(`match-${matchId}`);
  if (card && match) card.outerHTML = matchCard(match, round);
}

function updatePickCounter() {
  const now = new Date();
  const pickable = allMatches.filter(m => {
    if (!m.team1 || m.team1 === "TBD") return false;
    const ko = m.kickoff ? (m.kickoff.toDate ? m.kickoff.toDate() : new Date(m.kickoff)) : null;
    return !ko || now < ko;
  });
  const picked = pickable.filter(m => myPicks[m.id]?.winner).length;
  document.getElementById("pickCount").textContent = `${picked}/${pickable.length} picked`;
  document.getElementById("submitBtn").disabled = picked === 0;
}

async function submitPicks() {
  const btn = document.getElementById("submitBtn");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const roundDoc = await db.collection("rounds").doc(currentRoundId).get();
    const roundData = roundDoc.exists ? roundDoc.data() : null;
    if (!roundData || roundData.status !== "open") {
      showToast("This round is no longer open.", "error");
      btn.disabled = false; btn.textContent = "Save predictions"; return;
    }
    if (roundData.deadline) {
      const deadline = roundData.deadline.toDate ? roundData.deadline.toDate() : new Date(roundData.deadline);
      if (new Date() > deadline) {
        showToast("The deadline for this round has passed.", "error");
        btn.disabled = false; btn.textContent = "Save predictions"; return;
      }
    }
    await db.collection("predictions").doc(user.userId).set({
      picks: myPicks,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    showToast("Predictions saved!", "success");
    document.getElementById("roundAlert").innerHTML =
      `<div class="alert alert-success">Predictions saved — good luck!</div>`;
  } catch (err) {
    console.error(err);
    showToast("Failed to save. Try again.", "error");
  }
  btn.disabled = false;
  btn.textContent = "Save predictions";
}

function calcRoundScore(roundId) {
  return allMatches.reduce((sum, m) => sum + calcMatchPoints(roundId, m, myPicks[m.id]), 0);
}

function calcMatchPoints(roundId, match, pick) {
  if (!match.result || !pick?.winner) return 0;
  if (pick.winner !== match.result) return 0;
  let pts = ROUND_POINTS[roundId];
  const s1 = parseInt(pick.score1), s2 = parseInt(pick.score2);
  const a1 = parseInt(match.score1), a2 = parseInt(match.score2);
  if (!isNaN(s1) && !isNaN(s2) && !isNaN(a1) && !isNaN(a2)) {
    if (s1 === a1 && s2 === a2) pts += 5;
    else if ((s1 - s2) === (a1 - a2)) pts += 1;
  }
  return pts;
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
