(function () {
  var sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  // One consistent set: 24px grid, stroke-based, 1.75 stroke, round caps.
  // Keyed by the link's href so the markup stays untouched.
  var PATHS = {
    'index.html#home': '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10.5V20h12v-9.5"/>',
    'index.html#signals': '<circle cx="6.5" cy="12" r="2.5"/><circle cx="12" cy="12" r="2.5"/><circle cx="17.5" cy="12" r="2.5"/>',
    'range-volatility.html': '<path d="M4 12h3l2.5-6 3 12 2.5-8 2 4h3"/>',
    'daily-summary.html': '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9.5h16M9 3.5v3M15 3.5v3"/><path d="M8 14h5"/>',
    'historical-data.html': '<path d="M4 6.5v11M4 6.5c0-1.1 3.1-2 7-2s7 .9 7 2-3.1 2-7 2-7-.9-7-2Z"/><path d="M18 6.5v5"/><path d="M4 12c0 1.1 3.1 2 7 2h1"/><path d="M4 17.5c0 1.1 3.1 2 7 2h1"/><path d="M16 15.5v5M14 18h4"/>',
    'derivatives.html': '<path d="M5 20V9M12 20V4M19 20v-7"/><path d="M3 20h18"/>',
    'records.html': '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5.5a2.5 2.5 0 0 0 2.5 4M16 6h2.5a2.5 2.5 0 0 1-2.5 4"/><path d="M12 13v4M9 20h6"/>',
    'winning-rate.html': '<path d="M4 19V5M4 19h16"/><path d="M8 15.5v-3M12 15.5v-7M16 15.5v-5"/>',
    'option-strategy.html': '<path d="M4 19h16"/><path d="M4 19V5"/><path d="M7 15l4-6 3 4 4-7"/>',
    'stock-finder.html': '<circle cx="11" cy="11" r="6"/><path d="m15.5 15.5 4 4"/><path d="M8.5 12l2-2.5 2 2 2-3"/>',
    'economic-calendar.html': '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9.5h16M9 3.5v3M15 3.5v3"/><path d="m8 16 2.5-2.5 2 2L16 12"/>',
    'index.html#news': '<path d="M6 8h9a2 2 0 0 1 2 2v7a2 2 0 0 0 2 2H7a2 2 0 0 1-2-2V9"/><path d="M6 8V6a2 2 0 0 1 2-2h9"/><path d="M8.5 12h6M8.5 15h4"/>',
    'methodology.html': '<path d="M9 4v5l-4 8a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-4-8V4"/><path d="M8 4h8"/><path d="M7.5 15h9"/>',
    'index.html#about': '<circle cx="12" cy="12" r="8"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    'index.html#contact': '<rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="m4 8 8 5 8-5"/>',
  };

  sidebar.querySelectorAll('nav li a').forEach(function (link) {
    var key = link.getAttribute('href');
    var d = PATHS[key];
    if (!d) return;

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'sb-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.75');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = d;

    link.insertBefore(svg, link.firstChild);
  });
})();
