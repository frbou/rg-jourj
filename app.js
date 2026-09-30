// RG Jour J (iPhone) : la journée préparée dans RG sur le Mac, reçue par
// AirDrop, consultable hors connexion ; main courante saisie sur place et
// renvoyée au Mac par AirDrop (« Sync »). Aucune donnée ne quitte l'iPhone
// autrement que par un fichier que vous partagez vous-même.
'use strict'
const VERSION_APP = '1.1.0'
const CLE = 'rg-jourj'

// ---------- État (enregistré dans l'iPhone) ----------
let etat = { donnees: null, messages: [], service: 'Général', severite: 'info', plages: [], supprimees: [], pointageAEnvoyer: false }
try {
  const s = JSON.parse(localStorage.getItem(CLE) || 'null')
  if (s) etat = { ...etat, ...s }
} catch (e) {}
const sauver = () => {
  try {
    localStorage.setItem(CLE, JSON.stringify(etat))
  } catch (e) {
    toast("Impossible d'enregistrer sur l'iPhone (mémoire pleine ?)")
  }
}

const $ = (s) => document.querySelector(s)
const el = (tag, attrs = {}, ...enfants) => {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v
    else if (k === 'style') n.style.cssText = v
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v)
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v)
  }
  for (const e of enfants.flat()) if (e !== null && e !== undefined && e !== false) n.append(e.nodeType ? e : document.createTextNode(e))
  return n
}
const pad = (n) => String(n).padStart(2, '0')
const isoMaintenant = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const heure = (iso) => {
  const [h, m] = iso.slice(11, 16).split(':')
  return m === '00' ? `${Number(h)} h` : `${Number(h)} h ${m}`
}
const fin = (x) => heure(x.fin) + (x.fin.slice(0, 10) > x.debut.slice(0, 10) ? ' (+1)' : '')
const telLien = (t) => 'tel:' + String(t || '').replace(/[^\d+]/g, '')
const nouvelId = (pre = 'jrn') => pre + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

let minuterieToast = null
function toast(t) {
  const n = $('#toast')
  n.textContent = t
  n.hidden = false
  clearTimeout(minuterieToast)
  minuterieToast = setTimeout(() => (n.hidden = true), 3500)
}

// ---------- Chargement d'une journée ----------
async function charger(fichier) {
  let d
  try {
    d = JSON.parse(await fichier.text())
  } catch (e) {
    return toast("Ce fichier n'est pas lisible.")
  }
  if (d.format !== 'rg-jourj') return toast("Ce fichier ne vient pas de RG (page Jour J → Préparer l'iPhone).")
  const memeProjet = etat.donnees && etat.donnees.projet.id === d.projet.id
  const nonEnvoyes = etat.messages.filter((m) => m.origine === 'iphone' && !m.exporte)
  const pointageNonEnvoye = etat.pointageAEnvoyer && !memeProjet
  if (!memeProjet && (nonEnvoyes.length || pointageNonEnvoye) && !confirm(`Des ${nonEnvoyes.length ? 'messages' : ''}${nonEnvoyes.length && pointageNonEnvoye ? ' et des ' : ''}${pointageNonEnvoye ? 'heures pointées' : ''} de « ${etat.donnees.projet.nom} » n'ont pas été envoyés au Mac. Les remplacer quand même ?`)) return
  // Messages : ceux du Mac + ceux saisis ici (même projet), sans doublon
  const parId = new Map()
  for (const m of d.messages || []) parId.set(m.id, { ...m, origine: 'mac' })
  if (memeProjet) for (const m of etat.messages) if (m.origine === 'iphone') parId.set(m.id, m)
  etat.donnees = d
  etat.messages = [...parId.values()]
  // Pointage : celui du Mac, sauf si des heures saisies ici (même projet) n'ont pas encore été envoyées
  if (!(memeProjet && etat.pointageAEnvoyer)) {
    etat.plages = (d.pointage?.plages || []).map((x) => ({ ...x }))
    etat.supprimees = []
    etat.pointageAEnvoyer = false
  }
  if (!d.services.some((s) => s.nom === etat.service)) etat.service = d.services[0]?.nom || 'Général'
  sauver()
  fermerMenu()
  toast(`Journée chargée : ${d.projet.nom}`)
  afficher()
}
document.querySelectorAll('[data-charger]').forEach((i) =>
  i.addEventListener('change', (ev) => {
    const f = ev.target.files?.[0]
    ev.target.value = ''
    if (f) charger(f)
  }),
)

