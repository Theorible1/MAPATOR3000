/**
 * MapTap — Vues : CŒUR DE CALCUL (fonctions pures, sans SpreadsheetApp).
 * Testé hors tableur (voir tests/test_apps_script.py). Les dates sont des numéros de série Sheets (jours depuis le 30/12/1899).
 *
 * Deux modes, choisis automatiquement :
 *   - zone = « tous les continents »  -> classements sur les SCORES DU JOUR (total /1000, tous les jours) ;
 *   - zone = continent / région / pays -> classements sur les MANCHES de cette zone (score /100, jours couverts seulement).
 *
 * CORRECTIF 25/10/2026 : progression sur TOUTE la période.
 *   Avant : pour « Tout », la progression comparait les 30 derniers jours à tout ce qui précède.
 *   Maintenant : « Tout » compare la 2e moitié de la période à la 1re moitié. Même règle quand la période précédente de même durée
 *   n'existe pas dans les données (ex. « 6 derniers mois » ou « 12 derniers mois » alors que les données ne remontent qu'à juillet).
 */

var MV_PERIODES = ['7 derniers jours', '10 derniers jours', '30 derniers jours', '6 derniers mois', '12 derniers mois', 'Tout', 'Dates libres (début et fin ci-dessous)'];
var MV_LIBRE = 'Dates libres (début et fin ci-dessous)';
var MV_AFFICHAGES = ['Classements', 'Évolution'];
var MV_CRITERES = ['Moyenne', 'Moyenne glissante (3 points)', 'Moyenne cumulée', 'Meilleur score', 'Indice (zone choisie)'];
var MV_PAS = ['Jour', 'Semaine', 'Mois'];
// Menu « Courbes » (noms du 09/11/2026) ; les anciens noms restent compris (vues créées avant)
var MV_SERIES = ['Une courbe par joueur', 'Sororité vs Fraternité', 'Une seule courbe (moyenne)'];
var MV_SERIES_ANCIENS = { 'Chaque joueur coché': 'Une courbe par joueur', 'Par équipe': 'Sororité vs Fraternité', 'Moyenne des joueurs cochés': 'Une seule courbe (moyenne)' };
var MV_TOUS_CONT = 'Tous les continents', MV_TOUTES_REG = 'Toutes les régions', MV_TOUS_PAYS = 'Tous les pays';
var MV_TOL = 1e-9;

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------
var MV_TZ = '';   // fuseau du tableur (renseigné par Vue.gs) : une date à minuit à Paris ne doit pas glisser d'un jour selon le fuseau du script
function mvSerial(v) {
  if (v instanceof Date) {
    var y = v.getFullYear(), m = v.getMonth(), d = v.getDate();
    if (MV_TZ && typeof Utilities !== 'undefined') { var p = Utilities.formatDate(v, MV_TZ, 'yyyy-MM-dd').split('-'); y = +p[0]; m = +p[1] - 1; d = +p[2]; }
    return Math.round((Date.UTC(y, m, d) - Date.UTC(1899, 11, 30)) / 86400000);
  }
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    var m = v.trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
    if (m) return Math.round((Date.UTC(+m[3], +m[2] - 1, +m[1]) - Date.UTC(1899, 11, 30)) / 86400000);
  }
  return NaN;
}
function mvAjouterMois(s, k) {
  var d = new Date(Date.UTC(1899, 11, 30) + s * 86400000);
  var y = d.getUTCFullYear(), m = d.getUTCMonth() + k, jour = d.getUTCDate();
  var dernier = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Math.round((Date.UTC(y, m, Math.min(jour, dernier)) - Date.UTC(1899, 11, 30)) / 86400000);
}
function mvLibelleDate(s) {
  var d = new Date(Date.UTC(1899, 11, 30) + s * 86400000), p = function (n) { return (n < 10 ? '0' : '') + n; };
  return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
}

