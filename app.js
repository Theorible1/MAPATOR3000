/* Page publique MapTap : affichage. Les calculs des vues viennent de moteur.js = copie exacte de apps_script/Core.gs
   (mêmes fonctions que les vues du tableur : mvConstruire, mvEvolution...). Le résumé « Jeu en cours » est calculé par le bot
   (jeu_en_cours.py) et lu tel quel dans donnees/maptap.json. */
"use strict";

const URL_DONNEES = "donnees/maptap.json";
const CLE_VUE = "maptap.vue", CLE_JOUEUR = "maptap.joueur", CLE_REPLIS = "maptap.replis";

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const fini = v => v !== null && v !== undefined && v !== "" && isFinite(v);
// Formats de Core.gs : '0', '0.0', '+0.0;-0.0;0.0', '0%'
function fmt(v, f = "0.0") {
  if (!fini(v)) return "–";
  if (f === "0%") return Math.round(v * 100) + " %";
  const dec = f.indexOf(".0") >= 0 ? 1 : 0;
  if (Math.round(Math.abs(v) * 10 ** dec) === 0) v = 0;          // pas de « -0,0 »
  const s =Number(v).toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return f.charAt(0) === "+" && Math.round(v * 10) > 0 ? "+" + s : s;
}
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const dateLongue = iso => { const [a, m, j] = iso.split("-"); return Number(j) + (j === "01" ? "er" : "") + " " + MOIS[Number(m) - 1] + " " + a; };
const lire = (cle, defaut) => { try { const v = JSON.parse(localStorage.getItem(cle)); return v == null ? defaut : v; } catch (e) { return defaut; } };
const ecrire = (cle, v) => { try { localStorage.setItem(cle, JSON.stringify(v)); } catch (e) { /* mémoire refusée : vaut pour cette visite */ } };

let DOC, DONNEES, R, JOUEURS = [], NOM = {}, COUL = {}, EQ = {}, EQUIPES = [];
const couleurEquipe = e => MV_COULEUR_EQUIPE[e] || "var(--accent)";
const pastille = c => `<span class="pastille" style="background:${esc(c)}"></span>`;
const qui = id => `<span class="nom">${pastille(COUL[id] || "var(--accent)")}${esc(NOM[id] || id)}</span>`;

// Titre de bloc : icône (dessins de Quentin, page\images\ic_*.webp), nom en gros, précision en petit, « i » qui ouvre une bulle.
function titre(texte, detail, info, ico) {
  return (ico ? `<img class="ico" src="images/ic_${ico}.webp" alt="" width="24" height="24">` : "") + esc(texte) +(detail ? ` <small class="glose">(${esc(detail)})</small>` : "")
    + (info ? ` <span class="info" tabindex="0" role="note" aria-label="${esc(info)}" data-info="${esc(info)}">i</span>` : "");
}
function placerBulle(ev) {
  const i = ev.target.closest && ev.target.closest(".info"); if (!i) return;
  i.classList.toggle("vers-gauche", i.getBoundingClientRect().left > innerWidth / 2);
}
document.addEventListener("mouseover", placerBulle);
document.addEventListener("focusin", placerBulle);

// Blocs enroulables (clic sur le titre), état gardé dans le navigateur de chacun.
function appliquerReplis() {
  const memo = lire(CLE_REPLIS, {});
  document.querySelectorAll("section.carte[data-sec]").forEach(s => {
    const k = s.dataset.sec;
    s.classList.toggle("replie", k in memo ? memo[k] : s.dataset.replie === "1");
    const h = s.querySelector(":scope > h2");
    if (h) { h.setAttribute("role", "button"); h.tabIndex = 0; h.setAttribute("aria-expanded", String(!s.classList.contains("replie"))); }
  });
}
function basculer(h) {
  const s = h.parentElement, memo = lire(CLE_REPLIS, {});
  s.classList.toggle("replie");
  memo[s.dataset.sec] = s.classList.contains("replie");
  h.setAttribute("aria-expanded", String(!memo[s.dataset.sec]));
  ecrire(CLE_REPLIS, memo);
}
document.addEventListener("click", ev => {
  if (ev.target.closest(".info")) return;
  const h = ev.target.closest("section.carte[data-sec] > h2"); if (h) basculer(h);
});
document.addEventListener("keydown", ev => {
  if (ev.target.closest && ev.target.closest(".info")) return;
  const h = ev.target.closest && ev.target.closest("section.carte[data-sec] > h2");
  if (h && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); basculer(h); }
});

function puces(id, options, actif) {
  return `<div class="puces" id="${id}">${options.map(([v, l]) =>
    `<button type="button" data-v="${esc(v)}" class="${String(v) === String(actif) ? "on" : ""}">${esc(l)}</button>`).join("")}</div>`;
}
function options(liste, actif, libelle = x => x) {
  return liste.map(v => `<option value="${esc(v)}"${String(v) === String(actif) ? " selected" : ""}>${esc(libelle(v))}</option>`).join("");
}