// ---------- Sync : fichier de la main courante à renvoyer au Mac ----------
async function synchroniser() {
  const d = etat.donnees
  if (!d) return
  const miens = etat.messages.filter((m) => m.origine === 'iphone')
  const completes = etat.plages.filter((x) => x.fin)
  const enCours = etat.plages.length - completes.length
  if (!miens.length && !etat.pointageAEnvoyer) return toast("Rien à envoyer : aucun message ni pointage saisi sur l'iPhone.")
  if (enCours && !confirm(`${enCours} pointage(s) sans heure de départ ne seront pas envoyés. Continuer ?`)) return
  const contenu = JSON.stringify({
    format: 'rg-jourj-retour',
    version: 1,
    projet: d.projet,
    jour: d.jour,
    exporteLe: new Date().toISOString(),
    messages: miens.map(({ id, quand, service, severite, texte, cree }) => ({ id, quand, service, severite, texte, cree })),
    pointage: etat.pointageAEnvoyer ? { plages: completes, supprimees: etat.supprimees } : null,
  }, null, 1)
  const propre = d.projet.nom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w() -]+/g, '-').replace(/-+/g, '-').trim()
  const nom = `RG iPhone - ${propre} - ${isoMaintenant().replace('T', ' ').replace(':', 'h')}.json`
  const fichier = new File([contenu], nom, { type: 'application/json' })
  try {
    if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
      await navigator.share({ files: [fichier], title: 'RG Jour J' })
    } else {
      const a = el('a', { href: URL.createObjectURL(fichier), download: nom })
      document.body.append(a)
      a.click()
      a.remove()
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return // partage annulé
    return toast("Partage impossible : " + (e.message || e))
  }
  const nbHeures = etat.pointageAEnvoyer ? completes.length : 0
  for (const m of miens) m.exporte = true
  if (etat.pointageAEnvoyer && !enCours) etat.pointageAEnvoyer = false
  sauver()
  afficherMessages()
  afficherHeures()
  toast(`Envoyé : ${miens.length} message(s)${nbHeures ? `, ${nbHeures} plage(s) d'heures` : ''}. Sur le Mac : Main courante ou Pointage → Importer depuis l'iPhone.`)
}

// ---------- Affichage ----------
const VUES = ['maintenant', 'main', 'heures', 'contacts']
let vue = 'maintenant'
function changerVue(v) {
  vue = v
  document.querySelectorAll('#onglets button').forEach((b) => b.classList.toggle('actif', b.dataset.vue === v))
  for (const id of VUES) $('#vue-' + id).hidden = id !== v
  window.scrollTo(0, 0)
}
document.querySelectorAll('#onglets button').forEach((b) => b.addEventListener('click', () => changerVue(b.dataset.vue)))

function afficher() {
  const d = etat.donnees
  $('#vue-vide').hidden = !!d
  $('#onglets').hidden = !d
  $('#version').textContent = `RG Jour J ${VERSION_APP}` + (d ? ` · journée préparée le ${new Date(d.genere).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : '')
  if (!d) {
    for (const id of VUES) $('#vue-' + id).hidden = true
    $('#projet-nom').textContent = 'RG Jour J'
    $('#jour-nom').textContent = 'Aucune journée chargée'
    return
  }
  $('#projet-nom').textContent = d.projet.nom
  $('#jour-nom').textContent = d.titreJour
  changerVue(vue)
  afficherMaintenant()
  afficherSaisie()
  afficherMessages()
  afficherHeures()
  afficherContacts()
}

