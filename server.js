const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const PDFDocument = require("pdfkit");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "changez-moi-en-production";
const PHOTOS_BUCKET = "photos";
const REGIONS = ["Basse Guinée", "Moyenne Guinée", "Haute Guinée", "Guinée Forestière"];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.warn("⚠️  SUPABASE_URL / SUPABASE_SERVICE_KEY manquants. Voir le README.");
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ================= AUTH HELPERS =================
function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, region: user.region, nom: user.nom, eglise: user.eglise, email: user.email },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function auth(...allowedRoles) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Connexion requise" });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (allowedRoles.length && !allowedRoles.includes(payload.role)) {
        return res.status(403).json({ error: "Accès non autorisé" });
      }
      req.user = payload;
      next();
    } catch {
      return res.status(401).json({ error: "Session invalide, reconnectez-vous" });
    }
  };
}

// ================= BOOTSTRAP COMPTE NATIONAL =================
async function bootstrapNational() {
  const email = (process.env.NATIONAL_EMAIL || "national@kalima.local").toLowerCase();
  const password = process.env.NATIONAL_PASSWORD || "MissionKalima2026";
  const { data: existing } = await supabase.from("users").select("id").eq("role", "national").limit(1);
  if (existing && existing.length > 0) return;
  const password_hash = await bcrypt.hash(password, 10);
  const { error } = await supabase
    .from("users")
    .insert({ email, password_hash, role: "national", nom: "Président national des jeunes" });
  if (error) console.error("Erreur création compte national :", error.message);
  else console.log(`✅ Compte national créé : ${email} — pense à changer le mot de passe si tu utilises la valeur par défaut.`);
}
bootstrapNational();

async function bootstrapRegions() {
  for (const region of REGIONS) {
    const { data } = await supabase.from("objectifs_region").select("region").eq("region", region);
    if (!data || data.length === 0) {
      await supabase.from("objectifs_region").insert({ region, montant_cible: 0 });
    }
  }
}
bootstrapRegions();

// ================= AUTHENTIFICATION =================
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email et mot de passe requis" });
  const { data: user } = await supabase.from("users").select("*").eq("email", email.toLowerCase().trim()).single();
  if (!user) return res.status(401).json({ error: "Identifiants incorrects" });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Identifiants incorrects" });
  const token = signToken(user);
  res.json({ token, user: { id: user.id, role: user.role, region: user.region, nom: user.nom, eglise: user.eglise, email: user.email } });
});

app.post("/api/auth/change-password", auth(), async (req, res) => {
  const { ancien, nouveau } = req.body || {};
  if (!nouveau || nouveau.length < 6) return res.status(400).json({ error: "Le nouveau mot de passe doit faire au moins 6 caractères" });
  const { data: user } = await supabase.from("users").select("*").eq("id", req.user.id).single();
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
  const ok = await bcrypt.compare(ancien || "", user.password_hash);
  if (!ok) return res.status(401).json({ error: "Ancien mot de passe incorrect" });
  const password_hash = await bcrypt.hash(nouveau, 10);
  await supabase.from("users").update({ password_hash }).eq("id", user.id);
  res.json({ ok: true });
});

