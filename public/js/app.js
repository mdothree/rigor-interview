import { initPaywall, showPricingModal, renderUsageMeter } from "./services/paywallUI.js";
import { saveDoc } from "./services/firestoreService.js";
import { apiFetch } from "./config/env.js";
import { toast } from "./utils/toast.js";
import { validators, guardSubmit } from "./utils/validate.js";
import {
  initAuthModal, wireAuthNav, openAuthModal, escapeHtml,
  showToolError, clearToolError
} from "./utils/helpers.js";
import { authService } from "./services/authService.js";

// Answer length cap (client-side). The feedback API forwards the full answer to
// the model, so keep requests bounded. Resume highlights are cut to 500 chars by
// api/interview/questions.js, so the input enforces the same limit.
const ANSWER_MAX = 4000;

let currentUser = null;
let questions = [];
let currentQ = 0;
// One entry per question: a number (0-100) once scored, "skipped", or undefined.
let results = [];

const $id = id => document.getElementById(id);

authService.onAuthChanged(async user => {
  currentUser = user;
  const navLoginEl = $id("nav-login");
  if (navLoginEl) navLoginEl.textContent = user ? "Sign Out" : "Sign In";
  $id("nav-signup")?.classList.toggle("nav-signup-hidden", !!user);
  try {
    await initPaywall(user ? user.uid : null);
    if (user) renderUsageMeter("usage-meter-container", "analyses")?.catch?.(() => {});
  } catch (e) {
    console.warn("[paywall] init failed:", e?.message);
  }
});
$id("nav-upgrade")?.addEventListener("click", (e) => { e.preventDefault(); showPricingModal("pro"); });
$id("nav-manage")?.addEventListener("click", () => showPricingModal("pro"));

// Auth modal + nav "Sign In" / "Get Started" (previously never wired on this page)
initAuthModal(authService);
wireAuthNav(authService, () => currentUser);

// Word / character counter
const answerInput = $id("answer-input");
answerInput.setAttribute("maxlength", String(ANSWER_MAX));
function updateWordCount() {
  const v = answerInput.value;
  const words = v.trim().split(/\s+/).filter(Boolean).length;
  const near = v.length > ANSWER_MAX * 0.9;
  $id("word-count").textContent = near
    ? `${words} words · ${v.length.toLocaleString()} / ${ANSWER_MAX.toLocaleString()} characters`
    : `${words} words`;
}
answerInput.addEventListener("input", updateWordCount);

// ─── Start session ────────────────────────────────────────────────────────────
function setStartBusy(busy) {
  const btn = $id("btn-start");
  btn.textContent = busy ? "Loading Questions..." : "Start Interview Practice";
  btn.disabled = busy;
}

async function startSession() {
  const role = $id("target-role").value.trim();
  if (!guardSubmit([{ id: "target-role", rules: [validators.required, validators.minLength(2)], label: "Target role" }], toast)) return;

  // The question and feedback APIs require a signed-in user (requireAuth).
  if (!currentUser) {
    toast.info("Sign in or create a free account to start a practice session.");
    openAuthModal("login");
    return;
  }

  clearToolError();
  setStartBusy(true);
  try {
    const data = await apiFetch("/api/interview-questions", {
      role,
      company: $id("company").value.trim(),
      type: $id("interview-type").value,
      resume: $id("resume-snippet").value.trim()
    });
    const qs = Array.isArray(data?.questions)
      ? data.questions.filter(q => q && typeof q.text === "string" && q.text.trim())
      : [];
    // No silent generic fallback: if the AI didn't return questions, say so.
    if (!qs.length) throw new Error("The server didn't return any interview questions. Please try again.");
    questions = qs;
    currentQ = 0;
    results = [];
    $id("setup-panel").style.display = "none";
    $id("session-complete").classList.add("hidden");
    $id("interview-session").classList.remove("hidden");
    renderQuestion();
  } catch (e) {
    showToolError(e, startSession);
  } finally {
    setStartBusy(false);
  }
}
$id("btn-start").addEventListener("click", startSession);

function renderQuestion() {
  const q = questions[currentQ];
  $id("question-text").textContent = q.text;
  $id("q-type-badge").textContent = q.type || "Question";
  $id("question-tip").textContent = q.tip ? `💡 Tip: ${q.tip}` : "";
  $id("question-counter").textContent = `Question ${currentQ + 1} of ${questions.length}`;
  $id("progress-fill").style.width = `${((currentQ + 1) / questions.length) * 100}%`;
  answerInput.value = "";
  updateWordCount();
  $id("feedback-panel").classList.add("hidden");
}