// ───────────── graphique (plusieurs séries) ─────────────

// Tracé lissé (cubique monotone, Fritsch-Carlson) : arrondi entre les points sans dépasser les valeurs réelles.
function cheminLisse(p) {
  const r = v => Math.round(v * 10) / 10;
  if (p.length === 1) return "";
  if (p.length < 3) return "M" + p.map(([x, y]) => r(x) + " " + r(y)).join(" L");
  const n = p.length, d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let c = "M" + r(p[0][0]) + " " + r(p[0][1]);
  for (let i = 0; i < n - 1; i++) {
    const h = (p[i + 1][0] - p[i][0]) / 3;
    c += ` C${r(p[i][0] + h)} ${r(p[i][1] + m[i] * h)} ${r(p[i + 1][0] - h)} ${r(p[i + 1][1] - m[i + 1] * h)} ${r(p[i + 1][0])} ${r(p[i + 1][1])}`;
  }
  return c;
}

/* series : [{nom, couleur, points:[valeur|null], ligne:[valeur|null]}] ; etiquettes : libellés de l'axe horizontal.
   points = petits ronds (valeur de chaque case) ; ligne = trait lissé (moyenne glissante, ou la valeur elle-même). */
function graphique(etiquettes, series, { f = "0.0", infoLigne = "" } = {}) {
  const L = 900, H = 330, g = 46, d = 14, h = 14, b = 30, n = etiquettes.length;
  const tout = []; series.forEach(s => { s.points.concat(s.ligne).forEach(v => { if (fini(v)) tout.push(v); }); });
  if (!tout.length) return `<div class="vide">Rien à tracer.</div>`;
  const axe = mvAxeAjuste(tout), lo = axe.min, hi = axe.max === axe.min ? axe.min + 1 : axe.max;
  const X = i => g + (n === 1 ? (L - g - d) / 2 : i * (L - g - d) / (n - 1));
  const Y = v => H - b - (v - lo) / (hi - lo) * (H - h - b);
  const grad = []; for (let k = 0; k <= 4; k++) grad.push(lo + k * (hi - lo) / 4);
  const pasX = Math.max(1, Math.ceil(n / 8));
  const id = "g" + Math.random().toString(36).slice(2);
  const segments = vals => {           // trait lissé par morceaux continus (une case vide coupe le trait)
    const out = []; let cur = [];
    vals.forEach((v, i) => { if (fini(v)) cur.push([X(i), Y(v)]); else { if (cur.length) out.push(cur); cur = []; } });
    if (cur.length) out.push(cur);
    return out.map(cheminLisse).join(" ");
  };
  const larg = (L - g - d) / Math.max(1, n - 1);
  const svg = `<svg viewBox="0 0 ${L} ${H}" role="img" aria-label="graphique">
    ${grad.map(v => `<line class="grille-l" x1="${g}" x2="${L - d}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axe" x="${g - 7}" y="${Y(v) + 4}" text-anchor="end">${fmt(v, Math.abs(hi - lo) < 8 ? "0.0" : "0")}</text>`).join("")}
    ${etiquettes.map((e, i) => (i % pasX === 0 && n - 1 - i >= pasX * 0.6) || i === n - 1 ? `<text class="axe" x="${X(i)}" y="${H - 9}" text-anchor="middle">${esc(e)}</text>` : "").join("")}
    <line class="repere" y1="${h}" y2="${H - b}"/>
    ${series.map(s => `<g>
      ${s.points.map((v, i) => fini(v) ? `<circle cx="${X(i)}" cy="${Y(v)}" r="${n > 60 ? 1.8 : 3}" fill="${esc(s.couleur)}" opacity=".45"/>` : "").join("")}
      <path d="${segments(s.ligne)}" fill="none" stroke="${esc(s.couleur)}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
      ${s.ligne.map((v, i) => fini(v) && !fini(s.ligne[i - 1]) && !fini(s.ligne[i + 1]) ? `<circle cx="${X(i)}" cy="${Y(v)}" r="3.5" fill="${esc(s.couleur)}"/>` : "").join("")}
    </g>`).join("")}
    ${etiquettes.map((e, i) => `<rect class="cible" data-i="${i}" x="${X(i) - larg / 2}" y="0" width="${larg}" height="${H}"/>`).join("")}
  </svg>`;
  setTimeout(() => {
    const boite = document.getElementById(id); if (!boite) return;
    const bulle = boite.querySelector(".infobulle"), s = boite.querySelector("svg"), rep = boite.querySelector(".repere");
    const montrer = ev => {
      const t = ev.target.closest && ev.target.closest(".cible"); if (!t) return cacher();
      const i = Number(t.dataset.i), k = s.getBoundingClientRect().width / L;
      bulle.innerHTML = `<b>${esc(etiquettes[i])}</b>` + series.map(x => {
        const p = x.points[i], l = x.ligne[i];
        if (!fini(p) && !fini(l)) return "";
        return `<div>${pastille(x.couleur)}${esc(x.nom)} : ${fmt(fini(p) ? p : l, f)}${infoLigne && fini(l) && x.ligne !== x.points ? ` <span class="petit">(${esc(infoLigne)} ${fmt(l, f)})</span>` : ""}</div>`;
      }).join("");
      bulle.style.display = "block";
      const x = X(i) * k, w = bulle.offsetWidth, W = boite.clientWidth;
      bulle.style.left = Math.max(0, Math.min(W - w, x - w / 2)) + "px"; bulle.style.top = "-8px";
      rep.setAttribute("x1", X(i)); rep.setAttribute("x2", X(i)); rep.style.display = "block";
    };
    const cacher = () => { bulle.style.display = "none"; rep.style.display = "none"; };
    s.addEventListener("mousemove", montrer); s.addEventListener("click", montrer);
    s.addEventListener("mouseleave", cacher);
  });
  return `<div class="graphe" id="${id}">${svg}<div class="infobulle"></div></div>
    <div class="legende">${series.map(x => `<span>${pastille(x.couleur)}${esc(x.nom)}</span>`).join("")}</div>`;
}

