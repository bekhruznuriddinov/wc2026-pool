const user = requireAuth();
renderUserBar(user);

let allMatches = [];
let myPicks = {};          // { matchId: { winner: 'team1', score1: 2, score2: 1 } }
let peerPicks = {};        // { matchId: { team1: ['Alice', 'Bob'], team2: ['Carol'] } }
let allPlayerPicks = {};   // { matchId: { team1: [{name, isSelf}], team2: [...] } }
let peerDisplayNames = {}; // { fullName → displayName }
let currentRoundId = null;
let currentRoundData = null;
let showGroupView = false;
let saveTimer = null;

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

    const [picksDoc] = await Promise.all([
      db.collection("predictions").doc(user.userId).get(),
      loadPeerPicks()
    ]);
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
  currentRoundData = round;
  allMatches = matchSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const koA = a.kickoff ? (a.kickoff.toDate ? a.kickoff.toDate() : new Date(a.kickoff)) : null;
      const koB = b.kickoff ? (b.kickoff.toDate ? b.kickoff.toDate() : new Date(b.kickoff)) : null;
      if (koA && koB) return koA - koB;
      if (koA) return -1;
      if (koB) return 1;
      return a.matchNum - b.matchNum;
    });

  // Dedup: drop manually pre-created TBD placeholders superseded by bot-created docs.
  // Bot-created docs always have apiMatchId; manually created ones never do.
  // If the round has any bot-created doc, any TBD doc without apiMatchId is stale.
  const hasApiDoc = allMatches.some(m => m.apiMatchId);
  if (hasApiDoc) {
    allMatches = allMatches.filter(m =>
      m.apiMatchId || (m.team1 && m.team1 !== "TBD")
    );
  }

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
      <p>${deadlineStr}${pts} pt${pts > 1 ? "s" : ""} base per correct winner · up to ${8 * pts} pts with bonuses</p>
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
      alertHtml = `<div class="alert alert-warning"><strong>${rem} match${rem > 1 ? "es" : ""} unpicked</strong> — picks lock at kickoff.</div>`;
    } else {
      alertHtml = `<div class="alert alert-success">All open matches picked!</div>`;
    }
  }
  document.getElementById("roundAlert").innerHTML = alertHtml;

  // Scoring banner
  const maxMatchPts = 8 * pts;
  document.getElementById("scoringBanner").innerHTML = (isOpen || isComplete) ? `
    <details class="scoring-banner">
      <summary>How scoring works</summary>
      <div class="scoring-banner-body">
        <div class="scoring-chain">
          <span><strong style="color:var(--green)">+${pts}</strong> correct winner</span>
          <span class="chain-arrow">→</span>
          <span><strong style="color:#7F77DD">+${pts}</strong> maverick</span>
          <span class="chain-arrow">→</span>
          <span><strong style="color:var(--green)">+${pts}</strong> right margin</span>
          <span class="chain-arrow">→</span>
          <span><strong style="color:var(--green)">+${5 * pts}</strong> exact score</span>
          <span class="chain-arrow">=</span>
          <strong>${maxMatchPts} pts max</strong>
        </div>
        <div style="margin-top:0.4rem;font-size:0.8rem;color:var(--text-muted)">
          Maverick: <strong style="color:#7F77DD">+${pts}</strong> if you picked against the majority and won.
          Bonuses stack. Wrong score prediction deducts <strong style="color:var(--red)">−${pts}</strong> (correct winner only, never goes negative).
          Penalty shootouts: the winning team gets <strong>+1 goal</strong> for scoring purposes (e.g. 1–1 pens = 2–1). If you predicted a draw score with the correct winner, it counts the same way — so predicting 1–1 or 2–1 for a 1–1 pens match both earn exact-score points.
        </div>
      </div>
    </details>` : "";

  // View toggle
  const toggleEl = document.getElementById("viewToggle");
  toggleEl.style.display = "flex";
  toggleEl.style.justifyContent = "flex-end";
  toggleEl.style.margin = "0.75rem 0 0.25rem";
  toggleEl.innerHTML = `
    <div class="view-toggle-seg">
      <button onclick="setView(false)" class="${!showGroupView ? 'active' : ''}">My Picks</button>
      <button onclick="setView(true)" class="${showGroupView ? 'active' : ''}">All Picks</button>
    </div>`;

  renderMatchesList(round);

  const submitBar = document.getElementById("submitBar");
  if (isOpen && allMatches.length > 0) {
    submitBar.style.display = "flex";
    updatePickCounter();
  } else {
    submitBar.style.display = "none";
  }
}

