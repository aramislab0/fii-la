/* Fii La — thème choisi (Clair / Sombre), appliqué avant l'affichage pour éviter tout flash.
   « Automatique » = aucun attribut : le réglage du téléphone s'applique. */
(function () {
  try {
    var t = localStorage.getItem('fiila-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* stockage indisponible : thème automatique */ }
})();