// ───────────── onglet « Résumé » (page Jeu en cours du tableur) ─────────────

// Podium à 4 marches (badges dessinés par Quentin) : les marches suivent les vrais rangs jusqu'au 4e ; à égalité, les joueurs
// partagent une marche (même règle que la page Deathlist). lignes : [{rang, id}] ; valeur : texte affiché sous le nom.
const PLACES = ["1re place", "2e place", "3e place", "4e place"];
// Libellés courts des catégories de médailles (clés de jeu_en_cours.ETAGES)
const COURT_ETAGE = { jour: "Du jour", semaine: "De la semaine", mois: "Du mois", ind_mois: "Indicateurs du mois",
  indicateurs: "Indicateurs (tout l'historique)", prog_semaine: "Progression de la semaine", prog_mois: "Progression du mois" };
function podium(lignes, valeur) {
  const rangs = [...new Set(lignes.map(l => l.rang))].filter(r => r >= 1 && r <= 4).sort((a, b) => a - b);
  if (!rangs.length) return "";
  const marches = rangs.map(r => lignes.filter(l => l.rang === r));
  return `<div class="podium" style="grid-template-columns:repeat(${marches.length},minmax(0,1fr))">${marches.map((ls, i) => {
    const r = ls[0].rang;
    return `<div class="marche r${i + 1}"><div class="med"><img src="images/podium_${r}.webp" alt="${PLACES[r - 1]}" loading="lazy"></div>
      <div class="qui">${ls.map(l => esc(NOM[l.id] || l.id)).join(", ")}</div>
      <div class="combien">${r}${r === 1 ? "er" : "e"}${ls.length > 1 ? " ex aequo" : ""} · ${valeur(ls[0])}</div></div>`;
  }).join("")}</div>`;
}
const podiumLigne = (ligne, f) => ligne ? podium(ligne.classement.filter(r => r.classe), r => fmt(r.valeur, f)) : "";

function tableClassement(ligne, { colN = false, f = "0" } = {}) {
  if (!ligne || !ligne.classement.length) return `<div class="vide">Personne n'a joué.</div>`;
  return `<table><thead><tr><th>#</th><th>Joueur</th><th class="num">${f === "0" ? "Score" : "Moyenne"}</th>${colN ? `<th class="num">Parties</th>` : ""}</tr></thead><tbody>
    ${ligne.classement.map(r => `<tr class="${r.classe ? "" : "hors"}"><td class="rang">${r.classe ? r.rang : "–"}</td><td>${qui(r.id)}</td>
      <td class="num">${fmt(r.valeur, f)}</td>${colN ? `<td class="num">${r.n}${r.classe ? "" : " (pas classé)"}</td>` : ""}</tr>`).join("")}
  </tbody></table>${moyEquipes(ligne, f)}`;
}
function moyEquipes(ligne, f) {
  const e = EQUIPES.map(x => `${MV_EMOJI_EQUIPE[x] || ""} ${esc(x)} ${fmt(ligne.moy_equipes[x], f === "0" ? "0.0" : f)}`).join(" · ");
  return `<div class="pied">${e}${ligne.gagnante ? `<br><b class="gagnante">Gagnante : ${esc(ligne.gagnante)}</b>` : (ligne.en_cours ? "" : " · pas de gagnante")}</div>`;
}
const libEnCours = l => l.en_cours ? ` <span class="badge direct">en cours</span>` : "";