async function loadPeerPicks() {
  try {
    const [usersSnap, predsSnap] = await Promise.all([
      db.collection("users").get(),
      db.collection("predictions").get()
    ]);
    const names = {};
    usersSnap.docs.forEach(d => { names[d.id] = d.data().name; });
    const allNames = [user.name, ...Object.values(names)].filter(Boolean);
    peerDisplayNames = buildDisplayNames(allNames);

    peerPicks = {};
    allPlayerPicks = {};

    predsSnap.docs.forEach(doc => {
      const isSelf = doc.id === user.userId;
      const name = isSelf ? user.name : names[doc.id];
      if (!name) return;
      Object.entries(doc.data().picks || {}).forEach(([matchId, pick]) => {
        const pickObj = (pick && typeof pick === "object") ? pick : { winner: pick };
        const winner = pickObj.winner;
        if (winner !== "team1" && winner !== "team2") return;
        if (!allPlayerPicks[matchId]) allPlayerPicks[matchId] = { team1: [], team2: [] };
        allPlayerPicks[matchId][winner].push({ name, isSelf, pick: pickObj });
        if (!isSelf) {
          if (!peerPicks[matchId]) peerPicks[matchId] = { team1: [], team2: [] };
          peerPicks[matchId][winner].push(name);
        }
      });
    });
  } catch (e) {
    console.error("loadPeerPicks failed:", e.code, e.message);
  }
}

