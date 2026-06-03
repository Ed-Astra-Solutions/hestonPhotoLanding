(function () {
    var GA_ID = 'G-J09CVYG8EV';
    var STORAGE_KEY = 'heston_cookie_consent';

    function loadGA() {
        if (window.__gaLoaded) return;
        window.__gaLoaded = true;
        var s = document.createElement('script');
        s.async = true;
        s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
        document.head.appendChild(s);
        window.dataLayer = window.dataLayer || [];
        function gtag() { dataLayer.push(arguments); }
        window.gtag = gtag;
        gtag('js', new Date());
        gtag('config', GA_ID);
    }

    function setConsent(value) {
        try { localStorage.setItem(STORAGE_KEY, value); } catch (e) {}
    }

    function getConsent() {
        try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    }

    function hideBanner(banner) {
        banner.style.transform = 'translateY(120%)';
        banner.style.opacity = '0';
        setTimeout(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 400);
    }

    function injectBanner() {
        var style = document.createElement('style');
        style.textContent = [
            '#hp-cookie-banner{',
            '  position:fixed;bottom:0;left:0;right:0;z-index:99999;',
            '  background:rgba(18,14,10,0.97);border-top:1px solid rgba(201,168,124,0.25);',
            '  padding:1.25rem 1.5rem;display:flex;align-items:center;justify-content:space-between;',
            '  gap:1.25rem;flex-wrap:wrap;',
            '  font-family:"Montserrat",sans-serif;font-size:0.82rem;line-height:1.6;',
            '  color:rgba(255,255,255,0.75);',
            '  transform:translateY(0);opacity:1;',
            '  transition:transform 0.35s ease,opacity 0.35s ease;',
            '  box-shadow:0 -4px 24px rgba(0,0,0,0.55);',
            '}',
            '#hp-cookie-banner p{margin:0;max-width:680px;flex:1 1 300px;}',
            '#hp-cookie-banner a{color:#C9A87C;text-decoration:none;border-bottom:1px solid rgba(201,168,124,0.35);}',
            '#hp-cookie-banner a:hover{color:#E5C896;}',
            '#hp-cookie-banner .hp-cb-btns{display:flex;gap:0.65rem;flex-shrink:0;flex-wrap:wrap;}',
            '#hp-cookie-accept{',
            '  background:linear-gradient(135deg,#C9A87C,#a8844f);',
            '  color:#0a0a0a;border:none;padding:0.55rem 1.1rem;',
            '  font-family:"Montserrat",sans-serif;font-size:0.78rem;font-weight:600;',
            '  letter-spacing:0.08em;text-transform:uppercase;cursor:pointer;',
            '  border-radius:2px;white-space:nowrap;',
            '  transition:opacity 0.2s;',
            '}',
            '#hp-cookie-accept:hover{opacity:0.88;}',
            '#hp-cookie-reject{',
            '  background:transparent;color:rgba(255,255,255,0.55);',
            '  border:1px solid rgba(255,255,255,0.2);padding:0.55rem 1.1rem;',
            '  font-family:"Montserrat",sans-serif;font-size:0.78rem;font-weight:400;',
            '  letter-spacing:0.06em;text-transform:uppercase;cursor:pointer;',
            '  border-radius:2px;white-space:nowrap;',
            '  transition:border-color 0.2s,color 0.2s;',
            '}',
            '#hp-cookie-reject:hover{border-color:rgba(255,255,255,0.45);color:rgba(255,255,255,0.8);}',
            '@media(max-width:520px){',
            '  #hp-cookie-banner{padding:1rem;}',
            '  #hp-cookie-banner .hp-cb-btns{width:100%;}',
            '  #hp-cookie-accept,#hp-cookie-reject{flex:1;text-align:center;}',
            '}',
        ].join('');
        document.head.appendChild(style);

        var banner = document.createElement('div');
        banner.id = 'hp-cookie-banner';
        banner.setAttribute('role', 'dialog');
        banner.setAttribute('aria-label', 'Cookie consent');
        banner.innerHTML = [
            '<p>We use cookies to improve your experience and analyse site traffic.',
            ' By clicking <strong style="color:#E5C896;">Accept All</strong> you consent to our use of analytics cookies.',
            ' You can learn more in our <a href="/cookies.html">Cookie Policy</a>.</p>',
            '<div class="hp-cb-btns">',
            '  <button id="hp-cookie-reject">Reject Non-Essential</button>',
            '  <button id="hp-cookie-accept">Accept All</button>',
            '</div>',
        ].join('');

        document.body.appendChild(banner);

        document.getElementById('hp-cookie-accept').addEventListener('click', function () {
            setConsent('accepted');
            loadGA();
            hideBanner(banner);
        });

        document.getElementById('hp-cookie-reject').addEventListener('click', function () {
            setConsent('rejected');
            hideBanner(banner);
        });
    }

    function init() {
        var consent = getConsent();
        if (consent === 'accepted') {
            loadGA();
        } else if (!consent) {
            if (document.body) {
                injectBanner();
            } else {
                document.addEventListener('DOMContentLoaded', injectBanner);
            }
        }
    }

    init();
})();
