(() => {
  "use strict";
  const list = document.getElementById("nova-installations");
  let installations = [];
  try {
    installations = window.RubyConnections.load(localStorage);
  } catch (_) {
    // Le navigateur peut refuser l'accès au carnet.
  }
  if (!installations.length) {
    list.textContent = "Ajoute ton PC Ruby au carnet, puis reviens ici pour ouvrir Nova.";
    return;
  }
  for (const installation of installations) {
    const link = document.createElement("a");
    link.className = "primary-button";
    link.href = new URL("/nova/", installation.origin).href;
    link.rel = "noreferrer";
    link.textContent = "Ouvrir Nova sur " + installation.label;
    list.append(link);
  }
})();