function vueResume() {
  const eq = R.equipes, [e1, e2] = EQUIPES;
  const tuileEquipe = e => {
    const x = eq[e], y = eq[e === e1 ? e2 : e1] || {};
    const ligne = (lib, k, f = "0.0") => `<dt>${lib}</dt><dd class="${fini(x[k]) && fini(y[k]) && x[k] > y[k] ? "mieux" : ""}">${fmt(x[k], f)}</dd>`;
    return `<div class="equipe" style="--eq:${couleurEquipe(e)}"><h3>${MV_EMOJI_EQUIPE[e] || ""} ${esc(e)} <span class="badge neutre">${x.joueurs} joueurs</span></h3>
      <dl>${ligne("Moyenne du jour", "jour")}${ligne("Moyenne de la semaine", "semaine")}${ligne("Moyenne du mois", "mois")}${ligne("Moyenne depuis le début", "totale")}
      ${ligne("Jours gagnés", "v_jours", "0")}${ligne("Semaines gagnées", "v_semaines", "0")}${ligne("Mois gagnés", "v_mois", "0")}</dl></div>`;
  };
  const etages = R.etages.map(([cle, t]) => [cle, t]);
  const ordreMed = Object.keys(R.total).sort((a, b) => R.total[b][3] - R.total[a][3] || R.total[b][0] - R.total[a][0]);
  // rang aux points (égalités au même rang), pour le podium et l'ordre des cartes
  const rangsMedailles = ordreMed.map(id => ({ id, rang: 1 + ordreMed.filter(j => R.total[j][3] > R.total[id][3]).length }));
  const trio = v => `<span class="m">🥇&nbsp;${v[0]}</span><span class="m">🥈&nbsp;${v[1]}</span><span class="m">🥉&nbsp;${v[2]}</span>`;
  return `
  <section class="carte"><h2>${titre("La bataille des hémisphères", "Sororité vs Fraternité", "Moyenne d'équipe = moyenne de toutes les parties des joueurs de l'équipe. Une équipe gagne un jour, une semaine ou un mois terminé quand sa moyenne est la meilleure.", "boussole")}</h2>
    ${e1 && e2 ? `<div class="score-duel"><span style="color:${couleurEquipe(e1)}">${eq[e1].v_jours}</span><small>jours gagnés</small><span style="color:${couleurEquipe(e2)}">${eq[e2].v_jours}</span></div>` : ""}
    <div class="duel">${EQUIPES.map(tuileEquipe).join("")}</div></section>
  <div class="grille">
    <section class="carte" data-sec="jour"><h2>${titre("Le point GPS du jour", "partie du " + (R.jour ? R.jour.libelle : ""), "", "repere")}${R.jour ? libEnCours(R.jour) : ""}</h2>${podiumLigne(R.jour, "0")}${tableClassement(R.jour)}</section>
    <section class="carte" data-sec="mois"><h2>${titre("Le tour du monde en 30 jours", "classement de " + (R.mois ? R.mois.libelle.toLowerCase() : "ce mois"), "Classement à la moyenne du mois. " + (R.regles[3] || ""), "drapeau")}${R.mois ? libEnCours(R.mois) : ""}</h2>${podiumLigne(R.mois, "0.0")}${tableClassement(R.mois, { colN: true, f: "0.0" })}</section>
  </div>
  <section class="carte" data-sec="general"><h2>${titre("Le grand atlas", "classement général depuis le début", "Rang à la moyenne de toutes les parties. « 30 dernières » = moyenne des 30 dernières parties du joueur.", "globe")}</h2>
    ${podium(R.individuel, x => fmt(x.moyenne))}
    <div class="defil"><table><thead><tr><th>#</th><th>Joueur</th><th class="num">Moyenne</th><th class="num">30 dernières</th><th class="num">Meilleur</th><th class="num">Pire</th><th class="num">Parties</th></tr></thead><tbody>
    ${R.individuel.map(x => `<tr><td class="rang">${x.rang}</td><td>${qui(x.id)}</td><td class="num"><b>${fmt(x.moyenne)}</b></td><td class="num">${fmt(x.dernieres)}</td>
      <td class="num">${fmt(x.meilleur, "0")}</td><td class="num">${fmt(x.pire, "0")}</td><td class="num">${x.n}</td></tr>`).join("")}
    </tbody></table></div></section>
  <section class="carte" data-sec="medailles"><h2>${titre("Les médailles d'or-ientation", "médailles : or 3 points, argent 2, bronze 1", R.regles.join("\n"), "rose")}</h2>
    ${podium(rangsMedailles, x => R.total[x.id][3] + " pts")}
    <div class="cartes-med">${rangsMedailles.map(x => {
      const t = R.total[x.id];
      const lignes = etages.map(([cle]) => [cle, R.medailles[cle][x.id] || [0, 0, 0]]).filter(([, v]) => v[0] + v[1] + v[2]);
      return `<div class="carte-med"><div class="tete-med"><span class="rang-med">${x.rang}</span>${qui(x.id)}<span class="pts-med">${t[3]} <small>pts</small></span></div>
        <div class="totaux-med">${trio(t)}</div>
        ${lignes.length ? `<table class="detail-med"><tbody>${lignes.map(([cle, v]) => `<tr><td>${esc(COURT_ETAGE[cle] || cle)}</td><td class="mc">🥇&nbsp;${v[0]}</td><td class="mc">🥈&nbsp;${v[1]}</td><td class="mc">🥉&nbsp;${v[2]}</td></tr>`).join("")}</tbody></table>` : `<div class="petit">Pas encore de médaille.</div>`}
      </div>`;
    }).join("")}</div></section>
  <section class="carte" data-sec="semaines"><h2>${titre("Les dernières escales", "4 dernières semaines terminées, classement à la moyenne", R.regles[1] || "", "carte")}</h2>
    <div class="grille semaines">${R.semaines.filter(s => !s.en_cours).slice(0, 4).map(s => `<div><h3>Semaine ${esc(s.libelle.replace(/^S0?/, ""))}</h3>${tableClassement(s, { colN: true, f: "0.0" })}</div>`).join("")}</div></section>
  <section class="carte" data-sec="jours" data-replie="1"><h2>${titre("Le carnet de bord", "les 4 jours d'avant", "", "jumelles")}</h2>
    <div class="grille semaines">${R.jours_avant.slice(0, 4).map(j => `<div><h3>${esc(j.libelle)}</h3>${tableClassement(j)}</div>`).join("")}</div></section>`;
}