function afficherMaintenant() {
  const d = etat.donnees
  if (!d) return
  const now = isoMaintenant()
  const estAujourdhui = now.slice(0, 10) === d.jour
  $('#horloge').textContent = now.slice(11, 16)
  const etatEvt = (x) => (!estAujourdhui ? '' : x.fin <= now ? 'passe' : x.debut <= now ? 'encours' : '')
  const encours = estAujourdhui ? d.deroule.filter((x) => etatEvt(x) === 'encours' && !x.repas) : []
  const prochain = estAujourdhui ? d.deroule.find((x) => x.debut > now) : null
  const c1 = $('#carte-encours')
  c1.replaceChildren(el('div', { class: 'etiquette' }, 'En ce moment'))
  if (!estAujourdhui) c1.append(el('div', { class: 'petit' }, `Journée du ${d.titreJour} (pas aujourd'hui).`))
  else if (!encours.length) c1.append(el('div', { class: 'petit' }, "Pas d'événement en cours."))
  for (const x of encours) c1.append(el('b', { class: 'grand' }, x.titre), el('div', { class: 'petit' }, `jusqu'à ${fin(x)}${x.lieu ? ' · ' + x.lieu : ''}`))
  const c2 = $('#carte-prochain')
  c2.hidden = !estAujourdhui
  c2.replaceChildren(el('div', { class: 'etiquette' }, 'Prochain'))
  if (prochain) {
    const min = Math.round((new Date(prochain.debut) - new Date()) / 60000)
    const dans = min < 60 ? `dans ${min} min` : `dans ${Math.floor(min / 60)} h${min % 60 ? ' ' + pad(min % 60) : ''}`
    c2.append(el('div', { class: 'compte' }, dans), el('b', { class: 'grand' }, `${heure(prochain.debut)} — ${prochain.titre}`), el('div', { class: 'petit' }, [prochain.lieu, prochain.nb ? prochain.nb + ' pers.' : ''].filter(Boolean).join(' · ')))
  } else c2.append(el('div', { class: 'petit' }, "Plus rien de prévu aujourd'hui."))
  $('#deroule').replaceChildren(
    ...(d.deroule.length ? d.deroule.map((x) =>
      el('div', { class: `ligne ${etatEvt(x)} ${x.repas ? 'repas' : ''}` },
        el('span', { class: 'h' }, `${heure(x.debut)} – ${fin(x)}`),
        el('div', { class: 'corps' }, el('b', {}, x.titre), el('div', { class: 'petit' }, [x.lieu, x.nb ? x.nb + ' pers.' : ''].filter(Boolean).join(' · ')), x.notes ? el('div', { class: 'petit' }, x.notes) : null),
      ),
    ) : [el('div', { class: 'vide' }, 'Rien au planning.')]),
  )
}

const severite = (v) => (etat.donnees?.severites || []).find((s) => s.v === v) || { v, label: v, couleur: '#546e7a' }
const icone = (nom) => (etat.donnees?.services || []).find((s) => s.nom === nom)?.icone || '📝'

function afficherSaisie() {
  const d = etat.donnees
  $('#services').replaceChildren(
    ...d.services.map((s) =>
      el('button', { type: 'button', class: 'service' + (etat.service === s.nom ? ' actif' : ''), onclick: () => { etat.service = s.nom; sauver(); afficherSaisie() } },
        el('span', { class: 'ico' }, s.icone), s.nom),
    ),
  )
  $('#severites').replaceChildren(
    ...d.severites.map((s) =>
      el('button', { type: 'button', class: 'sev' + (etat.severite === s.v ? ' actif' : ''), style: `--c:${s.couleur}`, onclick: () => { etat.severite = s.v; afficherSaisie() } }, s.label),
    ),
  )
}
$('#saisie').addEventListener('submit', (ev) => {
  ev.preventDefault()
  const texte = $('#texte').value.trim()
  if (!texte || !etat.donnees) return
  etat.messages.push({ id: nouvelId(), quand: isoMaintenant(), service: etat.service, severite: etat.severite, texte, cree: new Date().toISOString(), origine: 'iphone', exporte: false })
  etat.severite = 'info'
  sauver()
  $('#texte').value = ''
  $('#texte').blur()
  afficherSaisie()
  afficherMessages()
  toast('Message ajouté')
})

