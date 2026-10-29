// Let whoever types the password in a dark room see what they typed: cheaper
// than a second failed login.
(function () {
  'use strict';
  document.addEventListener('click', function (event) {
    var eye = event.target.closest('[data-reveal]');
    if (!eye) return;
    var field = eye.parentNode.querySelector('input');
    var hidden = field.type === 'password';
    field.type = hidden ? 'text' : 'password';
    eye.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    eye.setAttribute('aria-label', hidden ? 'Nascondi la password' : 'Mostra la password');
    field.focus();
  });
})();