// ───────────── onglet « Joueurs » ─────────────

function vueJoueur() {
  const ids = JOUEURS.filter(j => j.actif).map(j => j.id);
  let id = lire(CLE_JOUEUR, ids[0]); if (ids.indexOf(id) < 0) id = ids[0];
  return `<section class="carte"><div class="choix-joueur"><label for="choix-joueur">Joueur</label>
    <select id="choix-joueur">${options(ids, id, x => NOM[x])}</select></div></section><div id="fiche" class="reglages"></div>`;
}
function fiche() {
  const id = document.getElementById("choix-joueur").value; ecrire(CLE_JOUEUR, id);
  const ind = R.individuel.find(x => x.id === id), tot = R.total[id] || [0, 0, 0, 0];
  const seuil = DONNEES.params.seuil_pays_rounds;
  // forme récente : les 10 dernières parties, avec la place du jour
  const parJour = {}; DONNEES.jours.forEach(o => { (parJour[o.d] = parJour[o.d] || []).push(o); });
  const miennes = DONNEES.jours.filter(o => o.id === id).sort((a, b) => b.d - a.d).slice(0, 10).map(o => {
    const l = parJour[o.d], rang = 1 + l.filter(x => x.total > o.total).length;
    return { d: o.d, total: o.total, rang, nb: l.length };
  });
  // évolution : le joueur et la moyenne de tous, sur toute la période (mêmes calculs que la vue « Évolution » du tableur)
  const ev = mvEvolution(DONNEES, { periode: "Tout", zone: {}, ids: { [id]: true }, critere: "Moyenne", pas: "Semaine", moyennes: ["*"] });
  // continents et pays (manches de ce joueur)
  const zones = cle => {
    const g = {}; DONNEES.manches.forEach(m => { if (m.id !== id) return; const k = m[cle]; (g[k] = g[k] || []).push(m); });
    return Object.keys(g).map(k => ({ k, n: g[k].length, moy: mvMoy(g[k].map(m => m.s)), indice: mvMoy(g[k].map(m => m.ecart).filter(fini)) }));
  };
  const conts = zones("cont").sort((a, b) => b.moy - a.moy);
  const pays = zones("pays").filter(p => p.n >= seuil).sort((a, b) => b.indice - a.indice);
  const tPays = l => l.length ? `<table><thead><tr><th>Pays</th><th class="num">Manches</th><th class="num">Moyenne</th><th class="num">Indice</th></tr></thead><tbody>
    ${l.map(p => `<tr><td>${esc(p.k)}</td><td class="num">${p.n}</td><td class="num">${fmt(p.moy)}</td><td class="num">${fmt(p.indice, "+0.0;-0.0;0.0")}</td></tr>`).join("")}</tbody></table>` : `<div class="vide">Pas assez de manches.</div>`;
  const infoIndice = "Indice = écart moyen entre le score de la manche et le niveau habituel du joueur à cette position de manche. Positif : meilleur que d'habitude dans ce pays. Pays comptés à partir de " + seuil + " manches.";
  document.getElementById("fiche").innerHTML = `
  <div class="kpis">
    <div class="tuile-kpi"><div class="lib">Rang général</div><div class="val">${ind ? ind.rang : "–"}<small>${ind && ind.rang === 1 ? "er" : "e"}</small></div><div class="note">à la moyenne</div></div>
    <div class="tuile-kpi"><div class="lib">Moyenne</div><div class="val">${ind ? fmt(ind.moyenne) : "–"}</div><div class="note">${ind ? ind.n : 0} parties</div></div>
    <div class="tuile-kpi"><div class="lib">30 dernières</div><div class="val">${ind ? fmt(ind.dernieres) : "–"}</div><div class="note">${ind && fini(ind.dernieres - ind.moyenne) ? fmt(ind.dernieres - ind.moyenne, "+0.0;-0.0;0.0") + " vs sa moyenne" : ""}</div></div>
    <div class="tuile-kpi"><div class="lib">Meilleur / pire</div><div class="val">${ind ? fmt(ind.meilleur, "0") : "–"} <small>/ ${ind ? fmt(ind.pire, "0") : "–"}</small></div></div>
    <div class="tuile-kpi"><div class="lib">Médailles</div><div class="val">${tot[3]} <small>pts</small></div><div class="note">🥇${tot[0]} 🥈${tot[1]} 🥉${tot[2]}</div></div>
  </div>
  <section class="carte"><h2>${titre("La courbe de niveau", "évolution par semaine", "Points : moyenne de chaque semaine. Trait : moyenne glissante sur 4 semaines, calculée sur les parties (comme dans le tableur).", "boussole")}</h2>
    ${ev.vide ? `<div class="vide">${esc(ev.notes.join(" "))}</div>` : graphique(ev.etiquettes, ev.series.map(s => ({ nom: s.nom, couleur: s.couleur, points: s.valeurs, ligne: s.glissante })), { infoLigne: "4 sem." })}</section>
  <div class="grille deux">
    <section class="carte"><h2>${titre("Le journal de bord", "10 dernières parties", "", "repere")}</h2><table><thead><tr><th>Date</th><th class="num">Score</th><th class="num">Place du jour</th></tr></thead><tbody>
      ${miennes.map(m => `<tr><td>${mvLibelleDate(m.d)}</td><td class="num"><b>${m.total}</b></td><td class="num">${m.rang}${m.rang === 1 ? "er" : "e"} sur ${m.nb}</td></tr>`).join("")}</tbody></table></section>
    <section class="carte"><h2>${titre("Le tour des continents", "résultats par continent", infoIndice, "globe")}</h2><table><thead><tr><th>Continent</th><th class="num">Manches</th><th class="num">Moyenne /100</th><th class="num">Indice</th></tr></thead><tbody>
      ${conts.map(p => `<tr><td>${esc(p.k)}</td><td class="num">${p.n}</td><td class="num">${fmt(p.moy)}</td><td class="num">${fmt(p.indice, "+0.0;-0.0;0.0")}</td></tr>`).join("")}</tbody></table></section>
  </div>
  <div class="grille deux">
    <section class="carte"><h2>${titre("Terres conquises", "ses 5 meilleurs pays", infoIndice, "drapeau")}</h2>${tPays(pays.slice(0, 5))}</section>
    <section class="carte"><h2>${titre("Son triangle des Bermudes", "ses 5 pays pièges", infoIndice, "montagne")}</h2>${tPays(pays.slice(-5).reverse())}</section>
  </div>
  <section class="carte"><h2>${titre("Le butin de l'explorateur", "médailles par catégorie", "", "rose")}</h2><table><tbody>
    ${R.etages.map(([cle, t]) => { const v = R.medailles[cle][id] || [0, 0, 0]; return `<tr><td>${esc(t)}</td><td class="med num">🥇${v[0]} 🥈${v[1]} 🥉${v[2]}</td></tr>`; }).join("")}
  </tbody></table></section>`;
}