function scrollToQuestion() {
  $id("question-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ─── Feedback ─────────────────────────────────────────────────────────────────
function setFeedbackBusy(busy) {
  const btn = $id("btn-get-feedback");
  btn.querySelector(".btn-text").classList.toggle("hidden", busy);
  btn.querySelector(".btn-loader").classList.toggle("hidden", !busy);
  btn.disabled = busy;
  $id("btn-skip").disabled = busy;
}

async function getFeedback() {
  const answer = answerInput.value.trim();
  if (!guardSubmit([{ id: "answer-input", rules: [validators.required, validators.minWords(5)], label: "Your answer" }], toast)) return;
  setFeedbackBusy(true);
  try {
    const data = await apiFetch("/api/interview-feedback", {
      question: questions[currentQ].text,
      answer: answer.slice(0, ANSWER_MAX),
      role: $id("target-role").value.trim()
    });
    const raw = Number(data?.score);
    // No random/canned fallback: a result without a score is an error.
    if (!Number.isFinite(raw)) throw new Error("The feedback service returned an incomplete result (no score). Please try again.");
    const score = Math.max(0, Math.min(100, Math.round(raw)));
    results[currentQ] = score;
    $id("feedback-score").textContent = score;
    $id("feedback-verdict").textContent = score >= 80 ? "Strong Answer" : score >= 65 ? "Good Answer" : "Needs Work";
    $id("feedback-summary").textContent = data.summary || "";
    $id("feedback-positive").textContent = data.positive || "—";
    $id("feedback-improve").textContent = data.improve || "—";
    $id("feedback-example").textContent = data.example || "—";
    $id("feedback-panel").classList.remove("hidden");
    $id("feedback-panel").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    toast.error(`Feedback failed: ${e?.status === 401 ? "please sign in again." : (e?.message || "unknown error")}`);
  } finally {
    setFeedbackBusy(false);
  }
}
$id("btn-get-feedback").addEventListener("click", getFeedback);

// ─── Navigation between questions ─────────────────────────────────────────────
function scoredResults() {
  return results.filter(r => typeof r === "number");
}

function averageScore() {
  const s = scoredResults();
  return s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : null;
}

function finishSession() {
  $id("interview-session").classList.add("hidden");
  const avg = averageScore();
  $id("final-score").textContent = avg === null ? "–" : avg;
  const skipped = results.filter(r => r === "skipped").length;
  $id("final-score-note").textContent = avg === null
    ? "No answers were scored in this session."
    : `Average across ${scoredResults().length} scored answer${scoredResults().length === 1 ? "" : "s"}${skipped ? ` (${skipped} skipped, not counted)` : ""}`;
  $id("score-breakdown").innerHTML = questions.map((q, i) => {
    const r = results[i];
    const label = typeof r === "number" ? `${r}/100` : r === "skipped" ? "Skipped" : "Not answered";
    const cls = typeof r === "number" ? (r >= 80 ? "bd-strong" : r >= 65 ? "bd-good" : "bd-weak") : "bd-none";
    return `<div class="breakdown-row"><span>Q${i + 1}</span><span class="breakdown-val ${cls}">${escapeHtml(label)}</span></div>`;
  }).join("");
  $id("session-complete").classList.remove("hidden");
  $id("session-complete").scrollIntoView({ behavior: "smooth", block: "start" });
}

function nextQuestion() {
  currentQ++;
  if (currentQ >= questions.length) {
    finishSession();
  } else {
    renderQuestion();
    scrollToQuestion();
  }
}
$id("btn-next-question").addEventListener("click", nextQuestion);

$id("btn-skip").addEventListener("click", () => {
  if (typeof results[currentQ] !== "number") results[currentQ] = "skipped";
  nextQuestion();
});

$id("btn-end-session").addEventListener("click", () => {
  if (!confirm("End this session? You'll see a summary of the questions answered so far.")) return;
  finishSession();
});

$id("btn-new-session").addEventListener("click", () => {
  $id("session-complete").classList.add("hidden");
  $id("setup-panel").style.display = "";
  $id("setup-panel").scrollIntoView({ behavior: "smooth", block: "start" });
});

$id("btn-save-session")?.addEventListener("click", async () => {
  if (!currentUser) { openAuthModal("login"); return; }
  try {
    await saveDoc("interview-sessions", currentUser.uid, {
      role: $id("target-role").value.trim(),
      type: $id("interview-type").value,
      questions: questions.map(q => q.text),
      scores: questions.map((_, i) => (typeof results[i] === "number" ? results[i] : null)),
      skipped: results.filter(r => r === "skipped").length,
      avgScore: averageScore()
    });
    toast.success("Session saved!");
  } catch (e) {
    toast.error(`Couldn't save: ${e?.message || "unknown error"}`);
  }
});

// ─── Service worker (moved from an inline <script> so a strict CSP doesn't block it) ──
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