function pickerLabel(names) {
  if (!names || names.length === 0) return "";
  const MAX = 4;
  const display = names.map(n => peerDisplayNames[n] || n.split(" ")[0]);
  const list = display.length <= MAX ? display.join(", ") : display.slice(0, MAX).join(", ") + "…";
  return `Also picked by ${list}`;
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

  const freebieBadge = match.freebie
    ? `<span style="margin-left:6px;font-size:0.65rem;background:rgba(34,197,94,0.15);color:#22c55e;padding:1px 6px;border-radius:4px;font-weight:600">FREE PICK</span>`
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
    if (!result) return "";
    if (match.freebie) {
      const pts = ROUND_POINTS[round.id];
      return `<span class="text-green">★ Free pick — ${pts} pt${pts !== 1 ? "s" : ""} for everyone</span>`;
    }
    if (!p.winner) return "";
    const pts = ROUND_POINTS[round.id];
    const a1 = parseInt(match.score1), a2 = parseInt(match.score2);
    const s1 = parseInt(p.score1), s2 = parseInt(p.score2);
    const correctWinner = p.winner === result;
    let earned = correctWinner ? pts : 0;
    const notes = [];
    const pc = getPickCounts();
    if (correctWinner && isMaverick(match.id, p.winner, pc)) { earned += pts; notes.push(`+${pts} maverick`); }
    if (!isNaN(s1) && !isNaN(s2) && !isNaN(a1) && !isNaN(a2)) {
      if (s1 === a1 && s2 === a2) { if (correctWinner) { earned += 6 * pts; notes.push(`+${pts} margin +${5*pts} exact!`); } }
      else if ((s1 - s2) === (a1 - a2)) { if (correctWinner) { earned += pts; notes.push(`+${pts} correct margin`); } }
      else if (correctWinner) { earned -= pts; notes.push(`−${pts} wrong score`); }
    }
    const color = correctWinner ? "text-green" : "text-red";
    const icon = correctWinner ? "✓" : "✗";
    const scoreStr = (!isNaN(a1) && !isNaN(a2)) ? ` (${a1}–${a2})` : "";
    const noteStr = notes.length ? " " + notes.join(" ") : "";
    return `<span class="${color}">${icon} ${earned} pt${earned !== 1 ? "s" : ""}${scoreStr}${noteStr}</span>`;
  }

  // Show predicted score in locked/complete state
  function predictedScoreLabel() {
    if (!isLocked || (!p.score1 && p.score1 !== 0)) return "";
    return `<span class="text-muted text-small">Your score: ${p.score1}–${p.score2}</span>`;
  }

  const s1val = (p.score1 !== undefined && p.score1 !== null) ? p.score1 : "";
  const s2val = (p.score2 !== undefined && p.score2 !== null) ? p.score2 : "";
  const peers1 = peerPicks[match.id]?.team1 || [];
  const peers2 = peerPicks[match.id]?.team2 || [];

  // Pts chip — top-right of card
  const maxPts = 8 * ROUND_POINTS[round.id]; // 1× base + 1× maverick + 1× margin + 5× exact
  let ptsChip;
  if (match.freebie) {
    ptsChip = `<span class="match-pts-chip match-pts-free">FREE</span>`;
  } else if (result) {
    const earned = calcMatchPoints(round.id, match, p.winner ? p : null, getPickCounts());
    const cls = earned > 0 ? "match-pts-earned" : earned < 0 ? "match-pts-neg" : "match-pts-zero";
    ptsChip = `<span class="match-pts-chip ${cls}">${earned} / ${maxPts} pts</span>`;
  } else {
    ptsChip = `<span class="match-pts-chip match-pts-dim">/ ${maxPts} pts</span>`;
  }

  return `
  <div class="match-card" id="match-${match.id}">
    <div class="match-number">
      <span>Match ${match.matchNum}${match.date ? " · " + match.date : ""}${kickoffBadge}${freebieBadge}</span>
      ${ptsChip}
    </div>
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
            onblur="autoSave()"
            onclick="event.stopPropagation()">
          <span class="score-dash">:</span>
          <input class="score-input" type="number" min="0" max="20" placeholder="–"
            value="${s2val}"
            oninput="updateScore('${match.id}','score2',this.value)"
            onblur="autoSave()"
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
    ${(peers1.length || peers2.length) ? `
    <div class="picks-social">
      <span class="picks-social-label">${pickerLabel(peers1)}</span>
      <span></span>
      <span class="picks-social-label picks-social-right">${pickerLabel(peers2)}</span>
    </div>` : ""}
    ${(result || p.winner) ? `
      <div class="match-result">
        ${bonusLabel()}
        ${predictedScoreLabel()}
      </div>` : ""}
    ${isOpen && !result && !tbd1 && !tbd2 ? `<div class="score-hint">Score: <strong style="color:var(--green)">+1</strong> winner <span class="chain-arrow">→</span> <strong style="color:#7F77DD">+1</strong> maverick <span class="chain-arrow">→</span> <strong style="color:var(--green)">+1</strong> margin <span class="chain-arrow">→</span> <strong style="color:var(--green)">+5</strong> exact &nbsp;·&nbsp; <strong style="color:var(--red)">−1</strong> if wrong</div>` : ""}
  </div>`;
}

function renderMatchesList(round) {
  const r = round || currentRoundData;
  if (!r) return;
  document.getElementById("matchesList").innerHTML = allMatches.length
    ? allMatches.map(m => showGroupView ? groupMatchCard(m, r) : matchCard(m, r)).join("")
    : `<div class="empty-state"><div class="icon">⏳</div><h3>No matches yet</h3><p>The admin hasn't added matches for this round.</p></div>`;
}

function setView(isGroup) {
  showGroupView = isGroup;
  document.querySelectorAll(".view-toggle-seg button").forEach((btn, i) => {
    btn.classList.toggle("active", isGroup ? i === 1 : i === 0);
  });
  renderMatchesList();
}