app.post("/api/auth/change-email", auth(), async (req, res) => {
  const { mot_de_passe, nouveau_email } = req.body || {};
  if (!nouveau_email || !nouveau_email.includes("@")) return res.status(400).json({ error: "Email invalide" });
  const { data: user } = await supabase.from("users").select("*").eq("id", req.user.id).single();
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
  const ok = await bcrypt.compare(mot_de_passe || "", user.password_hash);
  if (!ok) return res.status(401).json({ error: "Mot de passe incorrect" });
  const email = nouveau_email.toLowerCase().trim();
  const { data: existing } = await supabase.from("users").select("id").eq("email", email).neq("id", user.id).limit(1);
  if (existing && existing.length > 0) return res.status(400).json({ error: "Cet email est déjà utilisé par un autre compte" });
  const { data: updated, error } = await supabase.from("users").update({ email }).eq("id", user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  const token = signToken(updated);
  res.json({ token, user: { id: updated.id, role: updated.role, region: updated.region, nom: updated.nom, eglise: updated.eglise, email: updated.email } });
});

// ================= GESTION DES COMPTES =================
// National crée/réinitialise les comptes des présidents régionaux
app.get("/api/comptes/regionaux", auth("national"), async (req, res) => {
  const { data, error } = await supabase.from("users").select("id,email,nom,region").eq("role", "regional").order("region");
  if (error) return res.status(500).json({ error: error.message });
  res.json({ comptes: data });
});

app.post("/api/comptes/regionaux", auth("national"), async (req, res) => {
  const { region, email, password, nom } = req.body || {};
  if (!REGIONS.includes(region)) return res.status(400).json({ error: "Région invalide" });
  if (!email || !password || !nom) return res.status(400).json({ error: "Champs requis manquants" });
  const password_hash = await bcrypt.hash(password, 10);
  const { data: existing } = await supabase.from("users").select("id").eq("role", "regional").eq("region", region).limit(1);
  if (existing && existing.length > 0) {
    const { data, error } = await supabase
      .from("users")
      .update({ email: email.toLowerCase().trim(), password_hash, nom })
      .eq("id", existing[0].id)
      .select("id,email,nom,region")
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  const { data, error } = await supabase
    .from("users")
    .insert({ email: email.toLowerCase().trim(), password_hash, nom, role: "regional", region, created_by: req.user.id })
    .select("id,email,nom,region")
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Régional crée les comptes des responsables d'église de sa région
app.get("/api/comptes/eglises", auth("regional"), async (req, res) => {
  const { data, error } = await supabase
    .from("users")
    .select("id,email,nom,eglise")
    .eq("role", "eglise")
    .eq("region", req.user.region)
    .order("nom");
  if (error) return res.status(500).json({ error: error.message });
  res.json({ comptes: data });
});

app.post("/api/comptes/eglises", auth("regional"), async (req, res) => {
  const { email, password, nom } = req.body || {};
  if (!email || !password || !nom) return res.status(400).json({ error: "Champs requis manquants" });
  const password_hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from("users")
    .insert({ email: email.toLowerCase().trim(), password_hash, nom, role: "eglise", region: req.user.region, created_by: req.user.id })
    .select("id,email,nom,eglise")
    .single();
  if (error) {
    if (error.message.includes("duplicate")) return res.status(400).json({ error: "Cet email est déjà utilisé" });
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

app.delete("/api/comptes/eglises/:id", auth("regional"), async (req, res) => {
  const { error } = await supabase.from("users").delete().eq("id", req.params.id).eq("region", req.user.region).eq("role", "eglise");
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ================= MON ÉGLISE (responsable d'église) =================
app.post("/api/mon-eglise", auth("eglise"), async (req, res) => {
  const { nom } = req.body || {};
  if (!nom || !nom.trim()) return res.status(400).json({ error: "Nom d'église requis" });
  const { data, error } = await supabase
    .from("users")
    .update({ eglise: nom.trim() })
    .eq("id", req.user.id)
    .select("id,email,nom,eglise,region")
    .single();
  if (error) return res.status(500).json({ error: error.message });
  const token = signToken({ ...req.user, eglise: data.eglise });
  res.json({ ...data, token });
});

// ================= JEUNES =================
// Église : ses propres jeunes
app.get("/api/jeunes/mon-eglise", auth("eglise"), async (req, res) => {
  if (!req.user.eglise) return res.status(400).json({ error: "Créez d'abord votre église" });
  const { data, error } = await supabase
    .from("jeunes")
    .select("*")
    .eq("eglise", req.user.eglise)
    .eq("region", req.user.region)
    .order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ jeunes: data });
});

app.post("/api/jeunes", auth("eglise"), async (req, res) => {
  if (!req.user.eglise) return res.status(400).json({ error: "Créez d'abord votre église" });
  const { nom, telephone, email, fonction } = req.body || {};
  if (!nom || !nom.trim()) return res.status(400).json({ error: "Le nom du jeune est requis" });
  const { data, error } = await supabase
    .from("jeunes")
    .insert({
      eglise: req.user.eglise,
      region: req.user.region,
      nom: nom.trim(),
      telephone,
      email,
      fonction,
      created_by: req.user.id,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put("/api/jeunes/:id", auth("eglise"), async (req, res) => {
  const { nom, telephone, email, fonction } = req.body || {};
  const { data, error } = await supabase
    .from("jeunes")
    .update({ nom, telephone, email, fonction })
    .eq("id", req.params.id)
    .eq("eglise", req.user.eglise)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete("/api/jeunes/:id", auth("eglise"), async (req, res) => {
  const { error } = await supabase.from("jeunes").delete().eq("id", req.params.id).eq("eglise", req.user.eglise);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.post("/api/jeunes/:id/photo", auth("eglise", "regional", "national"), upload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucune photo reçue" });
  const ext = (req.file.mimetype.split("/")[1] || "jpg").replace("jpeg", "jpg");
  const filePath = `jeune-${req.params.id}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
  if (uploadError) return res.status(500).json({ error: uploadError.message });
  const { data: pub } = supabase.storage.from(PHOTOS_BUCKET).getPublicUrl(filePath);
  const photo_url = `${pub.publicUrl}?t=${Date.now()}`;
  const { data, error } = await supabase.from("jeunes").update({ photo_url }).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Régional : jeunes de sa région (dashboard, impression)
app.get("/api/jeunes/region", auth("regional"), async (req, res) => {
  const { data, error } = await supabase
    .from("jeunes")
    .select("*")
    .eq("region", req.user.region)
    .order("eglise", { ascending: true })
    .order("nom", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ jeunes: data });
});

// National : tous les jeunes (annuaire national, impression)
app.get("/api/jeunes/tous", auth("national"), async (req, res) => {
  const { data, error } = await supabase
    .from("jeunes")
    .select("*")
    .order("region", { ascending: true })
    .order("eglise", { ascending: true })
    .order("nom", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ jeunes: data });
});

// ================= COTISATIONS (versements région → national) =================
// Le national note lui-même ce qu'il reçoit physiquement de chaque région.
// La somme des jeunes ne détermine plus rien : l'argent peut venir de plusieurs
// sources (jeunes, églises...), donc on ne l'attribue pas à une personne précise.

async function calculerResumeRegions() {
  const [{ data: jeunes }, { data: objectifs }, { data: versements }, { data: eglises }] = await Promise.all([
    supabase.from("jeunes").select("region"),
    supabase.from("objectifs_region").select("*"),
    supabase.from("versements_region").select("region, montant"),
    supabase.from("users").select("region, eglise").eq("role", "eglise").not("eglise", "is", null),
  ]);
  return REGIONS.map((region) => {
    const nbJeunes = (jeunes || []).filter((j) => j.region === region).length;
    const nbEglises = new Set((eglises || []).filter((e) => e.region === region).map((e) => e.eglise)).size;
    const objectif = (objectifs || []).find((o) => o.region === region);
    const totalVerse = (versements || []).filter((v) => v.region === region).reduce((s, v) => s + Number(v.montant), 0);
    return {
      region,
      nbEglises,
      nbJeunes,
      montantCible: objectif ? Number(objectif.montant_cible) : 0,
      totalVerse,
    };
  });
}

app.get("/api/regions/resume", auth("national"), async (req, res) => {
  const resume = await calculerResumeRegions();
  res.json({ regions: resume });
});

// Progression publique, visible sur l'écran d'accueil sans connexion
app.get("/api/regions/progression-publique", async (req, res) => {
  const resume = await calculerResumeRegions();
  res.json({ regions: resume.map(({ region, montantCible, totalVerse }) => ({ region, montantCible, totalVerse })) });
});

app.put("/api/regions/:region/objectif", auth("national"), async (req, res) => {
  const { region } = req.params;
  const { montant_cible } = req.body || {};
  if (!REGIONS.includes(region)) return res.status(400).json({ error: "Région invalide" });
  const { data, error } = await supabase
    .from("objectifs_region")
    .update({ montant_cible: Number(montant_cible) || 0 })
    .eq("region", region)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  // Changer l'objectif démarre un nouveau cycle : l'historique des versements
  // et le total collecté de cette région repartent à zéro.
  const { error: resetError } = await supabase.from("versements_region").delete().eq("region", region);
  if (resetError) return res.status(500).json({ error: resetError.message });
  res.json(data);
});

// Le national note un versement reçu d'une région
app.post("/api/regions/:region/versements", auth("national"), async (req, res) => {
  const { region } = req.params;
  const { montant, date_versement, note } = req.body || {};
  if (!REGIONS.includes(region)) return res.status(400).json({ error: "Région invalide" });
  if (!montant || Number(montant) <= 0) return res.status(400).json({ error: "Montant requis" });
  const { data, error } = await supabase
    .from("versements_region")
    .insert({
      region,
      montant: Number(montant),
      date_versement: date_versement || new Date().toISOString().slice(0, 10),
      note: note || null,
      note_par: req.user.id,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/api/regions/:region/versements", auth("national", "regional"), async (req, res) => {
  const { region } = req.params;
  if (req.user.role === "regional" && req.user.region !== region) {
    return res.status(403).json({ error: "Accès non autorisé" });
  }
  const { data, error } = await supabase
    .from("versements_region")
    .select("*")
    .eq("region", region)
    .order("date_versement", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ versements: data });
});

// Supprimer un versement précis de l'historique
app.delete("/api/regions/:region/versements/:id", auth("national"), async (req, res) => {
  const { error } = await supabase
    .from("versements_region")
    .delete()
    .eq("id", req.params.id)
    .eq("region", req.params.region);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Vider tout l'historique d'une région
app.delete("/api/regions/:region/versements", auth("national"), async (req, res) => {
  const { region } = req.params;
  if (!REGIONS.includes(region)) return res.status(400).json({ error: "Région invalide" });
  const { error } = await supabase.from("versements_region").delete().eq("region", region);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Régional : voir la progression de sa propre région (lecture seule)
app.get("/api/region/progression", auth("regional"), async (req, res) => {
  const [{ data: objectif }, { data: versements }] = await Promise.all([
    supabase.from("objectifs_region").select("*").eq("region", req.user.region).single(),
    supabase.from("versements_region").select("montant").eq("region", req.user.region),
  ]);
  const totalVerse = (versements || []).reduce((s, v) => s + Number(v.montant), 0);
  res.json({ montantCible: objectif ? Number(objectif.montant_cible) : 0, totalVerse });
});

// ================= CAMPS =================
app.get("/api/camps", async (req, res) => {
  const { data: camps, error } = await supabase.from("camps").select("*").order("date_debut", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  const { data: orateurs } = await supabase.from("orateurs").select("*");
  const result = camps.map((c) => ({ ...c, orateurs: (orateurs || []).filter((o) => o.camp_id === c.id) }));
  res.json({ camps: result });
});

app.post("/api/camps", auth("national"), async (req, res) => {
  const { titre, theme, reference, date_debut, date_fin, lieu, description } = req.body || {};
  if (!titre || !date_debut) return res.status(400).json({ error: "Titre et date de début requis" });
  const { data, error } = await supabase
    .from("camps")
    .insert({ titre: titre.trim(), theme: theme || null, reference: reference || null, date_debut, date_fin: date_fin || null, lieu, description })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ...data, orateurs: [] });
});

app.put("/api/camps/:id", auth("national"), async (req, res) => {
  const { titre, theme, reference, date_debut, date_fin, lieu, description } = req.body || {};
  const { data, error } = await supabase
    .from("camps")
    .update({ titre, theme: theme || null, reference: reference || null, date_debut, date_fin: date_fin || null, lieu, description })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete("/api/camps/:id", auth("national"), async (req, res) => {
  const { error } = await supabase.from("camps").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.put("/api/camps/:id/planning", auth("national"), async (req, res) => {
  const { planning_columns, planning_rows } = req.body || {};
  const { data, error } = await supabase
    .from("camps")
    .update({ planning_columns: planning_columns || [], planning_rows: planning_rows || [] })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/api/camps/:id/orateurs", auth("national"), async (req, res) => {
  const { nom } = req.body || {};
  if (!nom || !nom.trim()) return res.status(400).json({ error: "Nom de l'orateur requis" });
  const { data, error } = await supabase
    .from("orateurs")
    .insert({ camp_id: req.params.id, nom: nom.trim() })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/api/orateurs/:id/photo", auth("national"), upload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucune photo reçue" });
  const ext = (req.file.mimetype.split("/")[1] || "jpg").replace("jpeg", "jpg");
  const filePath = `orateur-${req.params.id}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
  if (uploadError) return res.status(500).json({ error: uploadError.message });
  const { data: pub } = supabase.storage.from(PHOTOS_BUCKET).getPublicUrl(filePath);
  const photo_url = `${pub.publicUrl}?t=${Date.now()}`;
  const { data, error } = await supabase.from("orateurs").update({ photo_url }).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete("/api/orateurs/:id", auth("national"), async (req, res) => {
  const { error } = await supabase.from("orateurs").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ================= INSCRIPTIONS AUX CAMPS =================
app.post("/api/camps/:id/inscriptions", async (req, res) => {
  const { nom, telephone, eglise, region } = req.body || {};
  if (!nom || !nom.trim()) return res.status(400).json({ error: "Nom requis" });
  const { data, error } = await supabase
    .from("inscriptions_camp")
    .insert({ camp_id: req.params.id, nom: nom.trim(), telephone, eglise, region })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/api/camps/:id/inscriptions", auth("national"), async (req, res) => {
  const { data, error } = await supabase
    .from("inscriptions_camp")
    .select("*")
    .eq("camp_id", req.params.id)
    .order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ inscriptions: data });
});

app.get("/api/camps/:id/inscriptions/pdf", auth("national"), async (req, res) => {
  const { data: camp } = await supabase.from("camps").select("titre").eq("id", req.params.id).single();
  const { data: inscriptions, error } = await supabase
    .from("inscriptions_camp")
    .select("*")
    .eq("camp_id", req.params.id)
    .order("region", { ascending: true })
    .order("nom", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const titre = camp ? camp.titre : "Camp";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="inscrits-${titre.replace(/[^a-z0-9]+/gi, "_")}.pdf"`);

  const doc = new PDFDocument({ margin: 50, size: "A4" });
  doc.pipe(res);

  doc.fontSize(18).fillColor("#1F3A5F").text("Mission Kalima — Jeunesse Nationale", { align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(14).fillColor("#22262B").text(`Liste des inscrits — ${titre}`, { align: "center" });
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor("#8A8266").text(`${inscriptions.length} inscrit${inscriptions.length > 1 ? "s" : ""} · Édité le ${new Date().toLocaleDateString("fr-FR")}`, { align: "center" });
  doc.moveDown(1.2);

  const colX = { nom: 50, tel: 220, eglise: 330, region: 460 };
  function drawHeader(y) {
    doc.fontSize(10).fillColor("#fff");
    doc.rect(50, y, 495, 22).fill("#1F3A5F");
    doc.fillColor("#fff");
    doc.text("Nom", colX.nom + 5, y + 6, { width: 160 });
    doc.text("Téléphone", colX.tel + 5, y + 6, { width: 100 });
    doc.text("Église", colX.eglise + 5, y + 6, { width: 120 });
    doc.text("Région", colX.region + 5, y + 6, { width: 80 });
    return y + 22;
  }

  let y = drawHeader(doc.y);
  doc.fontSize(9);
  inscriptions.forEach((i, idx) => {
    if (y > 760) {
      doc.addPage();
      y = drawHeader(50);
    }
    if (idx % 2 === 0) doc.rect(50, y, 495, 20).fill("#F3EFE3");
    doc.fillColor("#22262B");
    doc.text(i.nom || "", colX.nom + 5, y + 5, { width: 160 });
    doc.text(i.telephone || "—", colX.tel + 5, y + 5, { width: 100 });
    doc.text(i.eglise || "—", colX.eglise + 5, y + 5, { width: 120 });
    doc.text(i.region || "—", colX.region + 5, y + 5, { width: 80 });
    y += 20;
  });

  if (inscriptions.length === 0) {
    doc.fillColor("#8A8266").text("Aucune inscription reçue pour ce camp.", 50, y + 10);
  }

  doc.end();
});

// ================= COMITÉ NATIONAL =================
app.get("/api/comite", async (req, res) => {
  const { data, error } = await supabase.from("comite_national").select("*").order("ordre", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ membres: data });
});

app.post("/api/comite", auth("national"), async (req, res) => {
  const { nom, fonction, telephone } = req.body || {};
  if (!nom || !nom.trim()) return res.status(400).json({ error: "Le nom est requis" });
  const { data: existants } = await supabase.from("comite_national").select("ordre").order("ordre", { ascending: false }).limit(1);
  const ordre = existants && existants.length ? existants[0].ordre + 1 : 0;
  const { data, error } = await supabase
    .from("comite_national")
    .insert({ nom: nom.trim(), fonction: fonction || "", telephone: telephone || "", ordre })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put("/api/comite/:id", auth("national"), async (req, res) => {
  const { nom, fonction, telephone } = req.body || {};
  const { data, error } = await supabase
    .from("comite_national")
    .update({ nom, fonction, telephone })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/api/comite/:id/photo", auth("national"), upload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucune photo reçue" });
  const ext = (req.file.mimetype.split("/")[1] || "jpg").replace("jpeg", "jpg");
  const filePath = `comite-${req.params.id}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
  if (uploadError) return res.status(500).json({ error: uploadError.message });
  const { data: pub } = supabase.storage.from(PHOTOS_BUCKET).getPublicUrl(filePath);
  const photo_url = `${pub.publicUrl}?t=${Date.now()}`;
  const { data, error } = await supabase.from("comite_national").update({ photo_url }).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete("/api/comite/:id", auth("national"), async (req, res) => {
  const { error } = await supabase.from("comite_national").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ================= COMMUNIQUÉS =================
app.get("/api/communiques", async (req, res) => {
  const { data, error } = await supabase.from("communiques").select("*").order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ communiques: data });
});

app.post("/api/communiques", auth("national"), async (req, res) => {
  const { titre, contenu } = req.body || {};
  if (!titre || !contenu) return res.status(400).json({ error: "Titre et contenu requis" });
  const { data, error } = await supabase.from("communiques").insert({ titre: titre.trim(), contenu: contenu.trim() }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete("/api/communiques/:id", auth("national"), async (req, res) => {
  const { error } = await supabase.from("communiques").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Kalima Jeunesse Nationale en écoute sur le port ${PORT}`);
});
