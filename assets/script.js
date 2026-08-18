(function () {
  var toggle = document.getElementById('navToggle');
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sidebarOverlay');

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }

  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
  }

  toggle.addEventListener('click', function () {
    var isOpen = sidebar.classList.contains('open');
    if (isOpen) { closeSidebar(); } else { openSidebar(); }
  });

  overlay.addEventListener('click', closeSidebar);

  sidebar.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', closeSidebar);
  });
})();