// ───────────── onglet « Vue à la carte » (vue du tableur) ─────────────

const DEFAUT_VUE = () => ({ affichage: "Classements", periode: "30 derniers jours", libre1: "", libre2: "", zone: {}, critere: "Moyenne", pas: "",
  ids: Object.fromEntries(JOUEURS.filter(j => j.actif).map(j => [j.id, true])), moyennes: [] });
let S;
const isoVersFr = iso => iso ? iso.split("-").reverse().join("/") : "";
const frVersIso = fr => fr ? fr.split("/").reverse().join("-") : "";

function vueCarte() {
  const z = mvZoneValide(DONNEES.manches, S.zone || {}); S.zone = z;
  const l = mvListesZone(DONNEES.manches, z.continent, z.region);
  const evol = S.affichage === "Évolution";
  return `<section class="carte reglages">
    <div class="ligne-reglages">${puces("p-affichage", MV_AFFICHAGES.map(a => [a, a]), S.affichage)}</div>
    <div class="ligne-reglages">
      <label>Période<select id="r-periode">${options(MV_PERIODES, S.periode, p => p === MV_LIBRE ? "Dates libres" : p)}</select></label>
      ${S.periode === MV_LIBRE ? `<label>Début<input type="date" id="r-libre1" value="${esc(frVersIso(S.libre1))}"></label><label>Fin<input type="date" id="r-libre2" value="${esc(frVersIso(S.libre2))}"></label>` : ""}
      <label>Continent<select id="r-continent">${options(l.continents, z.continent)}</select></label>
      <label>Région<select id="r-region">${options(l.regions, z.region)}</select></label>
      <label>Pays<select id="r-pays">${options(l.pays, z.pays)}</select></label>
      ${evol ? `<label>Critère<select id="r-critere">${options(MV_CRITERES, S.critere)}</select></label>
      <label>Pas<select id="r-pas">${options(["", ...MV_PAS], S.pas, p => p || "Automatique")}</select></label>` : ""}
    </div>
    <div><div class="petit">Joueurs <button type="button" class="lien" data-coche="tous">tous</button><button type="button" class="lien" data-coche="aucun">aucun</button>
      ${EQUIPES.map(e => `<button type="button" class="lien" data-coche="eq:${esc(e)}">${esc(e)}</button>`).join("")}</div>
      <div class="coches">${JOUEURS.filter(j => j.actif).map(j => `<label>${`<input type="checkbox" data-id="${esc(j.id)}"${S.ids[j.id] ? " checked" : ""}>`}${pastille(j.couleur)}${esc(j.nom)}</label>`).join("")}</div></div>
    <div><div class="petit">Moyennes à ajouter</div>
      <div class="coches">${mvClesMoyennes(JOUEURS).map(c => `<label><input type="checkbox" data-moy="${esc(c)}"${S.moyennes.indexOf(c) >= 0 ? " checked" : ""}>${esc(mvLibelleMoyenne(c))}</label>`).join("")}</div></div>
  </section><div id="resultat" class="reglages"></div>`;
}
function selection() {
  return { periode: S.periode, libre1: S.libre1, libre2: S.libre2, zone: S.zone, ids: S.ids, moyennes: S.moyennes, critere: S.critere, pas: S.pas || null };
}
function resultat() {
  ecrire(CLE_VUE, S);
  const out = document.getElementById("resultat");
  if (S.affichage === "Évolution") {
    const e = mvEvolution(DONNEES, selection());
    const notes = e.notes.length ? `<section class="bandeau att">${e.notes.map(esc).join("<br>")}</section>` : "";
    if (e.vide) { out.innerHTML = notes || `<div class="vide">Rien à afficher.</div>`; return; }
    const glisse = e.critere === "Moyenne";
    out.innerHTML = notes + `<section class="carte"><h2>${titre("La courbe de niveau", e.titre.replace("Évolution · ", "").toLowerCase() + ", " + e.periode.titre, glisse
        ? "Points : " + e.critere.toLowerCase() + " de chaque case. Trait : " + e.fenetreTitre + ", calculée sur les parties (comme dans le tableur)." : "Trait : valeur de chaque case.", "boussole")}</h2>
      ${graphique(e.etiquettes, e.series.map(s => ({ nom: s.nom, couleur: s.couleur, points: glisse ? s.valeurs : s.valeurs.map(() => null), ligne: glisse ? s.glissante : s.valeurs })), { f: e.fmt, infoLigne: glisse ? e.fenetreLib : "" })}</section>
      <section class="carte"><h2>${titre("Départ et arrivée", "début et fin de période, " + e.fenetreTitre, "Début = moyenne des premiers jours joués de la période, fin = moyenne des derniers (même durée que la moyenne glissante, réduite si la période est courte).", "carte")}</h2>
      <div class="defil"><table><thead><tr><th>Courbe</th><th class="num">${esc(e.colN)}</th><th class="num">Début</th><th class="num">Fin</th><th class="num">Écart</th></tr></thead><tbody>
      ${e.resume.map((r, i) => `<tr><td><span class="nom">${pastille(e.series[i].couleur)}${esc(r.nom)}</span></td><td class="num">${r.n}</td><td class="num">${fmt(r.debut, e.fmt)}</td><td class="num">${fmt(r.fin, e.fmt)}</td>
        <td class="num ${fini(r.delta) ? (r.delta > 0 ? "evo monte" : r.delta < 0 ? "evo baisse" : "") : ""}">${fmt(r.delta, "+0.0;-0.0;0.0")}</td></tr>`).join("")}
      </tbody></table></div></section>`;
    return;
  }
  const m = mvConstruire(DONNEES, selection());
  const notes = m.notes && m.notes.length ? `<section class="bandeau att">${m.notes.map(esc).join("<br>")}</section>` : "";
  if (m.vide) { out.innerHTML = notes; return; }
  const evoCls = e => e.charAt(0) === "▲" ? "evo monte" : e.charAt(0) === "▼" ? "evo baisse" : "evo";
  out.innerHTML = notes + `<div class="petit">${esc(m.titre)} · ${esc(m.periode.titre)} · évolution des places : ${esc(m.periode.evoLabel)}</div>
  <div class="grille">${m.blocs.map(b => `<section class="carte"><h2>${titre(b.cat)}</h2>
    <table><thead><tr><th>#</th><th>Joueur</th><th class="num">${esc(b.lab)}</th><th class="num">${esc(b.colN)}</th><th class="evo">Évo.</th></tr></thead><tbody>
    ${b.rangees.map(r => `<tr><td class="rang">${r.rk}</td><td>${qui(r.id)}</td><td class="num"><b>${fmt(r.val, b.fmt)}</b></td><td class="num">${r.n}</td><td class="${evoCls(r.evo)}">${esc(r.evo === "•" ? "=" : r.evo)}</td></tr>`).join("")}
    ${b.moyennes.filter(x => fini(x.val)).map(x => `<tr class="moyenne"><td class="rang"></td><td>${esc(x.nom)}</td><td class="num">${fmt(x.val, b.fmt)}</td><td class="num">${x.n}</td><td></td></tr>`).join("")}
    ${b.hors.map(x => `<tr class="hors"><td class="rang">–</td><td>${esc(x.nom)}</td><td colspan="3" class="petit">${esc(x.motif)}</td></tr>`).join("")}
    </tbody></table>${b.rangees.length ? `<div class="pied">Moyenne ${fmt(b.moyenne, b.fmt)} · médiane ${fmt(b.mediane, b.fmt)}</div>` : ""}</section>`).join("")}</div>`;
}
function brancherVue() {
  const c = document.getElementById("contenu");
  const refaire = () => { c.innerHTML = vueCarte(); brancherVue(); resultat(); };
  document.getElementById("p-affichage").addEventListener("click", ev => { const b = ev.target.closest("button"); if (b) { S.affichage = b.dataset.v; refaire(); } });
  const sur = (id, f) => { const el = document.getElementById(id); if (el) el.addEventListener("change", () => { f(el.value); refaire(); }); };
  sur("r-periode", v => { S.periode = v; });
  sur("r-libre1", v => { S.libre1 = isoVersFr(v); });
  sur("r-libre2", v => { S.libre2 = isoVersFr(v); });
  sur("r-continent", v => { S.zone = { continent: v }; });
  sur("r-region", v => { S.zone = { continent: S.zone.continent, region: v }; });
  sur("r-pays", v => { S.zone = { continent: S.zone.continent, region: S.zone.region, pays: v }; });
  sur("r-critere", v => { S.critere = v; });
  sur("r-pas", v => { S.pas = v; });
  c.querySelectorAll("input[data-id]").forEach(i => i.addEventListener("change", () => { S.ids[i.dataset.id] = i.checked; resultat(); }));
  c.querySelectorAll("input[data-moy]").forEach(i => i.addEventListener("change", () => {
    S.moyennes = S.moyennes.filter(x => x !== i.dataset.moy); if (i.checked) S.moyennes.push(i.dataset.moy); resultat();
  }));
  c.querySelectorAll("button[data-coche]").forEach(b => b.addEventListener("click", () => {
    const v = b.dataset.coche;
    JOUEURS.filter(j => j.actif).forEach(j => { S.ids[j.id] = v === "tous" || (v.indexOf("eq:") === 0 && j.equipe === v.slice(3)); });
    refaire();
  }));
}

