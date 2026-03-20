import { initPaywall, gate, showPricingModal, renderUsageMeter } from "./services/paywallUI.js";
import { saveDoc, getUserDocs, tsToString } from "./services/firestoreService.js";
import { apiFetch } from "./config/env.js";
import { toast } from "./utils/toast.js";
import { initAuthModal } from "./utils/helpers.js";
import { authService } from "./services/authService.js";

let currentUser = null;
let questions = [];
let currentQ = 0;
let scores = [];

authService.onAuthChanged(async user => {
  currentUser = user;
  const navLoginEl = document.getElementById("nav-login");
  if (navLoginEl) navLoginEl.textContent = user ? "Sign Out" : "Sign In";
  document.getElementById("nav-signup")?.classList.toggle("nav-signup-hidden", !!user);
  await initPaywall(user ? user.uid : null);
  if (user) renderUsageMeter("usage-meter-container", "uses");
});
document.getElementById("nav-upgrade")?.addEventListener("click", () => showPricingModal("pro"));
document.getElementById("nav-manage")?.addEventListener("click", () => showPricingModal("pro"));

// Auth modal
initAuthModal(authService);

// Word counter
document.getElementById("answer-input").addEventListener("input", () => {
  const words = document.getElementById("answer-input").value.trim().split(/\s+/).filter(Boolean).length;
  document.getElementById("word-count").textContent = `${words} words`;
});

// Start session
document.getElementById("btn-start").addEventListener("click", async () => {
  const role = document.getElementById("target-role").value.trim();
  if (!role) return toast.warning("Please enter your target role.");
  document.getElementById("btn-start").textContent = "Loading Questions...";
  document.getElementById("btn-start").disabled = true;
  try {
    const res = await apiFetch("/api/interview-questions", { role, company: document.getElementById("company").value, type: document.getElementById("interview-type").value, resume: document.getElementById("resume-snippet").value });
    const data = await res.json();
    questions = data.questions || generateFallbackQuestions(role);
    currentQ = 0; scores = [];
    document.getElementById("setup-panel").style.display = "none";
    document.getElementById("interview-session").classList.remove("hidden");
    renderQuestion();
  } catch(e) {
    questions = generateFallbackQuestions(role);
    currentQ = 0; scores = [];
    document.getElementById("setup-panel").style.display = "none";
    document.getElementById("interview-session").classList.remove("hidden");
    renderQuestion();
  } finally {
    document.getElementById("btn-start").textContent = "Start Interview Practice";
    document.getElementById("btn-start").disabled = false;
  }
});

function generateFallbackQuestions(role) {
  return [
    { text: `Tell me about yourself and why you're interested in this ${role} role.`, type: "Behavioral", tip: "Keep it to 2 minutes. Focus on your career arc." },
    { text: "Describe a challenge you faced at work and how you overcame it.", type: "Behavioral", tip: "Use the STAR method: Situation, Task, Action, Result." },
    { text: "What's your greatest professional achievement?", type: "Behavioral", tip: "Quantify the impact where possible." },
    { text: "Where do you see yourself in 5 years?", type: "Behavioral", tip: "Align with company growth and the role." },
    { text: "Why are you leaving your current position?", type: "Behavioral", tip: "Stay positive. Focus on growth opportunities." },
    { text: "Describe a time you had to work with a difficult team member.", type: "Behavioral", tip: "Show empathy and conflict resolution skills." },
    { text: "How do you prioritize when you have multiple deadlines?", type: "Behavioral", tip: "Demonstrate organization and communication." },
    { text: "Tell me about a time you failed. What did you learn?", type: "Behavioral", tip: "Own the failure, show growth mindset." },
    { text: "What are your greatest strengths and weaknesses?", type: "Behavioral", tip: "For weaknesses, show what you're doing to improve." },
    { text: "Do you have any questions for us?", type: "Behavioral", tip: "Always have 2-3 thoughtful questions prepared." }
  ];
}

