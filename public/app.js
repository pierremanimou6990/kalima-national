const REGIONS = ["Basse Guinée", "Moyenne Guinée", "Haute Guinée", "Guinée Forestière"];
const app = document.getElementById("app");

// ============ ÉTAT & STOCKAGE ============
function getSession() {
  const raw = localStorage.getItem("kalima_session");
  return raw ? JSON.parse(raw) : null;
}
function setSession(session) { localStorage.setItem("kalima_session", JSON.stringify(session)); }
function clearSession() { localStorage.removeItem("kalima_session"); }

// ============ HELPERS DOM ============
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstChild;
}
function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}
function escapeHtmlMultiline(str) {
  return escapeHtml(str).replace(/\n/g, "<br>");
}
function initials(nom) {
  return (nom || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
function avatarHtml(url, nom) {
  if (url) return `<img class="avatar" src="${url}" alt="" />`;
  return `<div class="avatar avatar-placeholder">${escapeHtml(initials(nom))}</div>`;
}
function formatMontant(n) {
  return Number(n || 0).toLocaleString("fr-FR") + " GNF";
}
function formatDateFr(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}
function formatDateShort(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
function joursRestants(iso) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(iso + "T00:00:00");
  return Math.round((target - today) / 86400000);
}

// ============ APPEL API ============
async function api(path, opts = {}) {
  const session = getSession();
  const headers = { "Content-Type": "application/json" };
  if (session && session.token) headers.Authorization = `Bearer ${session.token}`;
  const res = await fetch(path, { headers, ...opts });
  if (res.status === 401) {
    clearSession();
    renderHome();
    throw new Error("Session expirée, reconnectez-vous");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Erreur serveur");
  }
  return res.json();
}
async function apiUpload(path, formData) {
  const session = getSession();
  const headers = {};
  if (session && session.token) headers.Authorization = `Bearer ${session.token}`;
  const res = await fetch(path, { method: "POST", headers, body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Erreur d'envoi");
  }
  return res.json();
}

// ============ STRUCTURE COMMUNE ============
function topBar(title, onBack, showUser) {
  const session = getSession();
  const bar = el(`
    <div class="topbar">
      <button class="back" aria-label="Retour">←</button>
      <span class="title">${escapeHtml(title)}</span>
      ${showUser && session ? `<span class="user-chip">${escapeHtml(session.user.nom)}</span>` : ""}
    </div>
  `);
  bar.querySelector(".back").onclick = onBack;
  return bar;
}
function logoRow() {
  return el(`
    <div class="logo-row">
      <img class="logo-badge" src="/logo.png" alt="Mission Kalima" />
      <div>
        <div class="logo-title">Mission Kalima</div>
        <div class="logo-sub">Jeunesse Nationale — Guinée</div>
      </div>
    </div>
  `);
}

// ============ ÉCRAN D'ACCUEIL (PUBLIC) ============
async function renderHome() {
  app.innerHTML = "";
  app.appendChild(logoRow());
  const wrap = el(`<div class="container"></div>`);

  const loginBtn = el(`<button class="btn btn-primary btn-block" style="margin-bottom:24px;">🔐 Se connecter</button>`);
  loginBtn.onclick = renderLogin;
  wrap.appendChild(loginBtn);

  wrap.appendChild(el(`<div id="communiques-slot"></div>`));
  wrap.appendChild(el(`<div id="progression-slot"></div>`));
  wrap.appendChild(el(`<div id="camps-slot"></div>`));
  wrap.appendChild(el(`<div id="comite-slot"></div>`));
  app.appendChild(wrap);

  try {
    const { communiques } = await api("/api/communiques");
    const slot = wrap.querySelector("#communiques-slot");
    if (communiques.length) {
      slot.appendChild(el(`<h2 class="section-h">📢 Communiqués</h2>`));
      communiques.slice(0, 5).forEach((c) => slot.appendChild(communiquePoster(c)));
    }
  } catch (e) { /* silencieux */ }

  try {
    const { regions } = await api("/api/regions/progression-publique");
    const slot = wrap.querySelector("#progression-slot");
    if (regions.some((r) => r.montantCible > 0)) {
      slot.appendChild(el(`<h2 class="section-h">🎯 Progression des cotisations</h2>`));
      regions.forEach((r) => {
        const pct = r.montantCible > 0 ? Math.min(100, Math.round((r.totalVerse / r.montantCible) * 100)) : 0;
        slot.appendChild(el(`
          <div class="region-card">
            <div class="name">${escapeHtml(r.region)}</div>
            <div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div>
            <div class="progress-label"><span>${pct}%</span><span>${formatMontant(r.totalVerse)} sur ${formatMontant(r.montantCible)}</span></div>
          </div>
        `));
      });
    }
  } catch (e) { /* silencieux */ }

  try {
    const { camps } = await api("/api/camps");
    const upcoming = camps.filter((c) => joursRestants(c.date_debut) >= 0);
    const slot = wrap.querySelector("#camps-slot");
    if (upcoming.length) {
      slot.appendChild(el(`<h2 class="section-h">⛺ Prochains camps</h2>`));
      upcoming.forEach((c) => slot.appendChild(campPosterHome(c)));
    }
  } catch (e) { /* silencieux */ }

  try {
    const { membres } = await api("/api/comite");
    const slot = wrap.querySelector("#comite-slot");
    if (membres.length) {
      slot.appendChild(el(`<h2 class="section-h">🤝 Comité national des jeunes</h2>`));
      slot.appendChild(comiteBar(membres));
    }
  } catch (e) { /* silencieux */ }
}

function communiquePoster(c) {
  return el(`
    <div class="poster-communique">
      <div class="poster-comm-head">
        <span class="poster-comm-tag">Communiqué</span>
        <span class="poster-comm-date">${formatDateFr(c.created_at.slice(0, 10))}</span>
      </div>
      <div class="poster-comm-body">
        <div class="poster-comm-titre">${escapeHtml(c.titre)}</div>
        <div class="poster-comm-contenu">${escapeHtmlMultiline(c.contenu)}</div>
      </div>
    </div>
  `);
}

function campPosterHome(camp) {
  const jours = joursRestants(camp.date_debut);
  const poster = el(`
    <div class="poster-camp">
      <div class="poster-top">
        <div class="poster-countdown">${jours === 0 ? "🎉 C'est aujourd'hui" : `J-<span class="n">${jours}</span>`}</div>
        <div class="poster-titre">${escapeHtml(camp.titre)}</div>
        ${camp.theme ? `<div class="poster-theme">« ${escapeHtml(camp.theme)} »</div>` : ""}
        ${camp.reference ? `<div class="poster-reference">${escapeHtml(camp.reference)}</div>` : ""}
        <div class="poster-meta">
          <span>📅 ${formatDateFr(camp.date_debut)}${camp.date_fin ? " au " + formatDateFr(camp.date_fin) : ""}</span>
          ${camp.lieu ? `<span>📍 ${escapeHtml(camp.lieu)}</span>` : ""}
        </div>
      </div>
      <div class="poster-actions"><button class="btn btn-gold btn-sm voir-btn">Voir le détail</button></div>
      ${camp.orateurs && camp.orateurs.length ? `
        <div class="poster-orateurs-bar">
          ${camp.orateurs.map((o) => `
            <div class="orateur-item">
              ${avatarHtml(o.photo_url, o.nom)}
              <span class="nom">${escapeHtml(o.nom)}</span>
            </div>
          `).join("")}
        </div>` : ""}
    </div>
  `);
  poster.querySelector(".voir-btn").onclick = () => renderCampDetail(camp);
  return poster;
}

function comiteBar(membres) {
  const idxPresident = membres.findIndex((m) => (m.fonction || "").toLowerCase().includes("président"));
  const president = idxPresident >= 0 ? membres[idxPresident] : membres[0];
  const autres = membres.filter((m) => m.id !== president.id);

  const bar = el(`
    <div class="comite-bar">
      <div class="president-item">
        ${avatarHtml(president.photo_url, president.nom)}
        <div>
          <div class="nom">${escapeHtml(president.nom)}</div>
          <div class="fonction">${escapeHtml(president.fonction || "Président")}</div>
        </div>
      </div>
      <div class="others-row"></div>
    </div>
  `);
  const row = bar.querySelector(".others-row");
  autres.forEach((m) => {
    row.appendChild(el(`
      <div class="other-item">
        ${avatarHtml(m.photo_url, m.nom)}
        <span class="nom">${escapeHtml(m.nom)}</span>
      </div>
    `));
  });
  return bar;
}

function campCardPublic(camp) {
  const jours = joursRestants(camp.date_debut);
  const card = el(`
    <div class="camp-card">
      <div class="body">
        <div class="countdown">${jours === 0 ? "🎉 C'est aujourd'hui" : `J-<span class="n">${jours}</span>`}</div>
        <div class="titre">${escapeHtml(camp.titre)}</div>
        ${camp.theme ? `<div class="camp-theme">« ${escapeHtml(camp.theme)} »</div>` : ""}
        <div class="when">📅 ${formatDateFr(camp.date_debut)}${camp.date_fin ? " au " + formatDateFr(camp.date_fin) : ""}</div>
        ${camp.lieu ? `<div class="where">📍 ${escapeHtml(camp.lieu)}</div>` : ""}
        ${camp.orateurs && camp.orateurs.length ? `<div class="orateurs-row">${camp.orateurs.map((o) => `<div class="orateur-chip">${avatarHtml(o.photo_url, o.nom)}<span class="nom">${escapeHtml(o.nom)}</span></div>`).join("")}</div>` : ""}
        <button class="btn btn-ghost btn-sm voir-btn">Voir le détail</button>
      </div>
    </div>
  `);
  card.querySelector(".voir-btn").onclick = () => renderCampDetail(camp);
  return card;
}

async function renderCampDetail(camp) {
  app.innerHTML = "";
  app.appendChild(topBar(camp.titre, renderHome));
  const wrap = el(`<div class="container"></div>`);
  const jours = joursRestants(camp.date_debut);

  wrap.appendChild(el(`<div class="countdown">${jours <= 0 ? "🎉 En cours ou passé" : `J-<span class="n">${jours}</span>`}</div>`));
  if (camp.theme) wrap.appendChild(el(`<p class="camp-theme" style="font-size:16px; margin-bottom:8px;">« ${escapeHtml(camp.theme)} »</p>`));
  if (camp.reference) wrap.appendChild(el(`<p class="hint-text" style="margin-top:-8px;">${escapeHtml(camp.reference)}</p>`));
  wrap.appendChild(el(`<p class="hint-text">📅 ${formatDateFr(camp.date_debut)}${camp.date_fin ? " au " + formatDateFr(camp.date_fin) : ""}${camp.lieu ? " · 📍 " + escapeHtml(camp.lieu) : ""}</p>`));
  if (camp.description) wrap.appendChild(el(`<p class="lead">${escapeHtmlMultiline(camp.description)}</p>`));

  if (camp.orateurs && camp.orateurs.length) {
    wrap.appendChild(el(`<h2 class="section-h">Orateurs</h2>`));
    const row = el(`<div class="orateurs-row"></div>`);
    camp.orateurs.forEach((o) => row.appendChild(el(`<div class="orateur-chip">${avatarHtml(o.photo_url, o.nom)}<span class="nom">${escapeHtml(o.nom)}</span></div>`)));
    wrap.appendChild(row);
  }

  if (camp.planning_columns && camp.planning_columns.length) {
    wrap.appendChild(el(`<h2 class="section-h">Planning</h2>`));
    wrap.appendChild(renderPlanningTable(camp.planning_columns, camp.planning_rows, false));
  }

  wrap.appendChild(el(`<h2 class="section-h">Je veux participer</h2>`));
  const fNom = el(`<label class="field"><span class="label-text">Nom complet</span><input placeholder="Votre nom" /></label>`);
  const fTel = el(`<label class="field"><span class="label-text">Téléphone</span><input placeholder="Votre numéro" /></label>`);
  const fEglise = el(`<label class="field"><span class="label-text">Église</span><input placeholder="Nom de votre église" /></label>`);
  const fRegion = el(`<label class="field"><span class="label-text">Région</span><select></select></label>`);
  REGIONS.forEach((r) => fRegion.querySelector("select").appendChild(el(`<option value="${r}">${r}</option>`)));
  wrap.appendChild(fNom); wrap.appendChild(fTel); wrap.appendChild(fEglise); wrap.appendChild(fRegion);

  const confirmBox = el(`<p class="saved-flag" style="display:none;">✓ Inscription enregistrée, merci !</p>`);
  const btn = el(`<button class="btn btn-gold btn-block">M'inscrire</button>`);
  btn.onclick = async () => {
    const nom = fNom.querySelector("input").value.trim();
    if (!nom) return;
    btn.disabled = true;
    try {
      await api(`/api/camps/${camp.id}/inscriptions`, {
        method: "POST",
        body: JSON.stringify({
          nom,
          telephone: fTel.querySelector("input").value.trim(),
          eglise: fEglise.querySelector("input").value.trim(),
          region: fRegion.querySelector("select").value,
        }),
      });
      confirmBox.style.display = "block";
      btn.style.display = "none";
    } catch (e) {
      btn.disabled = false;
      alert(e.message);
    }
  };
  wrap.appendChild(btn);
  wrap.appendChild(confirmBox);

  app.appendChild(wrap);
}

function renderPlanningTable(columns, rows, editable, onChange) {
  const wrap = el(`<div class="planning-scroll"></div>`);
  const table = el(`<table class="planning"></table>`);
  const thead = el(`<thead><tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`);
  table.appendChild(thead);
  const tbody = el(`<tbody></tbody>`);
  (rows || []).forEach((row, ri) => {
    const tr = el(`<tr></tr>`);
    columns.forEach((_, ci) => {
      const td = el(`<td></td>`);
      if (editable) {
        const input = el(`<input value="${escapeHtml(row[ci] || "")}" />`);
        input.oninput = () => { rows[ri][ci] = input.value; if (onChange) onChange(); };
        td.appendChild(input);
      } else {
        td.textContent = row[ci] || "";
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

// ============ CONNEXION ============
function renderLogin() {
  app.innerHTML = "";
  app.appendChild(topBar("Connexion", renderHome));
  const wrap = el(`<div class="container"></div>`);
  wrap.appendChild(el(`<p class="lead">Connectez-vous avec le compte fourni par votre responsable.</p>`));

  const fEmail = el(`<label class="field"><span class="label-text">Email</span><input type="email" /></label>`);
  const fPass = el(`<label class="field"><span class="label-text">Mot de passe</span><input type="password" /></label>`);
  wrap.appendChild(fEmail); wrap.appendChild(fPass);

  const errorBox = el(`<p class="error-text" style="display:none;"></p>`);
  wrap.appendChild(errorBox);

  const btn = el(`<button class="btn btn-primary btn-block">Se connecter</button>`);
  btn.onclick = submit;
  fPass.querySelector("input").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  wrap.appendChild(btn);
  app.appendChild(wrap);

  async function submit() {
    const email = fEmail.querySelector("input").value.trim();
    const password = fPass.querySelector("input").value;
    if (!email || !password) return;
    btn.disabled = true;
    try {
      const { token, user } = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      setSession({ token, user });
      routeAfterLogin(user);
    } catch (e) {
      errorBox.textContent = e.message;
      errorBox.style.display = "block";
      btn.disabled = false;
    }
  }
}

function routeAfterLogin(user) {
  if (user.role === "national") renderNationalMenu();
  else if (user.role === "regional") renderRegionalMenu();
  else if (user.role === "eglise") {
    if (!user.eglise) renderEgliseSetup();
    else renderEgliseRoster();
  }
}

function logoutButton() {
  const btn = el(`<button class="btn btn-ghost btn-sm">Se déconnecter</button>`);
  btn.onclick = () => { clearSession(); renderHome(); };
  return btn;
}

function accountButton(onBackFn) {
  const btn = el(`<button class="btn btn-ghost btn-sm">⚙️ Mon compte</button>`);
  btn.onclick = () => renderMonCompte(onBackFn);
  return btn;
}

function renderMonCompte(onBack) {
  const session = getSession();
  app.innerHTML = "";
  app.appendChild(topBar("Mon compte", onBack));
  const wrap = el(`<div class="container"></div>`);
  wrap.appendChild(el(`<p class="hint-text">Connecté en tant que <b>${escapeHtml(session.user.nom)}</b>${session.user.region ? " · " + escapeHtml(session.user.region) : ""}${session.user.eglise ? " · " + escapeHtml(session.user.eglise) : ""}</p>`));

  // --- Changer l'email ---
  const cardEmail = el(`<div class="card"><div class="card-head"><span class="label">Changer mon email</span></div></div>`);
  const fEmailActuel = el(`<label class="field"><span class="label-text">Email actuel</span><input value="${escapeHtml(session.user.email)}" disabled /></label>`);
  const fEmailNouveau = el(`<label class="field"><span class="label-text">Nouvel email</span><input type="email" placeholder="nouveau@mail.com" /></label>`);
  const fEmailPass = el(`<label class="field"><span class="label-text">Mot de passe actuel (pour confirmer)</span><input type="password" /></label>`);
  cardEmail.appendChild(fEmailActuel); cardEmail.appendChild(fEmailNouveau); cardEmail.appendChild(fEmailPass);
  const emailMsg = el(`<p class="error-text" style="display:none;"></p>`);
  cardEmail.appendChild(emailMsg);
  const emailBtn = el(`<button class="btn btn-gold">Mettre à jour l'email</button>`);
  emailBtn.onclick = async () => {
    const nouveau_email = fEmailNouveau.querySelector("input").value.trim();
    const mot_de_passe = fEmailPass.querySelector("input").value;
    if (!nouveau_email || !mot_de_passe) return;
    emailBtn.disabled = true;
    emailMsg.style.display = "none";
    try {
      const { token, user } = await api("/api/auth/change-email", { method: "POST", body: JSON.stringify({ nouveau_email, mot_de_passe }) });
      setSession({ token, user });
      emailMsg.style.color = "var(--success)";
      emailMsg.textContent = "✓ Email mis à jour avec succès.";
      emailMsg.style.display = "block";
      fEmailActuel.querySelector("input").value = user.email;
      fEmailNouveau.querySelector("input").value = "";
      fEmailPass.querySelector("input").value = "";
    } catch (e) {
      emailMsg.style.color = "var(--danger)";
      emailMsg.textContent = e.message;
      emailMsg.style.display = "block";
    }
    emailBtn.disabled = false;
  };
  cardEmail.appendChild(emailBtn);
  wrap.appendChild(cardEmail);

  // --- Changer le mot de passe ---
  const cardPass = el(`<div class="card"><div class="card-head"><span class="label">Changer mon mot de passe</span></div></div>`);
  const fAncien = el(`<label class="field"><span class="label-text">Mot de passe actuel</span><input type="password" /></label>`);
  const fNouveau = el(`<label class="field"><span class="label-text">Nouveau mot de passe</span><input type="password" placeholder="au moins 6 caractères" /></label>`);
  cardPass.appendChild(fAncien); cardPass.appendChild(fNouveau);
  const passMsg = el(`<p class="error-text" style="display:none;"></p>`);
  cardPass.appendChild(passMsg);
  const passBtn = el(`<button class="btn btn-gold">Mettre à jour le mot de passe</button>`);
  passBtn.onclick = async () => {
    const ancien = fAncien.querySelector("input").value;
    const nouveau = fNouveau.querySelector("input").value;
    if (!ancien || !nouveau) return;
    passBtn.disabled = true;
    passMsg.style.display = "none";
    try {
      await api("/api/auth/change-password", { method: "POST", body: JSON.stringify({ ancien, nouveau }) });
      passMsg.style.color = "var(--success)";
      passMsg.textContent = "✓ Mot de passe mis à jour avec succès.";
      passMsg.style.display = "block";
      fAncien.querySelector("input").value = "";
      fNouveau.querySelector("input").value = "";
    } catch (e) {
      passMsg.style.color = "var(--danger)";
      passMsg.textContent = e.message;
      passMsg.style.display = "block";
    }
    passBtn.disabled = false;
  };
  cardPass.appendChild(passBtn);
  wrap.appendChild(cardPass);

  app.appendChild(wrap);
}

// ============ ESPACE RESPONSABLE D'ÉGLISE ============
function renderEgliseSetup() {
  const session = getSession();
  app.innerHTML = "";
  app.appendChild(topBar("Créer mon église", () => { clearSession(); renderHome(); }));
  const wrap = el(`<div class="container"></div>`);
  wrap.appendChild(el(`<p class="lead">Bienvenue ${escapeHtml(session.user.nom)}. Indiquez le nom de votre église pour commencer (région : ${escapeHtml(session.user.region)}).</p>`));

  const field = el(`<label class="field"><span class="label-text">Nom de l'église</span><input placeholder="ex. Église Kalima Labé" /></label>`);
  wrap.appendChild(field);
  const btn = el(`<button class="btn btn-gold btn-block">Continuer</button>`);
  btn.onclick = async () => {
    const nom = field.querySelector("input").value.trim();
    if (!nom) return;
    btn.disabled = true;
    try {
      const data = await api("/api/mon-eglise", { method: "POST", body: JSON.stringify({ nom }) });
      const s = getSession();
      s.user.eglise = data.eglise;
      s.token = data.token;
      setSession(s);
      renderEgliseRoster();
    } catch (e) {
      btn.disabled = false;
      alert(e.message);
    }
  };
  wrap.appendChild(btn);
  app.appendChild(wrap);
}

async function renderEgliseRoster() {
  const session = getSession();
  app.innerHTML = "";
  const bar = topBar(session.user.eglise, () => { clearSession(); renderHome(); });
  bar.appendChild(accountButton(renderEgliseRoster));
  bar.appendChild(logoutButton());
  app.appendChild(bar);
  const wrap = el(`<div class="container"><p class="empty">Chargement…</p></div>`);
  app.appendChild(wrap);

  const { jeunes } = await api("/api/jeunes/mon-eglise");
  let editingId = null;

  function draw() {
    wrap.innerHTML = "";

    const card = el(`
      <div class="card">
        <div class="card-head">
          <span class="label">${editingId ? "Modifier un jeune" : "Ajouter un jeune"}</span>
        </div>
      </div>
    `);
    const editing = jeunes.find((j) => j.id === editingId);
    const fNom = el(`<label class="field"><span class="label-text">Nom complet</span><input placeholder="Nom et prénom" /></label>`);
    const fTel = el(`<label class="field"><span class="label-text">Téléphone</span><input placeholder="ex. 622 00 00 00" /></label>`);
    const fMail = el(`<label class="field"><span class="label-text">Email (facultatif)</span><input type="email" placeholder="exemple@mail.com" /></label>`);
    const fFonc = el(`<label class="field"><span class="label-text">Fonction à l'église</span><input placeholder="ex. Choriste, Trésorier..." /></label>`);
    fNom.querySelector("input").value = editing ? editing.nom : "";
    fTel.querySelector("input").value = editing ? editing.telephone || "" : "";
    fMail.querySelector("input").value = editing ? editing.email || "" : "";
    fFonc.querySelector("input").value = editing ? editing.fonction || "" : "";
    card.appendChild(fNom); card.appendChild(fTel); card.appendChild(fMail); card.appendChild(fFonc);

    const fPhoto = el(`<label class="field"><span class="label-text">Photo (facultatif)</span><input type="file" accept="image/*" capture="environment" /></label>`);
    const photoInput = fPhoto.querySelector("input");
    const preview = el(`<div style="margin:-8px 0 14px;"></div>`);
    if (editing && editing.photo_url) preview.appendChild(el(`<img src="${editing.photo_url}" class="avatar avatar-lg" alt="" />`));
    photoInput.addEventListener("change", () => {
      preview.innerHTML = "";
      const file = photoInput.files[0];
      if (file) preview.appendChild(el(`<img src="${URL.createObjectURL(file)}" class="avatar avatar-lg" alt="" />`));
    });
    card.appendChild(fPhoto); card.appendChild(preview);

    const btnRow = el(`<div style="display:flex; gap:8px;"></div>`);
    const saveBtn = el(`<button class="btn btn-gold">${editingId ? "Enregistrer" : "＋ Ajouter"}</button>`);
    btnRow.appendChild(saveBtn);
    if (editingId) {
      const cancelBtn = el(`<button class="btn btn-ghost">Annuler</button>`);
      cancelBtn.onclick = () => { editingId = null; draw(); };
      btnRow.appendChild(cancelBtn);
    }
    card.appendChild(btnRow);
    wrap.appendChild(card);

    saveBtn.onclick = async () => {
      const nom = fNom.querySelector("input").value.trim();
      const telephone = fTel.querySelector("input").value.trim();
      const email = fMail.querySelector("input").value.trim();
      const fonction = fFonc.querySelector("input").value.trim();
      const photoFile = photoInput.files[0];
      if (!nom) return;
      saveBtn.disabled = true;
      try {
        let jeune;
        if (editingId) {
          jeune = await api(`/api/jeunes/${editingId}`, { method: "PUT", body: JSON.stringify({ nom, telephone, email, fonction }) });
        } else {
          jeune = await api(`/api/jeunes`, { method: "POST", body: JSON.stringify({ nom, telephone, email, fonction }) });
        }
        if (photoFile) {
          const fd = new FormData();
          fd.append("photo", photoFile);
          jeune = await apiUpload(`/api/jeunes/${jeune.id}/photo`, fd);
        }
        if (editingId) {
          const idx = jeunes.findIndex((j) => j.id === editingId);
          jeunes[idx] = jeune;
          editingId = null;
        } else {
          jeunes.push(jeune);
        }
        draw();
      } catch (e) {
        saveBtn.disabled = false;
        alert(e.message);
      }
    };

    wrap.appendChild(el(`<div class="list-head"><span class="label">Jeunes enregistrés</span><span class="count">${jeunes.length}</span></div>`));

    if (jeunes.length === 0) {
      wrap.appendChild(el(`<p class="empty">Aucun jeune saisi pour le moment.</p>`));
    } else {
      jeunes.forEach((j) => {
        const row = el(`
          <div class="row-item">
            <div class="info">
              ${avatarHtml(j.photo_url, j.nom)}
              <div>
                <div class="nom">${escapeHtml(j.nom)}</div>
                <div class="meta">${escapeHtml(j.telephone || "—")} · ${escapeHtml(j.fonction || "—")}</div>
              </div>
            </div>
            <div class="actions">
              <button aria-label="Modifier">✎</button>
              <button aria-label="Supprimer">🗑</button>
            </div>
          </div>
        `);
        const [editBtn, delBtn] = row.querySelectorAll("button");
        editBtn.onclick = () => { editingId = j.id; draw(); };
        delBtn.onclick = async () => {
          await api(`/api/jeunes/${j.id}`, { method: "DELETE" });
          const idx = jeunes.findIndex((x) => x.id === j.id);
          jeunes.splice(idx, 1);
          draw();
        };
        wrap.appendChild(row);
      });
    }
  }
  draw();
}

// ============ ESPACE RÉGIONAL ============
function renderRegionalMenu() {
  const session = getSession();
  app.innerHTML = "";
  const bar = topBar(`Région ${session.user.region}`, () => { clearSession(); renderHome(); });
  bar.appendChild(accountButton(renderRegionalMenu));
  bar.appendChild(logoutButton());
  app.appendChild(bar);
  const wrap = el(`<div class="container"></div>`);

  const grid = el(`<div class="menu-grid"></div>`);
  const items = [
    { icon: "📊", label: "Tableau de bord", fn: renderRegionalDashboard },
    { icon: "👤", label: "Responsables d'église", fn: renderRegionalComptes },
    { icon: "💰", label: "Cotisations", fn: renderRegionalCotisations },
    { icon: "🖨️", label: "Imprimer la liste", fn: renderRegionalImprimer },
    { icon: "⛺", label: "Camps", fn: renderRegionalCamps },
  ];
  items.forEach((it) => {
    const tile = el(`<button class="menu-tile"><div class="icon">${it.icon}</div><span class="label">${it.label}</span></button>`);
    tile.onclick = it.fn;
    grid.appendChild(tile);
  });
  wrap.appendChild(grid);
  app.appendChild(wrap);
}

async function renderRegionalDashboard() {
  app.innerHTML = "";
  app.appendChild(topBar("Tableau de bord", renderRegionalMenu));
  const wrap = el(`<div class="container"><p class="empty">Chargement…</p></div>`);
  app.appendChild(wrap);

  const [{ jeunes }, progression] = await Promise.all([
    api("/api/jeunes/region"),
    api("/api/region/progression"),
  ]);
  const eglises = new Set(jeunes.map((j) => j.eglise));
  const pct = progression.montantCible > 0 ? Math.min(100, Math.round((progression.totalVerse / progression.montantCible) * 100)) : 0;

  wrap.innerHTML = "";
  wrap.appendChild(el(`
    <div class="stats-grid">
      <div class="stat-box" style="background:var(--ink);"><div class="num">${eglises.size}</div><div class="cap">Église${eglises.size > 1 ? "s" : ""}</div></div>
      <div class="stat-box" style="background:var(--gold);"><div class="num">${jeunes.length}</div><div class="cap">Jeunes</div></div>
    </div>
  `));
  wrap.appendChild(el(`
    <div class="region-card">
      <div class="name">Cotisation régionale</div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div>
      <div class="progress-label"><span>${formatMontant(progression.totalVerse)} reçus par le national</span><span>${pct}% de ${formatMontant(progression.montantCible)}</span></div>
    </div>
  `));

  wrap.appendChild(el(`<div class="list-head"><span class="label">Jeunes par église</span></div>`));
  const parEglise = {};
  jeunes.forEach((j) => { (parEglise[j.eglise] = parEglise[j.eglise] || []).push(j); });
  Object.entries(parEglise).forEach(([nomEglise, liste]) => {
    wrap.appendChild(el(`
      <div class="row-item">
        <div class="info"><div><div class="nom">${escapeHtml(nomEglise)}</div><div class="meta">${liste.length} jeune${liste.length > 1 ? "s" : ""}</div></div></div>
      </div>
    `));
  });
}

async function renderRegionalComptes() {
  app.innerHTML = "";
  app.appendChild(topBar("Responsables d'église", renderRegionalMenu));
  const wrap = el(`<div class="container"><p class="empty">Chargement…</p></div>`);
  app.appendChild(wrap);

  const { comptes } = await api("/api/comptes/eglises");

  function draw() {
    wrap.innerHTML = "";
    const card = el(`<div class="card"><div class="card-head"><span class="label">Créer un compte</span></div></div>`);
    const fNom = el(`<label class="field"><span class="label-text">Nom du responsable</span><input placeholder="Nom et prénom" /></label>`);
    const fEmail = el(`<label class="field"><span class="label-text">Email (identifiant de connexion)</span><input type="email" placeholder="exemple@mail.com" /></label>`);
    const fPass = el(`<label class="field"><span class="label-text">Mot de passe initial</span><input type="text" placeholder="au moins 6 caractères" /></label>`);
    card.appendChild(fNom); card.appendChild(fEmail); card.appendChild(fPass);
    const btn = el(`<button class="btn btn-gold">＋ Créer le compte</button>`);
    card.appendChild(btn);
    wrap.appendChild(card);

    btn.onclick = async () => {
      const nom = fNom.querySelector("input").value.trim();
      const email = fEmail.querySelector("input").value.trim();
      const password = fPass.querySelector("input").value;
      if (!nom || !email || !password) return;
      btn.disabled = true;
      try {
        const compte = await api("/api/comptes/eglises", { method: "POST", body: JSON.stringify({ nom, email, password }) });
        comptes.push(compte);
        draw();
      } catch (e) {
        btn.disabled = false;
        alert(e.message);
      }
    };

    wrap.appendChild(el(`<div class="list-head"><span class="label">Comptes créés</span><span class="count">${comptes.length}</span></div>`));
    if (comptes.length === 0) {
      wrap.appendChild(el(`<p class="empty">Aucun responsable enregistré pour le moment.</p>`));
    } else {
      comptes.forEach((c) => {
        const row = el(`
          <div class="row-item">
            <div class="info"><div>
              <div class="nom">${escapeHtml(c.nom)}</div>
              <div class="meta">${escapeHtml(c.email)}${c.eglise ? " · " + escapeHtml(c.eglise) : " · église pas encore créée"}</div>
            </div></div>
            <div class="actions"><button aria-label="Supprimer">🗑</button></div>
          </div>
        `);
        row.querySelector("button").onclick = async () => {
          if (!confirm(`Supprimer le compte de ${c.nom} ?`)) return;
          await api(`/api/comptes/eglises/${c.id}`, { method: "DELETE" });
          const idx = comptes.findIndex((x) => x.id === c.id);
          comptes.splice(idx, 1);
          draw();
        };
        wrap.appendChild(row);
      });
    }
  }
  draw();
}

async function renderRegionalCotisations() {
  const session = getSession();
  app.innerHTML = "";
  app.appendChild(topBar("Cotisations", renderRegionalMenu));
  const wrap = el(`<div class="container"><p class="empty">Chargement…</p></div>`);
  app.appendChild(wrap);

  const [progression, { versements }] = await Promise.all([
    api("/api/region/progression"),
    api(`/api/regions/${encodeURIComponent(session.user.region)}/versements`),
  ]);
  const pct = progression.montantCible > 0 ? Math.min(100, Math.round((progression.totalVerse / progression.montantCible) * 100)) : 0;

  wrap.innerHTML = "";
  wrap.appendChild(el(`
    <div class="region-card">
      <div class="name">${escapeHtml(session.user.region)}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div>
      <div class="progress-label"><span>${formatMontant(progression.totalVerse)} reçus par le national</span><span>${pct}% de ${formatMontant(progression.montantCible)}</span></div>
    </div>
  `));
  wrap.appendChild(el(`<p class="hint-text">C'est le président national qui note ici les montants reçus physiquement de votre région. Vous suivez la progression, mais ne notez pas les versements vous-même.</p>`));

  wrap.appendChild(el(`<div class="list-head"><span class="label">Historique des versements reçus</span></div>`));
  if (versements.length === 0) {
    wrap.appendChild(el(`<p class="empty">Aucun versement noté par le national pour l'instant.</p>`));
  } else {
    versements.forEach((v) => {
      wrap.appendChild(el(`
        <div class="row-item">
          <div class="info"><div>
            <div class="nom">${formatMontant(v.montant)}</div>
            <div class="meta">${formatDateFr(v.date_versement)}${v.note ? " · " + escapeHtml(v.note) : ""}</div>
          </div></div>
        </div>
      `));
    });
  }
}

async function renderRegionalImprimer() {
  app.innerHTML = "";
  const bar = topBar("Imprimer", renderRegionalMenu);
  app.appendChild(bar);
  const wrap = el(`<div class="container"><p class="empty">Chargement…</p></div>`);
  app.appendChild(wrap);

  const { jeunes } = await api("/api/jeunes/region");
  const session = getSession();

  wrap.innerHTML = "";
  const printBtn = el(`<button class="btn btn-primary no-print" style="margin-bottom:16px;">🖨️ Imprimer cette liste</button>`);
  printBtn.onclick = () => window.print();
  wrap.appendChild(printBtn);

  wrap.appendChild(el(`<h1 class="hero serif">Liste des jeunes — ${escapeHtml(session.user.region)}</h1>`));
  wrap.appendChild(el(`<p class="hint-text">${jeunes.length} jeune${jeunes.length > 1 ? "s" : ""} · Édité le ${formatDateFr(new Date().toISOString().slice(0, 10))}</p>`));

  const parEglise = {};
  jeunes.forEach((j) => { (parEglise[j.eglise] = parEglise[j.eglise] || []).push(j); });
  Object.entries(parEglise).forEach(([nomEglise, liste]) => {
    wrap.appendChild(el(`<h2 class="section-h">${escapeHtml(nomEglise)} (${liste.length})</h2>`));
    liste.forEach((j) => {
      wrap.appendChild(el(`
        <div class="row-item"><div class="info"><div><div class="nom">${escapeHtml(j.nom)}</div><div class="meta">${escapeHtml(j.telephone || "—")} · ${escapeHtml(j.fonction || "—")}</div></div></div></div>
      `));
    });
  });
}

async function renderRegionalCamps() {
  app.innerHTML = "";
  app.appendChild(topBar("Camps", renderRegionalMenu));
  const wrap = el(`<div class="container"><p class="empty">Chargement…</p></div>`);
  app.appendChild(wrap);
  const { camps } = await api("/api/camps");
  wrap.innerHTML = "";
  if (camps.length === 0) {
    wrap.appendChild(el(`<p class="empty">Aucun camp programmé pour le moment.</p>`));
  } else {
    camps.forEach((c) => wrap.appendChild(campCardPublic(c)));
  }
}

// ============ ESPACE NATIONAL ============
function renderNationalMenu() {
  app.innerHTML = "";
  const bar = topBar("Espace national", () => { clearSession(); renderHome(); });
  bar.appendChild(accountButton(renderNationalMenu));
  bar.appendChild(logoutButton());
  app.appendChild(bar);
  const wrap = el(`<div class="container"></div>`);

  const grid = el(`<div class="menu-grid"></div>`);
  const items = [
    { icon: "🌍", label: "Tableau de bord", fn: renderNationalDashboard },
    { icon: "👤", label: "Présidents régionaux", fn: renderNationalComptesRegionaux },
    { icon: "⛺", label: "Camps", fn: renderNationalCamps },
    { icon: "📢", label: "Communiqués", fn: renderNationalCommuniques },
    { icon: "📇", label: "Annuaire national", fn: renderNationalAnnuaire },
    { icon: "🤝", label: "Comité national", fn: renderNationalComite },
  ];
  items.forEach((it) => {
    const tile = el(`<button class="menu-tile"><div class="icon">${it.icon}</div><span class="label">${it.label}</span></button>`);
    tile.onclick = it.fn;
    grid.appendChild(tile);
  });
  wrap.appendChild(grid);
  app.appendChild(wrap);
}

async function renderNationalDashboard() {
  app.innerHTML = "";
  app.appendChild(topBar("Tableau de bord national", renderNationalMenu));
  const wrap = el(`<div class="container wide"><p class="empty">Chargement…</p></div>`);
  app.appendChild(wrap);

  const { regions } = await api("/api/regions/resume");
  const totalEglises = regions.reduce((s, r) => s + r.nbEglises, 0);
  const totalJeunes = regions.reduce((s, r) => s + r.nbJeunes, 0);

  wrap.innerHTML = "";
  wrap.appendChild(el(`
    <div class="stats-grid">
      <div class="stat-box" style="background:var(--ink);"><div class="num">${totalEglises}</div><div class="cap">Églises au total</div></div>
      <div class="stat-box" style="background:var(--gold);"><div class="num">${totalJeunes}</div><div class="cap">Jeunes au total</div></div>
    </div>
  `));

  wrap.appendChild(el(`<h2 class="section-h">Détail par région</h2>`));
  regions.forEach((r) => {
    const pct = r.montantCible > 0 ? Math.min(100, Math.round((r.totalVerse / r.montantCible) * 100)) : 0;
    const card = el(`
      <div class="region-card">
        <div class="name">${escapeHtml(r.region)}</div>
        <div class="region-stats">
          <div class="stat"><b>${r.nbEglises}</b>église${r.nbEglises > 1 ? "s" : ""}</div>
          <div class="stat"><b>${r.nbJeunes}</b>jeune${r.nbJeunes > 1 ? "s" : ""}</div>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div>
        <div class="progress-label"><span>${formatMontant(r.totalVerse)} reçus</span><span>${pct}% de <span class="objectif-txt">${formatMontant(r.montantCible)}</span></span></div>
        <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm objectif-btn">Modifier l'objectif</button>
          <button class="btn btn-gold btn-sm versement-btn">＋ Noter un versement</button>
          <button class="btn btn-ghost btn-sm historique-btn">Historique</button>
        </div>
      </div>
    `);
    card.querySelector(".objectif-btn").onclick = async () => {
      const nouveau = prompt(`Nouvel objectif pour ${r.region} (en GNF) :`, r.montantCible);
      if (nouveau === null) return;
      try {
        await api(`/api/regions/${encodeURIComponent(r.region)}/objectif`, { method: "PUT", body: JSON.stringify({ montant_cible: nouveau }) });
        renderNationalDashboard();
      } catch (e) { alert(e.message); }
    };
    card.querySelector(".versement-btn").onclick = () => renderNoterVersement(r.region, () => renderNationalDashboard());
    card.querySelector(".historique-btn").onclick = () => renderHistoriqueVersements(r.region);
    wrap.appendChild(card);
  });
}

function renderNoterVersement(region, onDone) {
  app.innerHTML = "";
  app.appendChild(topBar(`Versement — ${region}`, renderNationalDashboard));
  const wrap = el(`<div class="container"></div>`);
  wrap.appendChild(el(`<p class="hint-text">Notez ici le montant que vous avez reçu physiquement de cette région.</p>`));

  const fMontant = el(`<label class="field"><span class="label-text">Montant reçu (GNF)</span><input type="number" placeholder="ex. 500000" /></label>`);
  const fDate = el(`<label class="field"><span class="label-text">Date du versement</span><input type="date" value="${new Date().toISOString().slice(0, 10)}" /></label>`);
  const fNote = el(`<label class="field"><span class="label-text">Note (facultatif)</span><input placeholder="ex. Remis en main propre par le président régional" /></label>`);
  wrap.appendChild(fMontant); wrap.appendChild(fDate); wrap.appendChild(fNote);

  const btn = el(`<button class="btn btn-gold btn-block">Enregistrer le versement</button>`);
  btn.onclick = async () => {
    const montant = fMontant.querySelector("input").value;
    const date_versement = fDate.querySelector("input").value;
    const note = fNote.querySelector("input").value.trim();
    if (!montant || Number(montant) <= 0) return;
    btn.disabled = true;
    try {
      await api(`/api/regions/${encodeURIComponent(region)}/versements`, { method: "POST", body: JSON.stringify({ montant, date_versement, note }) });
      onDone();
    } catch (e) {
      btn.disabled = false;
      alert(e.message);
    }
  };
  wrap.appendChild(btn);
  app.appendChild(wrap);
}

async function renderHistoriqueVersements(region) {
  app.innerHTML = "";
  app.appendChild(topBar(`Historique — ${region}`, renderNationalDashboard));
  const wrap = el(`<div class="container"><p class="empty">Chargement…</p></div>`);
  app.appendChild(wrap);
  const { versements } = await api(`/api/regions/${encodeURIComponent(region)}/versements`);
  wrap.innerHTML = "";
  if (versements.length === 0) {
    wrap.appendChild(el(`<p class="empty">Aucun versement noté pour cette région.</p>`));
  } else {
    versements.forEach((v) => {
      wrap.appendChild(el(`
        <div class="row-item">
          <div class="info"><div>
            <div class="nom">${formatMontant(v.montant)}</div>
            <div class="meta">${formatDateFr(v.date_versement)}${v.note ? " · " + escapeHtml(v.note) : ""}</div>
          </div></div>
        </div>
      `));
    });
  }
}

async function renderNationalComptesRegionaux() {
  app.innerHTML = "";
  app.appendChild(topBar("Présidents régionaux", renderNationalMenu));
  const wrap = el(`<div class="container"><p class="empty">Chargement…</p></div>`);
  app.appendChild(wrap);

  const { comptes } = await api("/api/comptes/regionaux");

  function draw() {
    wrap.innerHTML = "";
    wrap.appendChild(el(`<p class="hint-text">Un compte par région. Créer un compte pour une région qui en a déjà un le remplace (utile pour réinitialiser un mot de passe oublié).</p>`));

    REGIONS.forEach((region) => {
      const existant = comptes.find((c) => c.region === region);
      const card = el(`<div class="card"><div class="card-head"><span class="label">${escapeHtml(region)}</span></div></div>`);
      if (existant) {
        card.appendChild(el(`<p class="hint-text" style="margin-bottom:14px;">Compte actuel : <b>${escapeHtml(existant.nom)}</b> — ${escapeHtml(existant.email)}</p>`));
      }
      const fNom = el(`<label class="field"><span class="label-text">Nom du président régional</span><input placeholder="Nom et prénom" value="${existant ? escapeHtml(existant.nom) : ""}" /></label>`);
      const fEmail = el(`<label class="field"><span class="label-text">Email</span><input type="email" placeholder="exemple@mail.com" value="${existant ? escapeHtml(existant.email) : ""}" /></label>`);
      const fPass = el(`<label class="field"><span class="label-text">${existant ? "Nouveau mot de passe" : "Mot de passe initial"}</span><input type="text" placeholder="au moins 6 caractères" /></label>`);
      card.appendChild(fNom); card.appendChild(fEmail); card.appendChild(fPass);
      const btn = el(`<button class="btn btn-gold">${existant ? "Mettre à jour" : "＋ Créer le compte"}</button>`);
      card.appendChild(btn);
      btn.onclick = async () => {
        const nom = fNom.querySelector("input").value.trim();
        const email = fEmail.querySelector("input").value.trim();
        const password = fPass.querySelector("input").value;
        if (!nom || !email || !password) return;
        btn.disabled = true;
        try {
          const compte = await api("/api/comptes/regionaux", { method: "POST", body: JSON.stringify({ region, nom, email, password }) });
          const idx = comptes.findIndex((c) => c.region === region);
          if (idx >= 0) comptes[idx] = compte; else comptes.push(compte);
          draw();
        } catch (e) {
          btn.disabled = false;
          alert(e.message);
        }
      };
      wrap.appendChild(card);
    });
  }
  draw();
}

async function renderNationalCamps() {
  app.innerHTML = "";
  app.appendChild(topBar("Camps", renderNationalMenu));
  const wrap = el(`<div class="container"><p class="empty">Chargement…</p></div>`);
  app.appendChild(wrap);
  const { camps } = await api("/api/camps");

  function draw() {
    wrap.innerHTML = "";
    const newBtn = el(`<button class="btn btn-gold btn-block" style="margin-bottom:20px;">＋ Programmer un nouveau camp</button>`);
    newBtn.onclick = () => renderCampEditor(null, () => renderNationalCamps());
    wrap.appendChild(newBtn);

    if (camps.length === 0) {
      wrap.appendChild(el(`<p class="empty">Aucun camp programmé.</p>`));
    } else {
      camps.forEach((c) => {
        const card = campCardPublic(c);
        const editBtn = el(`<button class="btn btn-ghost btn-sm" style="margin-left:8px;">Gérer</button>`);
        editBtn.onclick = () => renderCampEditor(c, () => renderNationalCamps());
        card.querySelector(".body").appendChild(editBtn);
        wrap.appendChild(card);
      });
    }
  }
  draw();
}

async function renderCampEditor(camp, onBack) {
  const isNew = !camp;
  app.innerHTML = "";
  app.appendChild(topBar(isNew ? "Nouveau camp" : camp.titre, onBack));
  const wrap = el(`<div class="container"></div>`);

  const card = el(`<div class="card"><div class="card-head"><span class="label">Informations générales</span></div></div>`);
  const fTitre = el(`<label class="field"><span class="label-text">Titre du camp</span><input placeholder="ex. Camp Biblique National 2026" /></label>`);
  const fTheme = el(`<label class="field"><span class="label-text">Thème (facultatif)</span><input placeholder="ex. Debout pour la mission" /></label>`);
  const fReference = el(`<label class="field"><span class="label-text">Référence biblique (facultatif)</span><input placeholder="ex. Josué 1:9" /></label>`);
  const fDebut = el(`<label class="field"><span class="label-text">Date de début</span><input type="date" /></label>`);
  const fFin = el(`<label class="field"><span class="label-text">Date de fin (facultatif)</span><input type="date" /></label>`);
  const fLieu = el(`<label class="field"><span class="label-text">Lieu</span><input placeholder="ex. Kalima Pounthioun" /></label>`);
  const fDesc = el(`<label class="field"><span class="label-text">Description (facultatif)</span><textarea rows="5"></textarea></label>`);
  const descTextarea = fDesc.querySelector("textarea");
  const descToolbar = el(`<div style="display:flex; gap:8px; margin:-10px 0 14px;"></div>`);
  const bulletBtn = el(`<button type="button" class="btn btn-ghost btn-sm">• Ajouter une puce</button>`);
  bulletBtn.onclick = () => {
    const pos = descTextarea.selectionStart || descTextarea.value.length;
    const before = descTextarea.value.slice(0, pos);
    const after = descTextarea.value.slice(pos);
    const prefix = before.length && !before.endsWith("\n") ? "\n• " : "• ";
    descTextarea.value = before + prefix + after;
    descTextarea.focus();
  };
  descToolbar.appendChild(bulletBtn);
  descToolbar.appendChild(el(`<span class="field-hint" style="align-self:center;">Les emojis 🙂 du clavier du téléphone fonctionnent aussi directement.</span>`));
  if (camp) {
    fTitre.querySelector("input").value = camp.titre;
    fTheme.querySelector("input").value = camp.theme || "";
    fReference.querySelector("input").value = camp.reference || "";
    fDebut.querySelector("input").value = camp.date_debut;
    fFin.querySelector("input").value = camp.date_fin || "";
    fLieu.querySelector("input").value = camp.lieu || "";
    descTextarea.value = camp.description || "";
  }
  card.appendChild(fTitre); card.appendChild(fTheme); card.appendChild(fReference); card.appendChild(fDebut); card.appendChild(fFin); card.appendChild(fLieu);
  card.appendChild(fDesc); card.appendChild(descToolbar);
  const saveBtn = el(`<button class="btn btn-gold">${isNew ? "Créer le camp" : "Enregistrer"}</button>`);
  card.appendChild(saveBtn);
  wrap.appendChild(card);

  saveBtn.onclick = async () => {
    const body = {
      titre: fTitre.querySelector("input").value.trim(),
      theme: fTheme.querySelector("input").value.trim(),
      reference: fReference.querySelector("input").value.trim(),
      date_debut: fDebut.querySelector("input").value,
      date_fin: fFin.querySelector("input").value || null,
      lieu: fLieu.querySelector("input").value.trim(),
      description: descTextarea.value.trim(),
    };
    if (!body.titre || !body.date_debut) return alert("Titre et date de début requis");
    saveBtn.disabled = true;
    try {
      if (isNew) {
        const created = await api("/api/camps", { method: "POST", body: JSON.stringify(body) });
        renderCampEditor(created, onBack);
      } else {
        const updated = await api(`/api/camps/${camp.id}`, { method: "PUT", body: JSON.stringify(body) });
        Object.assign(camp, updated);
        saveBtn.disabled = false;
      }
    } catch (e) {
      saveBtn.disabled = false;
      alert(e.message);
    }
  };

  if (!isNew) {
    // Orateurs
    wrap.appendChild(el(`<h2 class="section-h">Orateurs</h2>`));
    const orateursWrap = el(`<div></div>`);
    wrap.appendChild(orateursWrap);
    function drawOrateurs() {
      orateursWrap.innerHTML = "";
      (camp.orateurs || []).forEach((o) => {
        const row = el(`
          <div class="row-item">
            <div class="info">${avatarHtml(o.photo_url, o.nom)}<div class="nom">${escapeHtml(o.nom)}</div></div>
            <div class="actions">
              <label class="btn btn-ghost btn-sm" style="cursor:pointer;">📷<input type="file" accept="image/*" style="display:none;" /></label>
              <button aria-label="Supprimer">🗑</button>
            </div>
          </div>
        `);
        const fileInput = row.querySelector("input[type=file]");
        fileInput.onchange = async () => {
          const file = fileInput.files[0];
          if (!file) return;
          const fd = new FormData();
          fd.append("photo", file);
          const updated = await apiUpload(`/api/orateurs/${o.id}/photo`, fd);
          Object.assign(o, updated);
          drawOrateurs();
        };
        row.querySelector("button[aria-label=Supprimer]").onclick = async () => {
          await api(`/api/orateurs/${o.id}`, { method: "DELETE" });
          camp.orateurs = camp.orateurs.filter((x) => x.id !== o.id);
          drawOrateurs();
        };
        orateursWrap.appendChild(row);
      });
      const addRow = el(`<div style="display:flex; gap:8px; margin-top:8px;"></div>`);
      const addInput = el(`<input placeholder="Nom de l'orateur" style="flex:1; border:1px solid var(--line); border-radius:8px; padding:11px 13px; font-size:15px;" />`);
      const addBtn = el(`<button class="btn btn-gold btn-sm">＋</button>`);
      addBtn.onclick = async () => {
        const nom = addInput.value.trim();
        if (!nom) return;
        const o = await api(`/api/camps/${camp.id}/orateurs`, { method: "POST", body: JSON.stringify({ nom }) });
        camp.orateurs = camp.orateurs || [];
        camp.orateurs.push(o);
        addInput.value = "";
        drawOrateurs();
      };
      addRow.appendChild(addInput); addRow.appendChild(addBtn);
      orateursWrap.appendChild(addRow);
    }
    drawOrateurs();

    // Planning
    wrap.appendChild(el(`<h2 class="section-h">Planning du camp</h2>`));
    wrap.appendChild(el(`<p class="hint-text">Créez un tableau libre : ajoutez les colonnes qu'il vous faut (horaire, activité, intervenant...) puis remplissez les lignes.</p>`));
    let columns = camp.planning_columns && camp.planning_columns.length ? [...camp.planning_columns] : ["Horaire", "Activité", "Intervenant"];
    let rows = camp.planning_rows ? camp.planning_rows.map((r) => [...r]) : [];
    const planningWrap = el(`<div></div>`);
    wrap.appendChild(planningWrap);
    let saveTimeout = null;
    function scheduleSave() {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(async () => {
        await api(`/api/camps/${camp.id}/planning`, { method: "PUT", body: JSON.stringify({ planning_columns: columns, planning_rows: rows }) });
        camp.planning_columns = columns; camp.planning_rows = rows;
      }, 600);
    }
    function drawPlanning() {
      planningWrap.innerHTML = "";
      planningWrap.appendChild(renderPlanningTable(columns, rows, true, scheduleSave));
      const toolbar = el(`<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;"></div>`);
      const addColBtn = el(`<button class="btn btn-ghost btn-sm">＋ Colonne</button>`);
      addColBtn.onclick = () => {
        const nom = prompt("Nom de la nouvelle colonne :");
        if (!nom) return;
        columns.push(nom);
        rows.forEach((r) => r.push(""));
        drawPlanning(); scheduleSave();
      };
      const addRowBtn = el(`<button class="btn btn-ghost btn-sm">＋ Ligne</button>`);
      addRowBtn.onclick = () => { rows.push(columns.map(() => "")); drawPlanning(); scheduleSave(); };
      const delColBtn = el(`<button class="btn btn-danger-outline btn-sm">🗑 Dernière colonne</button>`);
      delColBtn.onclick = () => {
        if (columns.length <= 1) return;
        columns.pop();
        rows.forEach((r) => r.pop());
        drawPlanning(); scheduleSave();
      };
      const delRowBtn = el(`<button class="btn btn-danger-outline btn-sm">🗑 Dernière ligne</button>`);
      delRowBtn.onclick = () => { rows.pop(); drawPlanning(); scheduleSave(); };
      toolbar.appendChild(addColBtn); toolbar.appendChild(addRowBtn); toolbar.appendChild(delColBtn); toolbar.appendChild(delRowBtn);
      planningWrap.appendChild(toolbar);
    }
    drawPlanning();

    // Inscriptions
    wrap.appendChild(el(`<h2 class="section-h">Inscriptions reçues</h2>`));
    const inscBtn = el(`<button class="btn btn-ghost">📥 Voir / télécharger la liste des inscrits</button>`);
    inscBtn.onclick = () => renderInscriptionsCamp(camp);
    wrap.appendChild(inscBtn);

    wrap.appendChild(el(`<h2 class="section-h">Danger</h2>`));
    const delCampBtn = el(`<button class="btn btn-danger-outline">🗑 Supprimer ce camp</button>`);
    delCampBtn.onclick = async () => {
      if (!confirm(`Supprimer définitivement "${camp.titre}" ?`)) return;
      await api(`/api/camps/${camp.id}`, { method: "DELETE" });
      onBack();
    };
    wrap.appendChild(delCampBtn);
  }

  app.appendChild(wrap);
}

async function renderInscriptionsCamp(camp) {
  app.innerHTML = "";
  app.appendChild(topBar(`Inscrits — ${camp.titre}`, () => renderCampEditor(camp, () => renderNationalCamps())));
  const wrap = el(`<div class="container"><p class="empty">Chargement…</p></div>`);
  app.appendChild(wrap);

  const { inscriptions } = await api(`/api/camps/${camp.id}/inscriptions`);
  wrap.innerHTML = "";
  wrap.appendChild(el(`<p class="hint-text">${inscriptions.length} inscrit${inscriptions.length > 1 ? "s" : ""}</p>`));

  const btnRow = el(`<div style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;"></div>`);

  const pdfBtn = el(`<button class="btn btn-gold">📄 Télécharger en PDF</button>`);
  pdfBtn.onclick = async () => {
    pdfBtn.disabled = true;
    try {
      const session = getSession();
      const res = await fetch(`/api/camps/${camp.id}/inscriptions/pdf`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!res.ok) throw new Error("Erreur lors de la génération du PDF");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `inscrits-${camp.titre.replace(/\s+/g, "_")}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e.message);
    }
    pdfBtn.disabled = false;
  };
  btnRow.appendChild(pdfBtn);

  const dlBtn = el(`<button class="btn btn-ghost">⬇ Télécharger (CSV)</button>`);
  dlBtn.onclick = () => {
    const header = "Nom,Téléphone,Église,Région\n";
    const lines = inscriptions.map((i) => [i.nom, i.telephone, i.eglise, i.region].map((v) => `"${(v || "").replace(/"/g, '""')}"`).join(","));
    const csv = header + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `inscrits-${camp.titre.replace(/\s+/g, "_")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  btnRow.appendChild(dlBtn);
  wrap.appendChild(btnRow);

  if (inscriptions.length === 0) {
    wrap.appendChild(el(`<p class="empty">Aucune inscription reçue pour ce camp.</p>`));
  } else {
    inscriptions.forEach((i) => {
      wrap.appendChild(el(`
        <div class="row-item"><div class="info"><div><div class="nom">${escapeHtml(i.nom)}</div><div class="meta">${escapeHtml(i.telephone || "—")} · ${escapeHtml(i.eglise || "—")} · ${escapeHtml(i.region || "—")}</div></div></div></div>
      `));
    });
  }
}

async function renderNationalCommuniques() {
  app.innerHTML = "";
  app.appendChild(topBar("Communiqués", renderNationalMenu));
  const wrap = el(`<div class="container"><p class="empty">Chargement…</p></div>`);
  app.appendChild(wrap);
  const { communiques } = await api("/api/communiques");

  function draw() {
    wrap.innerHTML = "";
    const card = el(`<div class="card"><div class="card-head"><span class="label">Nouveau communiqué</span></div></div>`);
    const fTitre = el(`<label class="field"><span class="label-text">Titre</span><input placeholder="ex. Recommandation aux régions" /></label>`);
    const fContenu = el(`<label class="field"><span class="label-text">Contenu</span><textarea rows="4"></textarea></label>`);
    card.appendChild(fTitre); card.appendChild(fContenu);
    const btn = el(`<button class="btn btn-gold">Publier</button>`);
    card.appendChild(btn);
    btn.onclick = async () => {
      const titre = fTitre.querySelector("input").value.trim();
      const contenu = fContenu.querySelector("textarea").value.trim();
      if (!titre || !contenu) return;
      btn.disabled = true;
      try {
        const c = await api("/api/communiques", { method: "POST", body: JSON.stringify({ titre, contenu }) });
        communiques.unshift(c);
        draw();
      } catch (e) { btn.disabled = false; alert(e.message); }
    };
    wrap.appendChild(card);

    wrap.appendChild(el(`<div class="list-head"><span class="label">Publiés</span></div>`));
    if (communiques.length === 0) {
      wrap.appendChild(el(`<p class="empty">Aucun communiqué publié.</p>`));
    } else {
      communiques.forEach((c) => {
        const card2 = el(`
          <div class="communique-card">
            <div class="titre">${escapeHtml(c.titre)}</div>
            <div class="date">${formatDateFr(c.created_at.slice(0, 10))}</div>
            <div class="contenu">${escapeHtml(c.contenu)}</div>
          </div>
        `);
        const delBtn = el(`<button class="btn btn-danger-outline btn-sm" style="margin-top:8px;">Supprimer</button>`);
        delBtn.onclick = async () => {
          await api(`/api/communiques/${c.id}`, { method: "DELETE" });
          const idx = communiques.findIndex((x) => x.id === c.id);
          communiques.splice(idx, 1);
          draw();
        };
        card2.appendChild(delBtn);
        wrap.appendChild(card2);
      });
    }
  }
  draw();
}

async function renderNationalAnnuaire() {
  app.innerHTML = "";
  const bar = topBar("Annuaire national", renderNationalMenu);
  app.appendChild(bar);
  const wrap = el(`<div class="container wide"><p class="empty">Chargement…</p></div>`);
  app.appendChild(wrap);

  const { jeunes } = await api("/api/jeunes/tous");
  let query = "";

  function draw() {
    wrap.innerHTML = "";
    const printBtn = el(`<button class="btn btn-primary no-print" style="margin-bottom:14px;">🖨️ Imprimer</button>`);
    printBtn.onclick = () => window.print();
    wrap.appendChild(printBtn);

    const search = el(`<input class="search-field no-print" placeholder="Rechercher un nom, une église, une région..." />`);
    search.value = query;
    search.oninput = () => { query = search.value; draw(); };
    wrap.appendChild(search);

    const filtered = query
      ? jeunes.filter((j) => [j.nom, j.eglise, j.region, j.fonction].join(" ").toLowerCase().includes(query.toLowerCase()))
      : jeunes;

    wrap.appendChild(el(`<h1 class="hero serif">Annuaire national des jeunes</h1>`));
    wrap.appendChild(el(`<p class="hint-text">${filtered.length} jeune${filtered.length > 1 ? "s" : ""}</p>`));

    const parRegion = {};
    filtered.forEach((j) => { (parRegion[j.region] = parRegion[j.region] || []).push(j); });
    Object.entries(parRegion).forEach(([region, liste]) => {
      wrap.appendChild(el(`<h2 class="section-h">${escapeHtml(region)} (${liste.length})</h2>`));
      liste.forEach((j) => {
        wrap.appendChild(el(`
          <div class="row-item">
            <div class="info">${avatarHtml(j.photo_url, j.nom)}<div>
              <div class="nom">${escapeHtml(j.nom)}</div>
              <div class="meta">${escapeHtml(j.eglise)} · ${escapeHtml(j.telephone || "—")} · ${escapeHtml(j.fonction || "—")}</div>
            </div></div>
          </div>
        `));
      });
    });
  }
  draw();
}

async function renderNationalComite() {
  app.innerHTML = "";
  app.appendChild(topBar("Comité national", renderNationalMenu));
  const wrap = el(`<div class="container"><p class="empty">Chargement…</p></div>`);
  app.appendChild(wrap);
  const { membres } = await api("/api/comite");

  function draw() {
    wrap.innerHTML = "";
    wrap.appendChild(el(`<p class="hint-text">Ces membres et leurs coordonnées apparaissent sur la page d'accueil publique du site.</p>`));

    const card = el(`<div class="card"><div class="card-head"><span class="label">Ajouter un membre</span></div></div>`);
    const fNom = el(`<label class="field"><span class="label-text">Nom complet</span><input placeholder="Nom et prénom" /></label>`);
    const fFonction = el(`<label class="field"><span class="label-text">Fonction dans le ministère des jeunes</span><input placeholder="ex. Président national, Trésorier..." /></label>`);
    const fTel = el(`<label class="field"><span class="label-text">Téléphone (facultatif)</span><input placeholder="ex. 622 00 00 00" /></label>`);
    card.appendChild(fNom); card.appendChild(fFonction); card.appendChild(fTel);
    const addBtn = el(`<button class="btn btn-gold">＋ Ajouter</button>`);
    card.appendChild(addBtn);
    addBtn.onclick = async () => {
      const nom = fNom.querySelector("input").value.trim();
      const fonction = fFonction.querySelector("input").value.trim();
      const telephone = fTel.querySelector("input").value.trim();
      if (!nom) return;
      addBtn.disabled = true;
      try {
        const m = await api("/api/comite", { method: "POST", body: JSON.stringify({ nom, fonction, telephone }) });
        membres.push(m);
        draw();
      } catch (e) { addBtn.disabled = false; alert(e.message); }
    };
    wrap.appendChild(card);

    wrap.appendChild(el(`<div class="list-head"><span class="label">Membres</span><span class="count">${membres.length}</span></div>`));
    if (membres.length === 0) {
      wrap.appendChild(el(`<p class="empty">Aucun membre ajouté pour le moment.</p>`));
    } else {
      membres.forEach((m) => {
        const row = el(`
          <div class="row-item">
            <div class="info">
              ${avatarHtml(m.photo_url, m.nom)}
              <div><div class="nom">${escapeHtml(m.nom)}</div><div class="meta">${escapeHtml(m.fonction || "—")}${m.telephone ? " · " + escapeHtml(m.telephone) : ""}</div></div>
            </div>
            <div class="actions">
              <label class="btn btn-ghost btn-sm" style="cursor:pointer;">📷<input type="file" accept="image/*" style="display:none;" /></label>
              <button aria-label="Supprimer">🗑</button>
            </div>
          </div>
        `);
        const fileInput = row.querySelector("input[type=file]");
        fileInput.onchange = async () => {
          const file = fileInput.files[0];
          if (!file) return;
          const fd = new FormData();
          fd.append("photo", file);
          const updated = await apiUpload(`/api/comite/${m.id}/photo`, fd);
          Object.assign(m, updated);
          draw();
        };
        row.querySelector("button[aria-label=Supprimer]").onclick = async () => {
          if (!confirm(`Retirer ${m.nom} du comité ?`)) return;
          await api(`/api/comite/${m.id}`, { method: "DELETE" });
          const idx = membres.findIndex((x) => x.id === m.id);
          membres.splice(idx, 1);
          draw();
        };
        wrap.appendChild(row);
      });
    }
  }
  draw();
}

// ============ DÉMARRAGE ============
(function start() {
  const session = getSession();
  if (session && session.user) routeAfterLogin(session.user);
  else renderHome();
})();
