const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

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

// Régional : jeunes de sa région (dashboard, cotisations, impression)
app.get("/api/jeunes/region", auth("regional"), async (req, res) => {
  const { data, error } = await supabase
    .from("jeunes")
    .select("*, paiements(montant)")
    .eq("region", req.user.region)
    .order("eglise", { ascending: true })
    .order("nom", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  const jeunes = data.map((j) => ({
    ...j,
    total_paye: (j.paiements || []).reduce((s, p) => s + Number(p.montant), 0),
    paiements: undefined,
  }));
  res.json({ jeunes });
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

// ================= COTISATIONS =================
app.get("/api/regions/resume", auth("national"), async (req, res) => {
  const [{ data: jeunes }, { data: objectifs }, { data: paiements }, { data: eglises }] = await Promise.all([
    supabase.from("jeunes").select("region"),
    supabase.from("objectifs_region").select("*"),
    supabase.from("paiements").select("region, montant"),
    supabase.from("users").select("region").eq("role", "eglise").not("eglise", "is", null),
  ]);
  const resume = REGIONS.map((region) => {
    const nbJeunes = (jeunes || []).filter((j) => j.region === region).length;
    const nbEglises = new Set((eglises || []).filter((e) => e.region === region).map((e) => e.region + e.eglise)).size;
    const objectif = (objectifs || []).find((o) => o.region === region);
    const totalPaye = (paiements || []).filter((p) => p.region === region).reduce((s, p) => s + Number(p.montant), 0);
    return {
      region,
      nbEglises,
      nbJeunes,
      montantCible: objectif ? Number(objectif.montant_cible) : 0,
      totalPaye,
    };
  });
  res.json({ regions: resume });
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
  res.json(data);
});

// Régional : voir sa progression + noter des paiements
app.get("/api/region/progression", auth("regional"), async (req, res) => {
  const [{ data: objectif }, { data: paiements }] = await Promise.all([
    supabase.from("objectifs_region").select("*").eq("region", req.user.region).single(),
    supabase.from("paiements").select("montant").eq("region", req.user.region),
  ]);
  const totalPaye = (paiements || []).reduce((s, p) => s + Number(p.montant), 0);
  res.json({ montantCible: objectif ? Number(objectif.montant_cible) : 0, totalPaye });
});

app.post("/api/paiements", auth("regional"), async (req, res) => {
  const { jeune_id, montant, date_paiement } = req.body || {};
  if (!jeune_id || !montant || Number(montant) <= 0) return res.status(400).json({ error: "Jeune et montant requis" });
  const { data: jeune } = await supabase.from("jeunes").select("region").eq("id", jeune_id).single();
  if (!jeune || jeune.region !== req.user.region) return res.status(403).json({ error: "Ce jeune n'appartient pas à votre région" });
  const { data, error } = await supabase
    .from("paiements")
    .insert({
      jeune_id,
      region: req.user.region,
      montant: Number(montant),
      date_paiement: date_paiement || new Date().toISOString().slice(0, 10),
      note_par: req.user.id,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/api/jeunes/:id/paiements", auth("regional"), async (req, res) => {
  const { data, error } = await supabase
    .from("paiements")
    .select("*")
    .eq("jeune_id", req.params.id)
    .order("date_paiement", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ paiements: data });
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
  const { titre, date_debut, date_fin, lieu, description } = req.body || {};
  if (!titre || !date_debut) return res.status(400).json({ error: "Titre et date de début requis" });
  const { data, error } = await supabase
    .from("camps")
    .insert({ titre: titre.trim(), date_debut, date_fin: date_fin || null, lieu, description })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ...data, orateurs: [] });
});

app.put("/api/camps/:id", auth("national"), async (req, res) => {
  const { titre, date_debut, date_fin, lieu, description } = req.body || {};
  const { data, error } = await supabase
    .from("camps")
    .update({ titre, date_debut, date_fin: date_fin || null, lieu, description })
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