function groupMatchCard(match, round) {
  const tbd1 = !match.team1 || match.team1 === "TBD";
  const tbd2 = !match.team2 || match.team2 === "TBD";
  if (tbd1 && tbd2) {
    return `<div class="match-card" id="match-${match.id}" style="opacity:0.5">
      <div class="match-number">Match ${match.matchNum}${match.date ? " · " + match.date : ""}</div>
      <div style="text-align:center;color:var(--text-muted);padding:0.5rem 0 0.25rem;font-size:0.85rem">${match.bracketLabel || "TBD vs TBD"}</div>
    </div>`;
  }

  const result = match.result;
  const kickoffVal = match.kickoff;
  const kickoff = kickoffVal ? (kickoffVal.toDate ? kickoffVal.toDate() : new Date(kickoffVal)) : null;

  const kickoffBadge = kickoff && !result
    ? `<span style="margin-left:6px;font-size:0.65rem;color:var(--text-muted)">${kickoff.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>`
    : "";
  const freebieBadge = match.freebie
    ? `<span style="margin-left:6px;font-size:0.65rem;background:rgba(34,197,94,0.15);color:#22c55e;padding:1px 6px;border-radius:4px;font-weight:600">FREE PICK</span>`
    : "";

  function pickerList(side) {
    if (match.freebie) {
      return `<div class="gpick-name" style="font-style:italic;color:var(--text-muted)">everyone ✓</div>`;
    }
    const pickers = allPlayerPicks[match.id]?.[side] || [];
    if (!pickers.length) return `<div class="gpick-name" style="color:var(--text-dim);font-style:italic">no picks yet</div>`;
    const won = result === side;
    const lost = result && result !== side;
    return pickers.map(p => {
      const pts = result ? calcMatchPoints(round.id, match, p.pick, getPickCounts()) : null;
      const ptsChip = pts !== null
        ? `<span class="gpick-pts ${pts > 0 ? 'gpick-pts-pos' : 'gpick-pts-zero'}">${pts > 0 ? '+' : ''}${pts}</span>`
        : '';
      return `
      <div class="gpick-name ${p.isSelf ? 'gpick-self' : ''} ${won ? 'gpick-correct' : lost ? 'gpick-wrong' : ''}">
        <span>${peerDisplayNames[p.name] || p.name.split(" ")[0]}${p.isSelf ? ' (you)' : ''}</span>${ptsChip}
      </div>`;
    }).join("");
  }

  const t1won = result === "team1";
  const t2won = result === "team2";
  const scoreStr = (result && match.score1 !== undefined && match.score1 !== null)
    ? `<div style="text-align:center;font-size:0.78rem;color:var(--text-muted);margin-top:0.6rem">Final: ${match.score1}–${match.score2}</div>`
    : "";

  return `
  <div class="match-card" id="match-${match.id}">
    <div class="match-number">Match ${match.matchNum}${match.date ? " · " + match.date : ""}${kickoffBadge}${freebieBadge}</div>
    <div class="group-picks-row">
      <div class="group-picks-col ${t1won ? 'gpick-winner' : ''}">
        <div class="group-picks-team-header">
          ${flag(match.team1)}
          <span>${match.team1}</span>
          ${t1won ? '<span class="gpick-win-badge">W</span>' : ''}
        </div>
        <div class="group-picks-list">${pickerList('team1')}</div>
      </div>
      <div class="group-picks-divider">vs</div>
      <div class="group-picks-col ${t2won ? 'gpick-winner' : ''}">
        <div class="group-picks-team-header">
          ${flag(match.team2)}
          <span>${match.team2}</span>
          ${t2won ? '<span class="gpick-win-badge">W</span>' : ''}
        </div>
        <div class="group-picks-list">${pickerList('team2')}</div>
      </div>
    </div>
    ${scoreStr}
  </div>`;
}