function afficherMessages() {
  const liste = [...etat.messages].sort((a, b) => b.quand.localeCompare(a.quand) || (b.cree || '').localeCompare(a.cree || ''))
  const aEnvoyer = etat.messages.filter((m) => m.origine === 'iphone' && !m.exporte).length
  $('#a-envoyer').textContent = aEnvoyer ? `${aEnvoyer} à envoyer au Mac (menu ⋯ → Sync)` : ''
  $('#messages').replaceChildren(
    ...(liste.length ? liste.map((m) => {
      const s = severite(m.severite)
      return el('div', { class: 'ligne message', style: `--c:${s.couleur}` },
        el('span', { class: 'h' }, heure(m.quand)),
        el('span', { class: 'ico' }, icone(m.service)),
        el('div', { class: 'corps' },
          el('div', {}, el('span', { class: 'pastille' }, s.label), el('span', { class: 'petit' }, m.service), m.origine === 'iphone' && !m.exporte ? el('span', { class: 'non-envoye' }, ' ● à envoyer') : null),
          el('div', { class: 'txt' }, m.texte),
        ),
        m.origine === 'iphone' ? el('button', { class: 'suppr', 'aria-label': 'Supprimer', onclick: () => supprimer(m) }, '✕') : null,
      )
    }) : [el('div', { class: 'vide' }, 'Aucun message pour cette journée.')]),
  )
}
function supprimer(m) {
  if (!confirm(m.exporte ? 'Supprimer ce message ? (Déjà envoyé au Mac : il restera dans RG.)' : 'Supprimer ce message ?')) return
  etat.messages = etat.messages.filter((x) => x.id !== m.id)
  sauver()
  afficherMessages()
}