// ---------------------------------------------------------------------------------------------
// Lecture des onglets (tableaux de valeurs -> objets)
// ---------------------------------------------------------------------------------------------
/** Config A3:G22 -> joueurs. Colonnes : id, nom, equipe, actif, date_arrivee, couleur, alias. */
function mvLireJoueurs(lignes) {
  var out = [];
  for (var i = 0; i < lignes.length; i++) {
    var l = lignes[i];
    if (!l[0] || String(l[0]).trim() === '') continue;
    var actif = !(l[3] === false || String(l[3]).toUpperCase() === 'FALSE');
    out.push({ id: String(l[0]).trim(), nom: String(l[1]).trim() || String(l[0]).trim(), equipe: String(l[2]).trim(), actif: actif, couleur: String(l[5] || '') });
  }
  return out;
}
/** Config I3:J30 (cle, valeur) -> paramètres numériques, avec valeurs par défaut du contrat. */
function mvLireParams(lignes) {
  var p = { seuil_classe_semaine: 3, seuil_classe_mois: 8, seuil_classe_annee: 20, seuil_classe_alltime: 10,
            seuil_progression_semaine: 3, seuil_progression_mois: 8, seuil_progression_annee: 20, seuil_pays_rounds: 5, min_joueurs_medaille_jour: 2 };
  for (var i = 0; i < lignes.length; i++) {
    var k = String(lignes[i][0]).trim(), v = Number(lignes[i][1]);
    if (k && p.hasOwnProperty(k) && isFinite(v) && String(lignes[i][1]).trim() !== '') p[k] = v;
  }
  return p;
}
/** Moteur_Data A2:J -> {d, id, total}. Les lignes sans date ou sans total sont ignorées. */
function mvLireJours(lignes) {
  var out = [];
  for (var i = 0; i < lignes.length; i++) {
    var l = lignes[i], d = mvSerial(l[0]), t = Number(l[4]);
    if (!isFinite(d) || l[4] === '' || !isFinite(t)) continue;
    out.push({ d: d, id: String(l[1]), total: t });
  }
  return out;
}
/** Moteur_Rounds A2:M -> {d, id, pos, s, pays, region, cont, ecart}. Seules les manches « inclus_pays = 1 » sont gardées. */
function mvLireManches(lignes) {
  var out = [];
  for (var i = 0; i < lignes.length; i++) {
    var l = lignes[i], d = mvSerial(l[0]);
    if (!isFinite(d) || Number(l[12]) !== 1) continue;
    out.push({ d: d, id: String(l[1]), pos: Number(l[2]), s: Number(l[3]), pays: String(l[5]), region: String(l[6]), cont: String(l[7]), ecart: Number(l[11]) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Zone : listes en cascade Continent -> Région -> Pays (seulement ce qui contient des manches)
// ---------------------------------------------------------------------------------------------
function mvTriFr(a) { return a.slice().sort(function (x, y) { return x.localeCompare(y, 'fr'); }); }
function mvUniques(a) { var s = {}, o = []; for (var i = 0; i < a.length; i++) if (!s[a[i]]) { s[a[i]] = 1; o.push(a[i]); } return o; }

function mvListesZone(manches, continent, region) {
  var cont = [], reg = [], pays = [];
  for (var i = 0; i < manches.length; i++) {
    var m = manches[i];
    cont.push(m.cont);
    if (continent === MV_TOUS_CONT || m.cont === continent) {
      reg.push(m.region);
      if (region === MV_TOUTES_REG || m.region === region) pays.push(m.pays);
    }
  }
  return {
    continents: [MV_TOUS_CONT].concat(mvTriFr(mvUniques(cont))),
    regions: [MV_TOUTES_REG].concat(mvTriFr(mvUniques(reg))),
    pays: [MV_TOUS_PAYS].concat(mvTriFr(mvUniques(pays)))
  };
}
/** Remet à « tous » les menus enfants dont la valeur n'existe plus après un changement de menu parent. */
function mvZoneValide(manches, zone) {
  var z = { continent: zone.continent || MV_TOUS_CONT, region: zone.region || MV_TOUTES_REG, pays: zone.pays || MV_TOUS_PAYS };
  var l = mvListesZone(manches, z.continent, MV_TOUTES_REG);
  if (l.continents.indexOf(z.continent) < 0) z.continent = MV_TOUS_CONT;
  l = mvListesZone(manches, z.continent, MV_TOUTES_REG);
  if (l.regions.indexOf(z.region) < 0) z.region = MV_TOUTES_REG;
  l = mvListesZone(manches, z.continent, z.region);
  if (l.pays.indexOf(z.pays) < 0) z.pays = MV_TOUS_PAYS;
  return z;
}
function mvZoneActive(z) { return z.continent !== MV_TOUS_CONT || z.region !== MV_TOUTES_REG || z.pays !== MV_TOUS_PAYS; }
function mvZoneLibelle(z) {
  if (z.pays !== MV_TOUS_PAYS) return z.pays;
  if (z.region !== MV_TOUTES_REG) return z.region + (z.continent !== MV_TOUS_CONT ? ' (' + z.continent + ')' : '');
  if (z.continent !== MV_TOUS_CONT) return z.continent;
  return 'Monde entier';
}

// ---------------------------------------------------------------------------------------------
// Périodes
// ---------------------------------------------------------------------------------------------
/**
 * fin = dernier jour joué, debut = premier jour des données. Retourne la fenêtre, la fenêtre précédente (évolution des rangs)
 * et la paire de fenêtres de la progression. cle = famille de seuils (semaine | mois | annee | alltime).
 */
function mvPeriode(label, libre1, libre2, fin, debut) {
  var nb = { '7 derniers jours': 7, '10 derniers jours': 10, '30 derniers jours': 30 };
  var p = { label: label, from: debut, to: fin, note: '', tout: false };
  if (nb[label]) p.from = fin - nb[label] + 1;
  else if (label === '6 derniers mois') p.from = mvAjouterMois(fin, -6) + 1;
  else if (label === '12 derniers mois') p.from = mvAjouterMois(fin, -12) + 1;
  else if (label === MV_LIBRE) {
    var a = mvSerial(libre1), b = mvSerial(libre2);
    if (isFinite(a) && isFinite(b) && a <= b) { p.from = a; p.to = b; }
    else { p.note = 'Dates libres invalides (remplis Début libre ET Fin libre, début ≤ fin) : période « Tout » affichée.'; p.tout = true; }
  } else p.tout = true;
  var len = p.to - p.from + 1;
  p.cle = p.tout ? 'alltime' : (len <= 10 ? 'semaine' : (len <= 45 ? 'mois' : 'annee'));
  // Évolution des rangs
  if (p.tout) {
    p.evoFrom = debut; p.evoTo = fin - 7;                                 // rangs d'il y a 7 jours
    p.evoLabel = 'il y a 7 jours';
  } else {
    p.evoFrom = p.from - len; p.evoTo = p.from - 1;
    p.evoLabel = 'période précédente de même durée';
  }
  // Progression : période précédente de même durée si elle contient des données ; sinon (« Tout », ou début des données)
  // 2e moitié contre 1re moitié de la période affichée (limitée aux jours où il y a des données).
  if (!p.tout && p.evoFrom >= debut) {
    p.progCur = [p.from, p.to]; p.progPrev = [p.evoFrom, p.evoTo];
    p.progLabel = 'vs période préc.';
  } else {
    var d0 = Math.max(p.from, debut), d1 = p.to, milieu = d0 + Math.floor((d1 - d0 + 1) / 2) - 1;
    p.progPrev = [d0, milieu]; p.progCur = [milieu + 1, d1];
    p.progLabel = '2e moitié vs 1re moitié';
  }
  p.titre = p.tout ? 'Toute la période' : mvLibelleDate(p.from) + ' au ' + mvLibelleDate(p.to);
  return p;
}

// ---------------------------------------------------------------------------------------------
// Statistiques
// ---------------------------------------------------------------------------------------------
function mvMoy(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : NaN; }
function mvMediane(a) {
  if (!a.length) return NaN;
  var s = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mvEcartType(a) { if (a.length < 1) return NaN; var m = mvMoy(a), s = 0; for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return Math.sqrt(s / a.length); }

/** Observations d'un joueur dans [de, a] : {v} (score du jour ou de la manche), e (écart, manches seulement). */
function mvObservations(source, ids, de, a, modeManches, zone) {
  var out = [];
  for (var i = 0; i < source.length; i++) {
    var o = source[i];
    if (o.d < de || o.d > a || !ids[o.id]) continue;
    if (modeManches) {
      if (zone.continent !== MV_TOUS_CONT && o.cont !== zone.continent) continue;
      if (zone.region !== MV_TOUTES_REG && o.region !== zone.region) continue;
      if (zone.pays !== MV_TOUS_PAYS && o.pays !== zone.pays) continue;
      out.push({ id: o.id, d: o.d, v: o.s, e: o.ecart });
    } else out.push({ id: o.id, d: o.d, v: o.total, e: NaN });
  }
  return out;
}
/** Agrégats par joueur. victoires : nombre de jours où le joueur a le meilleur total parmi les joueurs retenus (minJoueurs minimum ce jour-là). */
function mvAgreger(obs, modeManches, minJoueurs) {
  var par = {}, i, k;
  for (i = 0; i < obs.length; i++) { (par[obs[i].id] = par[obs[i].id] || []).push(obs[i]); }
  var wins = {};
  if (!modeManches) {
    var jours = {};
    for (i = 0; i < obs.length; i++) { (jours[obs[i].d] = jours[obs[i].d] || []).push(obs[i]); }
    for (var d in jours) {
      var l = jours[d]; if (l.length < minJoueurs) continue;
      var best = -Infinity; for (i = 0; i < l.length; i++) if (l[i].v > best) best = l[i].v;
      for (i = 0; i < l.length; i++) if (l[i].v >= best - MV_TOL) wins[l[i].id] = (wins[l[i].id] || 0) + 1;
    }
  }
  var out = {};
  for (k in par) {
    var vs = par[k].map(function (o) { return o.v; }), es = par[k].filter(function (o) { return isFinite(o.e); }).map(function (o) { return o.e; });
    var haut = 0, bas = 0;
    for (i = 0; i < vs.length; i++) { if (vs[i] >= 90) haut++; if (vs[i] < 50) bas++; }
    out[k] = { n: vs.length, moy: mvMoy(vs), med: mvMediane(vs), best: Math.max.apply(null, vs), worst: Math.min.apply(null, vs),
               std: mvEcartType(vs), indice: mvMoy(es), wins: wins[k] || 0, p90: haut / vs.length, p50: bas / vs.length };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Blocs de classement
// ---------------------------------------------------------------------------------------------
var MV_BLOCS_JOURS = [
  { cat: '🎯 Moyenne', lab: 'Moyenne', fmt: '0.0', up: true, f: function (a) { return a.moy; }, seuil: 'classe' },
  { cat: '🏆 Meilleur score', lab: 'Meilleur', fmt: '0', up: true, f: function (a) { return a.best; }, seuil: 'classe' },
  { cat: '📈 Progression', lab: 'Δ moyenne (pts)', fmt: '+0.0;-0.0;0.0', up: true, prog: true, seuil: 'prog' },
  { cat: '🧘 Régularité', lab: 'Écart-type', fmt: '0.0', up: false, f: function (a) { return a.std; }, seuil: 'classe' },
  { cat: '🛡 Pire score', lab: 'Pire score', fmt: '0', up: true, f: function (a) { return a.worst; }, seuil: 'classe' },
  { cat: '🥇 Victoires du jour', lab: 'Victoires', fmt: '0', up: true, f: function (a) { return a.wins; }, seuil: 'classe', sansMoyenne: true }
];

// ---------------------------------------------------------------------------------------------
// Lignes « moyenne » cochables (09/11/2026) : une par équipe + « tous ». Clé : nom de l'équipe, ou '*' pour tout le monde.
// ---------------------------------------------------------------------------------------------
var MV_TOUS = '*';
var MV_EMOJI_EQUIPE = { 'Sororité': '💗', 'Fraternité': '💙' };
var MV_COULEUR_TOUS = '#F4B400';
/** Équipes des joueurs actifs, dans l'ordre d'apparition dans Config, puis « tous ». */
function mvClesMoyennes(joueurs) {
  return mvUniques(joueurs.filter(function (j) { return j.actif && j.equipe; }).map(function (j) { return j.equipe; })).concat([MV_TOUS]);
}
function mvLibelleMoyenne(cle) { return cle === MV_TOUS ? '⭐ Moyenne de tous' : (MV_EMOJI_EQUIPE[cle] || '▪') + ' Moyenne ' + cle; }
/** Groupes à moyenner : [{cle, nom, equipe, couleur, membres:[ids actifs]}] (toute l'équipe, cochée ou non). */
function mvGroupesMoyennes(joueurs, cles) {
  return (cles || []).map(function (cle) {
    var membres = joueurs.filter(function (j) { return j.actif && (cle === MV_TOUS || j.equipe === cle); }).map(function (j) { return j.id; });
    return { cle: cle, nom: mvLibelleMoyenne(cle), equipe: cle === MV_TOUS ? '' : cle, couleur: cle === MV_TOUS ? MV_COULEUR_TOUS : (MV_COULEUR_EQUIPE[cle] || MV_COULEURS_SERIE[2]), membres: membres };
  }).filter(function (g) { return g.membres.length; });
}
var MV_BLOCS_MANCHES = [
  { cat: '🎯 Moyenne des manches', lab: 'Moyenne /100', fmt: '0.0', up: true, f: function (a) { return a.moy; }, seuil: 'pays' },
  { cat: '⚖️ Indice (écart à son niveau)', lab: 'Indice', fmt: '+0.0;-0.0;0.0', up: true, f: function (a) { return a.indice; }, seuil: 'pays' },
  { cat: '📈 Progression', lab: 'Δ moyenne', fmt: '+0.0;-0.0;0.0', up: true, prog: true, seuil: 'pays' },
  { cat: '🧘 Régularité', lab: 'Écart-type', fmt: '0.0', up: false, f: function (a) { return a.std; }, seuil: 'pays' },
  { cat: '⭐ Manches ≥ 90', lab: '% ≥ 90', fmt: '0%', up: true, f: function (a) { return a.p90; }, seuil: 'pays' },
  { cat: '💥 Manches < 50', lab: '% < 50', fmt: '0%', up: false, f: function (a) { return a.p50; }, seuil: 'pays' }
];
var MV_SEUILS = { semaine: 'seuil_classe_semaine', mois: 'seuil_classe_mois', annee: 'seuil_classe_annee', alltime: 'seuil_classe_alltime' };
var MV_SEUILS_PROG = { semaine: 'seuil_progression_semaine', mois: 'seuil_progression_mois', annee: 'seuil_progression_annee', alltime: 'seuil_progression_mois' };

/** Rang = 1 + nombre de joueurs strictement meilleurs (égalités au même rang). */
function mvRangs(entrees, up) {
  for (var i = 0; i < entrees.length; i++) {
    var r = 1;
    for (var j = 0; j < entrees.length; j++) if (up ? entrees[j].val > entrees[i].val + MV_TOL : entrees[j].val < entrees[i].val - MV_TOL) r++;
    entrees[i].rk = r;
  }
}

/**
 * Construit le modèle d'affichage (sans rien dessiner).
 *  donnees : {joueurs, jours, manches, params}   sel : {periode, libre1, libre2, zone:{continent,region,pays}, ids:{id:true}}
 */
function mvConstruire(donnees, sel) {
  var jr = donnees.joueurs, params = donnees.params, notes = [];
  var zone = mvZoneValide(donnees.manches, sel.zone || {});
  var modeManches = mvZoneActive(zone), source = modeManches ? donnees.manches : donnees.jours;
  var tousDates = []; for (var i = 0; i < donnees.jours.length; i++) tousDates.push(donnees.jours[i].d);
  if (!tousDates.length) return { vide: true, notes: ['Aucune donnée dans Saisie / Moteur_Data.'], zone: zone, mode: modeManches ? 'manches' : 'jours' };
  var fin = Math.max.apply(null, tousDates), debut = Math.min.apply(null, tousDates);
  var per = mvPeriode(sel.periode, sel.libre1, sel.libre2, fin, debut);
  if (per.note) notes.push(per.note);
  var ids = sel.ids || {}, nCoches = 0; for (var k in ids) if (ids[k]) nCoches++;
  var moyennes = mvGroupesMoyennes(jr, sel.moyennes);
  if (!nCoches && !moyennes.length) notes.push('Rien de coché : coche au moins un joueur ou une moyenne dans la liste.');
  var nom = {}, couleur = {}, equipe = {}; jr.forEach(function (j) { nom[j.id] = j.nom; couleur[j.id] = j.couleur; equipe[j.id] = j.equipe; });
  var minJ = params.min_joueurs_medaille_jour || 2;
  // agrégats d'un groupe « moyenne » : toutes les parties de ses membres mises en commun (pas de victoires : sans objet)
  var aggGroupe = function (g, de, a) {
    var m = {}; g.membres.forEach(function (id) { m[id] = true; });
    var o = mvObservations(source, m, de, a, modeManches, zone).map(function (x) { return { id: 'G', d: x.d, v: x.v, e: x.e }; });
    return mvAgreger(o, modeManches, Infinity).G;
  };
  moyennes.forEach(function (g) { g.cur = aggGroupe(g, per.from, per.to); g.pc = aggGroupe(g, per.progCur[0], per.progCur[1]); g.pp = aggGroupe(g, per.progPrev[0], per.progPrev[1]); });
  var cur = mvAgreger(mvObservations(source, ids, per.from, per.to, modeManches, zone), modeManches, minJ);
  var evo = mvAgreger(mvObservations(source, ids, per.evoFrom, per.evoTo, modeManches, zone), modeManches, minJ);
  var pc = mvAgreger(mvObservations(source, ids, per.progCur[0], per.progCur[1], modeManches, zone), modeManches, minJ);
  var pp = mvAgreger(mvObservations(source, ids, per.progPrev[0], per.progPrev[1], modeManches, zone), modeManches, minJ);
  var defs = modeManches ? MV_BLOCS_MANCHES : MV_BLOCS_JOURS;
  var blocs = [];
  var presents = Object.keys(cur);
  if (!presents.length && nCoches) notes.push(modeManches ? 'Aucune manche dans cette zone sur la période choisie.' : 'Aucune partie sur la période choisie.');
  defs.forEach(function (b) {
    var seuil = b.seuil === 'pays' ? params.seuil_pays_rounds : (b.seuil === 'prog' ? params[MV_SEUILS_PROG[per.cle]] : params[MV_SEUILS[per.cle]]);
    var rangees = [], hors = [];
    Object.keys(ids).forEach(function (id) {
      if (!ids[id] || !nom[id]) return;
      var a = cur[id], n = a ? a.n : 0, val = NaN, motif = '';
      if (b.prog) {
        var x = pc[id], y = pp[id], sp = modeManches ? params.seuil_pays_rounds : params[MV_SEUILS_PROG[per.cle]];
        if (x && y && x.n >= sp && y.n >= sp) val = x.moy - y.moy; else motif = 'pas assez de données (min ' + sp + ' de chaque côté)';
        n = x ? x.n : 0;
      } else if (a) {
        if (n >= seuil) val = b.f(a); else motif = 'n=' + n + ' (min ' + seuil + ')';
      } else motif = 'n=0 (min ' + seuil + ')';
      if (isFinite(val)) rangees.push({ id: id, nom: nom[id], equipe: equipe[id], couleur: couleur[id], val: val, n: n, evo: '–', rk: 0 });
      else hors.push({ nom: nom[id], motif: motif });
    });
    mvRangs(rangees, b.up);
    // évolution du rang : mêmes joueurs, même bloc, sur la période précédente (sauf progression)
    if (!b.prog) {
      var prev = [];
      rangees.forEach(function (r) { var q = evo[r.id]; if (q && q.n >= seuil) { var v = b.f(q); if (isFinite(v)) prev.push({ id: r.id, val: v, rk: 0 }); } });
      mvRangs(prev, b.up);
      var pr = {}; prev.forEach(function (q) { pr[q.id] = q.rk; });
      rangees.forEach(function (r) { if (pr[r.id] !== undefined) { var d = pr[r.id] - r.rk; r.evo = d > 0 ? '▲ ' + d : (d < 0 ? '▼ ' + (-d) : '•'); } });   // jamais '=' seul : Sheets le lirait comme une formule (#ERROR!)
    }
    rangees.sort(function (x, y) { return x.rk - y.rk || x.nom.localeCompare(y.nom, 'fr'); });
    var vals = rangees.map(function (r) { return r.val; });
    // lignes « moyenne » cochées : sans rang, à titre indicatif, sous le classement
    var lignesMoy = moyennes.map(function (g) {
      var v = NaN, n = g.cur ? g.cur.n : 0;
      if (b.sansMoyenne) v = NaN;
      else if (b.prog) { if (g.pc && g.pp) v = g.pc.moy - g.pp.moy; n = g.pc ? g.pc.n : 0; }
      else if (g.cur) v = b.f(g.cur);
      return { nom: g.nom, equipe: g.equipe, val: v, n: n };
    });
    // Le titre du bloc Progression précise ce qui est comparé (période précédente ou 2e moitié contre 1re moitié)
    blocs.push({ cat: b.prog ? b.cat + ' · ' + per.progLabel : b.cat, lab: b.lab, fmt: b.fmt, up: b.up, rangees: rangees, hors: hors, moyennes: lignesMoy, moyenne: mvMoy(vals), mediane: mvMediane(vals), colN: modeManches ? 'Manches' : 'Parties' });
  });
  return { vide: false, mode: modeManches ? 'manches' : 'jours', zone: zone, periode: per, blocs: blocs, notes: notes, fin: fin, debut: debut,
           titre: (modeManches ? 'Manches · ' : 'Scores du jour · ') + mvZoneLibelle(zone) };
}

// ---------------------------------------------------------------------------------------------
// Évolution : séries chronologiques (un joueur, un groupe de joueurs, ou chaque équipe)
// ---------------------------------------------------------------------------------------------
/** Début de la case de regroupement (jour, lundi de la semaine, 1er du mois) en numéro de série. */
function mvCleBucket(d, pas) {
  if (pas === 'Jour') return d;
  var dt = new Date(Date.UTC(1899, 11, 30) + d * 86400000);
  if (pas === 'Semaine') return d - ((dt.getUTCDay() + 6) % 7);
  return Math.round((Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1) - Date.UTC(1899, 11, 30)) / 86400000);
}
/** Dernier jour de la case (jour, dimanche de la semaine, dernier jour du mois) en numéro de série. */
function mvFinBucket(k, pas) {
  if (pas === 'Jour') return k;
  if (pas === 'Semaine') return k + 6;
  var dt = new Date(Date.UTC(1899, 11, 30) + k * 86400000);
  return Math.round((Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1) - Date.UTC(1899, 11, 30)) / 86400000) - 1;
}
/** Moyenne glissante (16/11/2026) : longueur de la fenêtre en jours selon le pas, et libellés. */
var MV_FENETRE = { 'Jour': 7, 'Semaine': 28, 'Mois': 91 };
var MV_FENETRE_LIB = { 'Jour': '7 j', 'Semaine': '4 sem.', 'Mois': '3 mois' };
var MV_FENETRE_TITRE = { 'Jour': 'moyenne des 7 derniers jours', 'Semaine': 'moyenne des 4 dernières semaines', 'Mois': 'moyenne des 3 derniers mois' };
function mvLibelleBucket(k, pas) {
  var dt = new Date(Date.UTC(1899, 11, 30) + k * 86400000), p = function (n) { return (n < 10 ? '0' : '') + n; };
  if (pas === 'Mois') return p(dt.getUTCMonth() + 1) + '/' + dt.getUTCFullYear();
  if (pas === 'Semaine') return 'Sem. ' + p(dt.getUTCDate()) + '/' + p(dt.getUTCMonth() + 1);
  return p(dt.getUTCDate()) + '/' + p(dt.getUTCMonth() + 1);
}
/** Axe vertical serré sur les données : [min - marge, max + marge], marge = 5 % de l'écart (au moins 1), bornes arrondies
 *  à l'entier vers l'extérieur. null si aucune valeur. */
/** Pas automatique de la courbe (menu « pas » supprimé le 09/11/2026) : par jour jusqu'à 45 jours, par semaine au-delà.
 *  (Placée ici, et non en tête de fichier : le bouton « Exécuter » de l'éditeur lance la 1re fonction, sans argument.) */
function mvPasAuto(per, debut) { return per && isFinite(per.to) ? (per.to - Math.max(per.from, debut || per.from) + 1 <= 45 ? 'Jour' : 'Semaine') : 'Semaine'; }
function mvAxeAjuste(valeurs) {
  var v = valeurs.filter(function (x) { return x !== null && x !== '' && isFinite(x); });
  if (!v.length) return null;
  var mi = Math.min.apply(null, v), ma = Math.max.apply(null, v), marge = Math.max((ma - mi) * 0.05, 1);
  return { min: Math.floor(mi - marge), max: Math.ceil(ma + marge) };
}
function mvMaxTab(a) { var m = -Infinity; for (var i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }

/**
 * Modèle d'une évolution. sel : {periode, libre1, libre2, zone, ids, critere, pas, series}
 * Retourne {vide, titre, fmt, colN, etiquettes:[...], series:[{nom, couleur, valeurs:[nombre|null], n}], resume:[...], notes}
 */
function mvEvolution(donnees, sel) {
  var notes = [], zone = mvZoneValide(donnees.manches, sel.zone || {});
  var modeManches = mvZoneActive(zone), source = modeManches ? donnees.manches : donnees.jours;
  var critere = MV_CRITERES.indexOf(sel.critere) >= 0 ? sel.critere : MV_CRITERES[0];
  var pas = MV_PAS.indexOf(sel.pas) >= 0 ? sel.pas : null;                 // null = automatique (voir mvPasAuto)
  var serie = MV_SERIES_ANCIENS[sel.series] || sel.series;
  var typeSeries = MV_SERIES.indexOf(serie) >= 0 ? serie : MV_SERIES[0];
  var tousDates = []; for (var i = 0; i < donnees.jours.length; i++) tousDates.push(donnees.jours[i].d);
  var base = { vide: true, notes: notes, zone: zone, mode: modeManches ? 'manches' : 'jours', etiquettes: [], series: [], resume: [] };
  if (!tousDates.length) { notes.push('Aucune donnée dans Moteur_Data.'); return base; }
  var fin = Math.max.apply(null, tousDates), debut = Math.min.apply(null, tousDates);
  var per = mvPeriode(sel.periode, sel.libre1, sel.libre2, fin, debut);
  if (per.note) notes.push(per.note);
  if (!pas) pas = mvPasAuto(per, debut);
  if (critere === 'Indice (zone choisie)' && !modeManches) { notes.push('« Indice » demande une zone (continent, région ou pays) : critère « Moyenne » utilisé.'); critere = 'Moyenne'; }
  var ids = sel.ids || {}, coches = [];
  var nom = {}, couleur = {}, equipe = {}, ordre = [];
  donnees.joueurs.forEach(function (j) { nom[j.id] = j.nom; couleur[j.id] = j.couleur; equipe[j.id] = j.equipe; ordre.push(j.id); });
  ordre.forEach(function (id) { if (ids[id] && nom[id]) coches.push(id); });
  // 09/11/2026 : sel.moyennes = lignes « moyenne » cochées (équipes, tous) -> une courbe chacune, en plus d'une courbe par joueur coché
  var moyennes = sel.moyennes ? mvGroupesMoyennes(donnees.joueurs, sel.moyennes) : null;
  if (!coches.length && !(moyennes && moyennes.length)) { notes.push('Rien de coché : coche au moins un joueur ou une moyenne dans la liste.'); return base; }
  var idsObs = {}; coches.forEach(function (id) { idsObs[id] = true; });
  (moyennes || []).forEach(function (g) { g.membres.forEach(function (id) { idsObs[id] = true; }); });
  var obs = mvObservations(source, idsObs, per.from, per.to, modeManches, zone);
  if (!obs.length) { notes.push(modeManches ? 'Aucune manche dans cette zone sur la période choisie.' : 'Aucune partie sur la période choisie.'); return base; }
  // groupes de joueurs = séries
  var groupes = [];
  if (moyennes) {
    coches.forEach(function (id) { groupes.push({ nom: nom[id], couleur: couleur[id], membres: [id] }); });
    moyennes.forEach(function (g) { groupes.push({ nom: g.nom, couleur: g.couleur, membres: g.membres }); });
  }
  else if (typeSeries === MV_SERIES[0]) coches.forEach(function (id) { groupes.push({ nom: nom[id], couleur: couleur[id], membres: [id] }); });
  else if (typeSeries === MV_SERIES[2]) groupes.push({ nom: 'Moyenne des ' + coches.length + ' joueur(s) cochés', couleur: MV_COULEURS_SERIE[0], membres: coches });
  else {
    var vus = [];
    coches.forEach(function (id) { if (vus.indexOf(equipe[id]) < 0) vus.push(equipe[id]); });
    vus.forEach(function (eq, k) {
      groupes.push({ nom: eq || 'Sans équipe', couleur: MV_COULEUR_EQUIPE[eq] || MV_COULEURS_SERIE[k % MV_COULEURS_SERIE.length], membres: coches.filter(function (id) { return equipe[id] === eq; }) });
    });
  }
  // cases chronologiques
  var cles = [], vu = {};
  obs.forEach(function (o) { var k = mvCleBucket(o.d, pas); if (!vu[k]) { vu[k] = 1; cles.push(k); } });
  cles.sort(function (a, b) { return a - b; });
  var series = [], resume = [], fenetre = MV_FENETRE[pas];
  var valeurObs = critere === 'Indice (zone choisie)' ? function (o) { return o.e; } : function (o) { return o.v; };
  groupes.forEach(function (g) {
    var membre = {}; g.membres.forEach(function (id) { membre[id] = true; });
    var parCase = {}, total = 0;
    obs.forEach(function (o) { if (!membre[o.id]) return; var k = mvCleBucket(o.d, pas); (parCase[k] = parCase[k] || []).push(o); total++; });
    var moyennes = [], cumul = [], somme = 0, n = 0;
    cles.forEach(function (k) {
      var l = parCase[k] || [];
      var vs = l.map(function (o) { return o.v; });
      moyennes.push(vs.length ? mvMoy(vs) : null);
      for (var i = 0; i < vs.length; i++) { somme += vs[i]; n++; }
      cumul.push(n ? somme / n : null);
    });
    var vals = [];
    cles.forEach(function (k, idx) {
      var l = parCase[k] || [], v = null;
      if (critere === 'Moyenne') v = moyennes[idx];
      else if (critere === 'Moyenne cumulée') v = cumul[idx];
      else if (critere === 'Meilleur score') v = l.length ? mvMaxTab(l.map(function (o) { return o.v; })) : null;
      else if (critere === 'Indice (zone choisie)') { var es = l.filter(function (o) { return isFinite(o.e); }).map(function (o) { return o.e; }); v = es.length ? mvMoy(es) : null; }
      else if (critere === 'Moyenne glissante (3 points)') {
        if (moyennes[idx] !== null) {
          var fen = [];
          for (var j = idx; j >= 0 && fen.length < 3; j--) if (moyennes[j] !== null) fen.push(moyennes[j]);
          v = mvMoy(fen);
        }
      }
      vals.push(v);
    });
    var pts = vals.filter(function (v) { return v !== null; });
    // 16/11/2026 : moyenne glissante calculée sur les parties (pas sur les moyennes de cases) : à chaque case, moyenne de toutes
    // les parties du groupe des F derniers jours jusqu'à la fin de la case (F = 28 jours par semaine, 7 jours par jour).
    var mesObs = obs.filter(function (o) { return membre[o.id] && isFinite(valeurObs(o)); });
    var glissante = cles.map(function (k) {
      var f = mvFinBucket(k, pas), d0 = f - fenetre + 1, s = 0, c = 0;
      for (var i = 0; i < mesObs.length; i++) if (mesObs[i].d >= d0 && mesObs[i].d <= f) { s += valeurObs(mesObs[i]); c++; }
      return c ? s / c : null;
    });
    // Récapitulatif : début = moyenne des F premiers jours joués, fin = moyenne des F derniers (fenêtre réduite à la moitié de
    // l'étendue du groupe si elle est plus courte, pour que les deux fenêtres ne se chevauchent pas). Plus de comparaison de deux cases isolées.
    var debutR = NaN, finR = NaN;
    if (mesObs.length) {
      var dMin = Infinity, dMax = -Infinity;
      mesObs.forEach(function (o) { if (o.d < dMin) dMin = o.d; if (o.d > dMax) dMax = o.d; });
      var fr = Math.max(1, Math.min(fenetre, Math.floor((dMax - dMin + 1) / 2)));
      debutR = mvMoy(mesObs.filter(function (o) { return o.d <= dMin + fr - 1; }).map(valeurObs));
      finR = mvMoy(mesObs.filter(function (o) { return o.d >= dMax - fr + 1; }).map(valeurObs));
    }
    series.push({ nom: g.nom, couleur: g.couleur, valeurs: vals, glissante: glissante, n: total });
    resume.push({ nom: g.nom, points: pts.length, n: total, debut: debutR, fin: finR, delta: pts.length > 1 ? finR - debutR : NaN });
  });
  var fmt = critere === 'Indice (zone choisie)' ? '+0.0;-0.0;0.0' : '0.0';
  // Axe vertical (06/11/2026) : de la plus petite à la plus grande valeur présente, avec une petite marge (voir mvAxeAjuste).
  // La courbe recalcule l'axe sur les valeurs réellement tracées (tendance et/ou points) : voir mvDessinerCourbe.
  var tous = []; series.forEach(function (s) { s.valeurs.forEach(function (v) { if (v !== null) tous.push(v); }); });
  var axe = mvAxeAjuste(tous);
  var unite = critere === 'Indice (zone choisie)' ? 'Indice (écart en points)' : (modeManches ? 'Score de manche (/100)' : 'Score du jour (/1000)');
  return { vide: false, axe: axe, unite: unite, fenetre: fenetre, fenetreLib: MV_FENETRE_LIB[pas], fenetreTitre: MV_FENETRE_TITRE[pas], mode: base.mode, zone: zone, periode: per, critere: critere, pas: pas, typeSeries: typeSeries, fmt: fmt, colN: modeManches ? 'Manches' : 'Parties',
           etiquettes: cles.map(function (k) { return mvLibelleBucket(k, pas); }), series: series, resume: resume, notes: notes,
           titre: 'Évolution · ' + critere + ' · par ' + pas.toLowerCase() + ' · ' + (modeManches ? 'manches ' : 'scores du jour · ') + mvZoneLibelle(zone) };
}
/**
 * Courbe de tendance : ajuste un polynôme (degré 1 à 3 selon le nombre de points) sur les points non vides de la série
 * et renvoie la valeur ajustée à chaque case entre le premier et le dernier point (null en dehors).
 * Les valeurs sont bornées entre le min et le max observés, pour éviter les dépassements en bord de courbe.
 */
function mvTendance(ys) {
  var idx = [], i, j, k;
  for (i = 0; i < ys.length; i++) if (ys[i] !== null && isFinite(ys[i])) idx.push(i);
  var m = idx.length, out = ys.map(function () { return null; });
  if (m < 2) { idx.forEach(function (q) { out[q] = ys[q]; }); return out; }
  var deg = Math.min(m - 1, m >= 12 ? 3 : (m >= 5 ? 2 : 1));
  var x0 = idx[0], span = (idx[m - 1] - x0) || 1, n = deg + 1;
  var A = [], b = [];
  for (i = 0; i < n; i++) { A.push(new Array(n).fill(0)); b.push(0); }
  idx.forEach(function (q) {
    var t = (q - x0) / span, pw = [1];
    for (i = 1; i < 2 * n; i++) pw.push(pw[i - 1] * t);
    for (i = 0; i < n; i++) { b[i] += ys[q] * pw[i]; for (j = 0; j < n; j++) A[i][j] += pw[i + j]; }
  });
  for (i = 0; i < n; i++) {                                   // élimination de Gauss avec pivot partiel
    var piv = i;
    for (k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[piv][i])) piv = k;
    if (Math.abs(A[piv][i]) < 1e-12) { idx.forEach(function (q) { out[q] = ys[q]; }); return out; }
    var tmp = A[i]; A[i] = A[piv]; A[piv] = tmp; var tb = b[i]; b[i] = b[piv]; b[piv] = tb;
    for (k = i + 1; k < n; k++) { var f = A[k][i] / A[i][i]; for (j = i; j < n; j++) A[k][j] -= f * A[i][j]; b[k] -= f * b[i]; }
  }
  var c = new Array(n).fill(0);
  for (i = n - 1; i >= 0; i--) { var sm = b[i]; for (j = i + 1; j < n; j++) sm -= A[i][j] * c[j]; c[i] = sm / A[i][i]; }
  var lo = Infinity, hi = -Infinity;
  idx.forEach(function (q) { if (ys[q] < lo) lo = ys[q]; if (ys[q] > hi) hi = ys[q]; });
  for (var q2 = idx[0]; q2 <= idx[m - 1]; q2++) {
    var t2 = (q2 - x0) / span, v = 0;
    for (i = n - 1; i >= 0; i--) v = v * t2 + c[i];
    out[q2] = Math.min(hi, Math.max(lo, v));
  }
  return out;
}
var MV_COULEURS_SERIE = ['#4285F4', '#FF70D5', '#F4B400', '#0F9D58', '#DD7E6B', '#9C27B0'];
var MV_COULEUR_EQUIPE = { 'Sororité': '#FF70D5', 'Fraternité': '#4285F4' };   // courbes d'équipe aux couleurs de la page Jeu en cours