// ───────────── navigation ─────────────

function afficher() {
  const onglet = location.hash === "#joueur" ? "joueur" : location.hash === "#vue" ? "vue" : "resume";
  document.querySelectorAll("nav.menu a").forEach(a => { if (a.dataset.onglet === onglet) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  const c = document.getElementById("contenu"), t = document.getElementById("titre");
  if (onglet === "resume") { t.textContent = "Le QG des explorateurs"; c.innerHTML = vueResume(); appliquerReplis(); }
  else if (onglet === "joueur") {
    t.textContent = "Le passeport de chaque joueur"; c.innerHTML = vueJoueur();
    document.getElementById("choix-joueur").addEventListener("change", fiche); fiche();
  } else { t.textContent = "Vue à la carte"; c.innerHTML = vueCarte(); brancherVue(); resultat(); }
}

function installer(doc) {
  DOC = doc; R = doc.resume; JOUEURS = doc.joueurs; EQUIPES = R.equipes_noms;
  JOUEURS.forEach(j => { NOM[j.id] = j.nom; COUL[j.id] = j.couleur || "var(--accent)"; EQ[j.id] = j.equipe; });
  DONNEES = {
    joueurs: JOUEURS, params: mvLireParams(Object.entries(doc.params)),
    jours: doc.jours.map(([d, id, total]) => ({ d, id, total })),
    manches: doc.manches.map(([d, id, pos, s, pays, region, cont, ecart]) => ({ d, id, pos, s, pays, region, cont, ecart }))
  };
  const memo = lire(CLE_VUE, null), def = DEFAUT_VUE();
  S = memo && typeof memo === "object" ? Object.assign(def, memo) : def;
  if (!Array.isArray(S.moyennes)) S.moyennes = [];
  const [jour, heure] = doc.genere.split("T");
  document.getElementById("sous-titre").textContent = `Scores à jour au ${dateLongue(jour)} à ${heure.replace(":", " h ")} · mis à jour automatiquement chaque jour`;
  afficher();
  window.addEventListener("hashchange", afficher);
}

Theme.remplirSelecteur(document.getElementById("theme"));
fetch(URL_DONNEES, { cache: "no-store" })
  .then(r => { if (!r.ok) throw new Error("fichier de données introuvable (" + r.status + ")"); return r.json(); })
  .then(installer)
  .catch(e => {
    document.getElementById("titre").textContent = "Impossible de charger les données";
    document.getElementById("contenu").innerHTML = `<section class="bandeau att">${esc(e.message)}</section>`;
  });
