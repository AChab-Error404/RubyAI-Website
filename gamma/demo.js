/* Données publiques de démonstration. Aucune requête réseau ni accès aux fichiers locaux. */
(function () {
  "use strict";

  const filename = "calc.py";
  const add = "    return price + quantity";
  const multiply = "    return price * quantity";
  const definition = "def total(price, quantity):";
  const comment = "    # Calcule le prix total de la commande.";
  const lines = [definition, comment, add];
  const content = lines.join("\n");
  const diff = [
    "--- a/calc.py", "+++ b/calc.py", "@@ -1,3 +1,3 @@",
    " " + definition, " " + comment, "-" + add, "+" + multiply
  ].join("\n");
  const project = { attached: true, name: "Calculatrice", writable: false };
  const emptyProject = { attached: false };
  const tasks = new Map();
  let attached = false;
  let nextTask = 1;

  function status() {
    return {
      status: "OK",
      online: true,
      project: attached ? project : emptyProject,
      tasks: attached ? [...tasks.values()] : []
    };
  }

  function request(path, body) {
    if (path.startsWith("/api/status")) return status();
    if (path === "/api/project") {
      switch (body.action) {
        case "attach":
        case "detach":
          attached = body.action === "attach";
          return status();
        case "tree":
          if (attached) return { status: "OK", tree: { entries: [{ path: filename, kind: "file", size: new TextEncoder().encode(content).length }] } };
          break;
        case "read":
          if (attached && body.path === filename) {
            return { status: "OK", file: { path: filename, content, startLine: 1, endLine: lines.length,
              totalLines: lines.length, encoding: "UTF-8", lineEnding: "LF" } };
          }
          break;
        case "search":
          if (attached) {
            const query = String(body.query || "").toLowerCase();
            const results = lines.flatMap((snippet, index) => snippet.toLowerCase().includes(query)
              ? [{ path: filename, line: index + 1, snippet }] : []);
            return { status: "OK", search: { results } };
          }
          break;
      }
    }
    if (path === "/api/coding" && attached && body.action === "start") {
      const taskId = "demo-" + nextTask++;
      const session = {
        taskId,
        phase: "AWAITING_APPROVAL",
        diagnosis: "Exemple simulé. Le total d’une commande se calcule en multipliant le prix unitaire par la quantité.",
        proposal: { proposalId: taskId + "-diff", path: filename, diff, addedLines: 1, removedLines: 1, awaitingApproval: true }
      };
      tasks.set(taskId, session);
      if (tasks.size > 20) tasks.delete(tasks.keys().next().value);
      return { status: "OK", session };
    }
    if (path === "/api/coding" && attached && body.action === "reject") {
      const task = tasks.get(body.task_id);
      if (task && task.proposal.awaitingApproval && task.proposal.proposalId === body.proposal_id) {
        task.phase = "REJECTED_BY_USER";
        task.proposal.awaitingApproval = false;
        return { status: "OK", session: task };
      }
    }
    return { status: "ERROR", message: "Cette action est réservée à Gamma sur ton ordinateur." };
  }

  function reply(message) {
    if (/calc\.py|calculatrice|total/i.test(message)) {
      return "Dans `calc.py`, la fonction `total` reçoit un prix unitaire et une quantité.\n\n"
        + "Le fichier d’exemple additionne les deux valeurs. Pour calculer le total correctement, "
        + "il faut les multiplier. Passe en mode **Patch** pour examiner le diff d’exemple.";
    }
    return "Cette démo utilise des réponses prédéfinies. Demande **Explique calc.py** "
      + "ou essaie le mode **Patch** pour voir le diff de la calculatrice.";
  }

  window.GammaDemo = Object.freeze({ request, reply });
})();