function pick(matchId, side) {
  const p = myPicks[matchId] || {};
  if (p.winner === side) {
    myPicks[matchId] = { ...p, winner: null };
    if (!myPicks[matchId].winner) delete myPicks[matchId].winner;
  } else {
    myPicks[matchId] = { ...p, winner: side };
  }
  rerenderCard(matchId);
  updatePickCounter();
  autoSave();
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
    autoSave();
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
  const realMatches = allMatches.filter(m => m.team1 && m.team1 !== "TBD");
  const freebies = realMatches.filter(m => m.freebie);
  const nonFreebies = realMatches.filter(m => !m.freebie);
  const picked = nonFreebies.filter(m => myPicks[m.id]?.winner).length + freebies.length;
  document.getElementById("pickCount").textContent = `${picked}/${realMatches.length} picked`;
}

function autoSave() {
  if (!currentRoundId) return;
  clearTimeout(saveTimer);
  setSaveStatus("saving");
  saveTimer = setTimeout(async () => {
    try {
      const roundDoc = await db.collection("rounds").doc(currentRoundId).get();
      const roundData = roundDoc.exists ? roundDoc.data() : null;
      if (!roundData || roundData.status !== "open") { setSaveStatus(""); return; }
      if (roundData.deadline) {
        const deadline = roundData.deadline.toDate ? roundData.deadline.toDate() : new Date(roundData.deadline);
        if (new Date() > deadline) { setSaveStatus(""); return; }
      }
      await db.collection("predictions").doc(user.userId).set({
        picks: myPicks,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      setSaveStatus("saved");
    } catch (err) {
      console.error("Save failed:", err.code, err.message);
      setSaveStatus("error", err.code || "unknown");
    }
  }, 700);
}

function setSaveStatus(status, detail) {
  const el = document.getElementById("saveStatus");
  if (!el) return;
  clearTimeout(el._t);
  if (status === "saving") {
    el.textContent = "Saving…";
    el.className = "save-indicator saving";
  } else if (status === "saved") {
    el.textContent = "Saved ✓";
    el.className = "save-indicator saved";
    el._t = setTimeout(() => { el.textContent = ""; el.className = "save-indicator"; }, 2500);
  } else if (status === "error") {
    el.textContent = detail ? `Failed to save (${detail})` : "Failed to save";
    el.className = "save-indicator error";
  } else {
    el.textContent = "";
    el.className = "save-indicator";
  }
}

function calcRoundScore(roundId) {
  const pc = getPickCounts();
  return allMatches.reduce((sum, m) => sum + calcMatchPoints(roundId, m, myPicks[m.id], pc), 0);
}

function calcMatchPoints(roundId, match, pick, pickCounts) {
  if (!match.result) return 0;
  if (match.freebie) return ROUND_POINTS[roundId];
  if (!pick?.winner) return 0;
  const correctWin = pick.winner === match.result;
  let pts = correctWin ? ROUND_POINTS[roundId] : 0;
  const base = ROUND_POINTS[roundId];
  if (correctWin && isMaverick(match.id, pick.winner, pickCounts)) pts += base;
  const s1 = parseInt(pick.score1), s2 = parseInt(pick.score2);
  let a1 = parseInt(match.score1), a2 = parseInt(match.score2);
  const isPens = !isNaN(a1) && !isNaN(a2) && a1 === a2 && !!match.result;
  if (isPens) { if (match.result === "team1") a1++; else a2++; }
  let ps1 = s1, ps2 = s2;
  if (isPens && !isNaN(ps1) && !isNaN(ps2) && ps1 === ps2 && pick.winner) {
    if (pick.winner === "team1") ps1++; else ps2++;
  }
  if (!isNaN(ps1) && !isNaN(ps2) && !isNaN(a1) && !isNaN(a2)) {
    if (ps1 === a1 && ps2 === a2) { if (correctWin) pts += 6 * base; }
    else if ((ps1 - ps2) === (a1 - a2)) { if (correctWin) pts += base; }
    else if (correctWin) pts -= base;
  }
  return pts;
}

function getPickCounts() {
  const counts = {};
  Object.entries(allPlayerPicks).forEach(([matchId, sides]) => {
    counts[matchId] = { team1: sides.team1.length, team2: sides.team2.length };
  });
  return counts;
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