// ---------- Heures réelles (personnel embauché) ----------
// plage : { id, personneId, debut, fin ('' = en cours), pauseMin, evenementId, note } — même format que RG
const duree = (x) => (x.debut && x.fin && x.fin > x.debut ? (new Date(x.fin) - new Date(x.debut)) / 3600000 - (Number(x.pauseMin) || 0) / 60 : 0)
const fmtH = (h) => {
  const m = Math.round(Math.abs(h) * 60)
  return `${Math.floor(m / 60)} h${m % 60 ? ' ' + pad(m % 60) : ''}`
}
const lendemain = (iso) => {
  const d = new Date(iso.slice(0, 10) + 'T12:00')
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
// Heure de fin (HH:MM) → ISO ; avant le début = le lendemain
const finDepuisHeure = (debut, hhmm) => (hhmm >= debut.slice(11, 16) ? debut.slice(0, 10) : lendemain(debut)) + 'T' + hhmm
// « Maintenant » ramené au jour préparé (si l'iPhone sert un autre jour, on garde l'heure)
const maintenantDuJour = () => {
  const now = isoMaintenant()
  const d = etat.donnees.jour
  return now.slice(0, 10) === d || now.slice(0, 10) === lendemain(d + 'T00:00') ? now : d + now.slice(10)
}
const plagesDe = (pid) => etat.plages.filter((x) => x.personneId === pid).sort((a, b) => a.debut.localeCompare(b.debut))
function modifie() {
  etat.pointageAEnvoyer = true
  sauver()
  afficherHeures()
}
function depuisPrevu(p) {
  for (const e of p.prevu) etat.plages.push({ id: nouvelId('ptg'), personneId: p.id, debut: e.debut, fin: e.fin, pauseMin: 0, evenementId: e.id, note: '' })
}
function arrivee(p) {
  etat.plages.push({ id: nouvelId('ptg'), personneId: p.id, debut: maintenantDuJour(), fin: '', pauseMin: 0, evenementId: '', note: '' })
  modifie()
  toast(`Arrivée de ${p.nom} à ${maintenantDuJour().slice(11, 16)}`)
}
function depart(x, p) {
  x.fin = finDepuisHeure(x.debut, maintenantDuJour().slice(11, 16))
  modifie()
  toast(`Départ de ${p.nom} à ${x.fin.slice(11, 16)} (${fmtH(duree(x))})`)
}
function supprimerPlage(x) {
  if (!confirm('Supprimer cette plage ?')) return
  etat.plages = etat.plages.filter((y) => y.id !== x.id)
  etat.supprimees.push(x.id)
  modifie()
}
function afficherHeures() {
  const d = etat.donnees
  if (!d) return
  const equipe = d.pointage?.equipe || []
  const max = Number(d.pointage?.dureeMaxJourHeures) || 10
  const lignes = equipe.map((p) => {
    const pl = plagesDe(p.id)
    const hPrevu = p.prevu.reduce((t, e) => t + duree(e), 0)
    const hReel = pl.reduce((t, x) => t + duree(x), 0)
    const ouverte = pl.find((x) => !x.fin)
    const heureInput = (valeur, label, onchange) => el('input', { type: 'time', value: valeur, 'aria-label': label, onchange })
    return el('div', { class: 'carte pointe' + (ouverte ? ' ouverte' : '') },
      el('div', { class: 'tete' },
        el('div', { class: 'corps' }, el('b', {}, p.nom), ' ', el('span', { class: 'petit' }, p.role),
          el('div', { class: 'petit' }, p.prevu.length ? 'Prévu ' + p.prevu.map((e) => `${heure(e.debut)}–${heure(e.fin)}`).join(', ') + ` · ${fmtH(hPrevu)}` : 'Non convoqué au planning')),
        el('div', { class: 'total' }, pl.length ? el('b', {}, fmtH(hReel)) : el('span', { class: 'petit' }, '—'),
          pl.length && p.prevu.length ? el('div', { class: 'petit ecart' }, Math.abs(hReel - hPrevu) < 1 / 120 ? '= prévu' : (hReel > hPrevu ? '+' : '−') + fmtH(hReel - hPrevu)) : null),
      ),
      ...pl.map((x) =>
        el('div', { class: 'plage' },
          heureInput(x.debut.slice(11, 16), 'Arrivée', (ev) => {
            if (!ev.target.value) return
            const finH = x.fin && x.fin.slice(11, 16)
            x.debut = x.debut.slice(0, 10) + 'T' + ev.target.value
            if (finH) x.fin = finDepuisHeure(x.debut, finH)
            modifie()
          }),
          el('span', {}, '–'),
          x.fin
            ? heureInput(x.fin.slice(11, 16), 'Départ', (ev) => { if (ev.target.value) { x.fin = finDepuisHeure(x.debut, ev.target.value); modifie() } })
            : el('button', { type: 'button', class: 'mini principal', onclick: () => depart(x, p) }, 'Départ'),
          x.fin && x.fin.slice(0, 10) > x.debut.slice(0, 10) ? el('span', { class: 'petit' }, '+1') : null,
          el('label', { class: 'pause' }, el('input', { type: 'number', inputmode: 'numeric', min: '0', step: '5', value: x.pauseMin || 0, 'aria-label': 'Pause (min)', onchange: (ev) => { x.pauseMin = Math.max(0, Number(ev.target.value) || 0); modifie() } }), el('span', { class: 'petit' }, 'min')),
          el('button', { type: 'button', class: 'suppr', 'aria-label': 'Supprimer la plage', onclick: () => supprimerPlage(x) }, '✕'),
        ),
      ),
      hReel > max ? el('div', { class: 'alerte' }, `⚠ ${fmtH(hReel)} : plus de ${max} h dans la journée`) : null,
      el('div', { class: 'actions' },
        !ouverte ? el('button', { type: 'button', class: 'mini', onclick: () => arrivee(p) }, '▶ Arrivée') : null,
        !pl.length && p.prevu.length ? el('button', { type: 'button', class: 'mini', onclick: () => { depuisPrevu(p); modifie() } }, '= prévu') : null,
      ),
    )
  })
  const sansPlage = equipe.filter((p) => p.prevu.length && !plagesDe(p.id).length)
  $('#heures-etat').textContent = etat.pointageAEnvoyer ? '● à envoyer au Mac (menu ⋯ → Sync)' : ''
  $('#btn-tous-prevu').hidden = !sansPlage.length
  $('#heures').replaceChildren(...(lignes.length ? lignes : [el('div', { class: 'vide' }, "Personne de l'équipe embauchée ce jour-là.")]))
}
$('#btn-tous-prevu').addEventListener('click', () => {
  const l = (etat.donnees.pointage?.equipe || []).filter((p) => p.prevu.length && !plagesDe(p.id).length)
  if (!l.length) return
  l.forEach(depuisPrevu)
  modifie()
  toast(`${l.length} personne(s) pointée(s) d'après le prévu : corrigez les écarts`)
})

function afficherContacts() {
  const d = etat.donnees
  const groupes = new Map()
  for (const p of d.presents) {
    if (!groupes.has(p.groupe)) groupes.set(p.groupe, [])
    groupes.get(p.groupe).push(p)
  }
  const now = isoMaintenant()
  const estAujourdhui = now.slice(0, 10) === d.jour
  $('#presents').replaceChildren(
    ...(d.presents.length ? [...groupes].flatMap(([g, l]) => [
      el('div', { class: 'groupe' }, g),
      ...l.map((p) =>
        el('div', { class: 'ligne personne' + (estAujourdhui && p.fin <= now ? ' passe' : '') },
          el('div', { class: 'corps' }, el('b', {}, p.nom), ' ', el('span', { class: 'petit' }, p.role), el('div', { class: 'petit' }, `${heure(p.debut)} – ${fin(p)}${p.regime ? ' · ' + p.regime : ''}`)),
          p.tel ? el('a', { class: 'tel', href: telLien(p.tel) }, p.tel) : null,
        ),
      ),
    ]) : [el('div', { class: 'vide' }, 'Personne de convoqué.')]),
  )
  const blocs = []
  for (const l of d.lieux) {
    blocs.push(el('div', { class: 'groupe' }, l.nom), el('div', { class: 'petit', style: 'margin:0 4px 4px' }, l.adresse || ''))
    for (const c of l.contacts) blocs.push(contact(c.nom, c.fonction, c.tel))
  }
  if (d.production.length) {
    blocs.push(el('div', { class: 'groupe' }, 'Production'))
    for (const c of d.production) blocs.push(contact(c.nom, c.fonction, c.tel))
  }
  if (d.compagnies.length) {
    blocs.push(el('div', { class: 'groupe' }, 'Compagnies'))
    for (const c of d.compagnies) blocs.push(contact(c.referent ? `${c.nom} — ${c.referent}` : c.nom, c.role, c.tel))
  }
  $('#contacts').replaceChildren(...(blocs.length ? blocs : [el('div', { class: 'vide' }, 'Aucun contact.')]))
  $('#regie').textContent = d.regie?.nom ? `Régie générale : ${d.regie.nom}${d.regie.tel ? ' · ' + d.regie.tel : ''}` : ''
}
const contact = (nom, fonction, tel) =>
  el('div', { class: 'ligne personne' },
    el('div', { class: 'corps' }, el('b', {}, nom), ' ', el('span', { class: 'petit' }, fonction || '')),
    tel ? el('a', { class: 'tel', href: telLien(tel) }, tel) : null,
  )

// ---------- Menu ----------
const fermerMenu = () => ($('#menu').hidden = true)
$('#btn-menu').addEventListener('click', () => {
  $('#btn-sync').disabled = !etat.donnees
  $('#menu').hidden = false
})
$('#btn-fermer-menu').addEventListener('click', fermerMenu)
$('#menu').addEventListener('click', (ev) => ev.target.id === 'menu' && fermerMenu())
$('#btn-sync').addEventListener('click', () => {
  fermerMenu()
  synchroniser()
})

// ---------- Horloge et hors connexion ----------
afficher()
setInterval(() => {
  if (!etat.donnees) return
  afficherMaintenant()
  if (vue === 'contacts') afficherContacts()
}, 15000)
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && etat.donnees && afficherMaintenant())
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {})
