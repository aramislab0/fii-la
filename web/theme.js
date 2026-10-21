/* Fii — le thème suit toujours le réglage du téléphone (clair ou sombre), sans choix dans l'application
   (fondateur, 20/10/2026). Efface l'ancien choix « Clair » / « Sombre » gardé sur le téléphone. */
(function () {
  try { localStorage.removeItem('fiila-theme'); } catch (e) { /* stockage indisponible */ }
  document.documentElement.removeAttribute('data-theme');
})();