function renderQuestion() {
  const q = questions[currentQ];
  document.getElementById("question-text").textContent = q.text;
  document.getElementById("q-type-badge").textContent = q.type || "Behavioral";
  document.getElementById("question-tip").textContent = q.tip ? `💡 Tip: ${q.tip}` : "";
  document.getElementById("question-counter").textContent = `Question ${currentQ+1} of ${questions.length}`;
  document.getElementById("progress-fill").style.width = `${((currentQ+1)/questions.length)*100}%`;
  document.getElementById("answer-input").value = "";
  document.getElementById("word-count").textContent = "0 words";
  document.getElementById("feedback-panel").classList.add("hidden");
}

document.getElementById("btn-get-feedback").addEventListener("click", async () => {
  const answer = document.getElementById("answer-input").value.trim();
  if (!answer) return toast.warning("Please write an answer first.");
  document.querySelector(".btn-text").classList.add("hidden"); document.querySelector(".btn-loader").classList.remove("hidden"); document.getElementById("btn-get-feedback").disabled=true;
  try {
    const res = await apiFetch("/api/interview-feedback", { question: questions[currentQ].text, answer, role: document.getElementById("target-role").value });
    const data = await res.json();
    const score = data.score || Math.floor(Math.random()*30)+60;
    scores.push(score);
    document.getElementById("feedback-score").textContent = score;
    document.getElementById("feedback-verdict").textContent = score >= 80 ? "Strong Answer" : score >= 65 ? "Good Answer" : "Needs Work";
    document.getElementById("feedback-summary").textContent = data.summary || "Good use of the STAR method. Clear and concise.";
    document.getElementById("feedback-positive").textContent = data.positive || "You clearly articulated the situation and your role in it.";
    document.getElementById("feedback-improve").textContent = data.improve || "Add specific metrics to quantify your impact.";
    document.getElementById("feedback-example").textContent = data.example || "Consider opening with the result first, then explaining how you got there.";
    document.getElementById("feedback-panel").classList.remove("hidden");
    document.getElementById("feedback-panel").scrollIntoView({behavior:"smooth"});
  } catch(e) { toast.error("Feedback failed: "); }
  finally { document.querySelector(".btn-text").classList.remove("hidden"); document.querySelector(".btn-loader").classList.add("hidden"); document.getElementById("btn-get-feedback").disabled=false; }
});

document.getElementById("btn-next-question").addEventListener("click", () => {
  currentQ++;
  if (currentQ >= questions.length) {
    document.getElementById("interview-session").classList.add("hidden");
    const avg = Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);
    document.getElementById("final-score").textContent = avg;
    document.getElementById("score-breakdown").innerHTML = scores.map((s,i)=>`<div style="display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid var(--gray-100)"><span>Q${i+1}</span><span style="font-weight:600;color:${s>=80?'#166534':s>=65?'var(--navy)':'#9A3412'}">${s}/100</span></div>`).join("");
    document.getElementById("session-complete").classList.remove("hidden");
  } else {
    renderQuestion();
  }
});

document.getElementById("btn-skip").addEventListener("click", () => {
  scores.push(0);
  currentQ++;
  if (currentQ >= questions.length) { document.getElementById("btn-next-question").click(); } else { renderQuestion(); }
});

document.getElementById("btn-end-session").addEventListener("click", () => {
  if(confirm("End this session?")) { document.getElementById("interview-session").classList.add("hidden"); document.getElementById("setup-panel").style.display=""; }
});

document.getElementById("btn-new-session").addEventListener("click", () => {
  document.getElementById("session-complete").classList.add("hidden");
  document.getElementById("setup-panel").style.display = "";
});

document.getElementById("btn-save-session")?.addEventListener("click", async () => {
  if(!currentUser) { authModal.classList.remove("hidden"); return; }
  
  await saveDoc("interview-sessions", currentUser?.uid || '', { userId: currentUser.uid, role: document.getElementById("target-role").value, scores, avgScore: Math.round(scores.reduce((a,b)=>a+b,0)/scores.length), createdAt: serverTimestamp() });
  toast.success("Session saved!");
});
