/* Runs before styles load. The preference belongs to the interface, not to project data. */
(function () {
  var theme = 'dark';
  try {
    if (window.localStorage.getItem('srtb-interface-theme') === 'light') theme = 'light';
  } catch (_) {
    // Private or restricted browsers still get the default dark interface.
  }
  document.documentElement.dataset.theme = theme;
})();
