(() => {
  "use strict";
  const endpointKey = "ruby-ai-local-endpoint";
  const sessionId = `web-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
  const $ = (id) => document.getElementById(id);
  const messages = $("messages");
  const welcome = $("welcome-block");
  const form = $("composer");
  const prompt = $("prompt");
  const typing = $("typing-row");
  const endpoint = () => localStorage.getItem(endpointKey) || "http://127.0.0.1:8787/chat";

  function addMessage(role, text) {
    const item = document.createElement("article");
    item.className = `message ${role}`;
    if (role === "assistant") {
      const avatar = document.createElement("img");
      avatar.className = "message-avatar";
      avatar.alt = "Mascotte Ruby";
      avatar.src = "assets/mascot/RubyMascotIdle.png";
      item.appendChild(avatar);
    }
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = text;
    item.appendChild(bubble);
    messages.appendChild(item);
    $("conversation").scrollTop = $("conversation").scrollHeight;
  }

  function setConnection(connected, label) {
    $("online-dot").classList.toggle("connected", connected);
    $("connection-label").textContent = label;
  }

  async function askRuby(text) {
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ version: 1, request_id: sessionId, conversation_id: sessionId, text, stream: false }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Ruby a répondu HTTP ${response.status}`);
    const payload = await response.json();
    if (typeof payload.text === "string") return payload.text;
    if (typeof payload.answer === "string") return payload.answer;
    if (typeof payload.message === "string") return payload.message;
    if (Array.isArray(payload.events)) {
      const done = payload.events.find((event) => event && event.kind === "done");
      if (done && typeof done.text === "string") return done.text;
    }
    throw new Error("Réponse Ruby non reconnue");
  }

  async function submit(text) {
    const clean = text.trim();
    if (!clean) return;
    welcome.classList.add("hidden");
    addMessage("user", clean);
    prompt.value = "";
    prompt.style.height = "auto";
    typing.classList.remove("hidden");
    try {
      const answer = await askRuby(clean);
      typing.classList.add("hidden");
      setConnection(true, "Connecté à Ruby en local");
      addMessage("assistant", answer);
    } catch (error) {
      typing.classList.add("hidden");
      setConnection(false, "Mode démonstration · Ruby non connectée");
      addMessage("assistant", "Je suis prête à te répondre. Pour me relier à Ruby sur cet ordinateur, configure le pont local dans ⚙ Connexion locale. Cette page ne contacte aucun service distant.");
      console.info("Ruby local bridge unavailable", error);
    }
  }

  form.addEventListener("submit", (event) => { event.preventDefault(); void submit(prompt.value); });
  prompt.addEventListener("input", () => { prompt.style.height = "auto"; prompt.style.height = `${Math.min(prompt.scrollHeight, 130)}px`; });
  prompt.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(prompt.value); } });
  document.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => { void submit(button.dataset.prompt || ""); }));
  $("new-chat").addEventListener("click", () => { messages.replaceChildren(); welcome.classList.remove("hidden"); prompt.focus(); });
  $("clear-chat").addEventListener("click", () => { messages.replaceChildren(); welcome.classList.remove("hidden"); });
  document.querySelectorAll("[data-toast]").forEach((button) => button.addEventListener("click", () => { addMessage("assistant", button.dataset.toast || ""); }));
  $("attach-button").addEventListener("click", () => { addMessage("assistant", "Les pièces jointes ne sont pas encore activées dans cette version. Le noyau local reste limité aux outils explicitement autorisés."); });
  document.querySelectorAll(".recent-chat").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".recent-chat").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
  }));
  const dialog = $("settings-dialog");
  const openSettings = () => { $("api-endpoint").value = endpoint(); dialog.showModal(); };
  $("settings-button").addEventListener("click", openSettings);
  $("open-settings").addEventListener("click", openSettings);
  $("settings-form").addEventListener("submit", (event) => {
    if (event.submitter && event.submitter.id === "save-settings") {
      const value = $("api-endpoint").value.trim();
      if (!/^https?:\/\/127\.0\.0\.1(?::\d+)?\//.test(value)) {
        event.preventDefault(); $("dialog-status").textContent = "Pour la sécurité, seule une adresse HTTP locale 127.0.0.1 est acceptée."; return;
      }
      localStorage.setItem(endpointKey, value); $("dialog-status").textContent = "Adresse enregistrée. Envoie un message pour tester Ruby."; setConnection(false, "Pont local configuré");
    }
  });
  $("privacy-note").addEventListener("click", () => { addMessage("assistant", "La page ne transmet pas tes messages à un service distant. Le pont accepté est limité à 127.0.0.1 ; Ruby garde les politiques d’autorisation et les outils fermés."); });
  setConnection(false, localStorage.getItem(endpointKey) ? "Pont local configuré" : "Mode démonstration");
})();
