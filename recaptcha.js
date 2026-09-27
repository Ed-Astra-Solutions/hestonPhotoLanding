/*
 * Heston Photo: reCAPTCHA helper (v3 with v2 fallback)
 *
 * Usage:
 *   const res = await HestonCaptcha.post(url, payload, 'submit_enquiry');
 *   const data = await res.json();
 *
 * Sends an invisible v3 token with the request. If the server answers 403 with
 * `requireV2: true` (low score), shows the v2 "I'm not a robot" challenge in a
 * popup and resends with the v2 token. Rejects with an Error if the user closes
 * the popup.
 *
 * Keep this file identical in frontend-landing, frontend-lifestyle and frontend-admin.
 */
(function () {
    var V3_SITE_KEY = '6Lc-IwstAAAAAG6RKzXebPO1AIyfJa88YFMt3cAO';
    var V2_SITE_KEY = '6Lf2g9ItAAAAAPhTcMJ2eYTbkxMATnFr9nb7pzUb';

    var loadPromise = null;

    function load() {
        if (loadPromise) return loadPromise;
        loadPromise = new Promise(function (resolve, reject) {
            if (window.grecaptcha && window.grecaptcha.render) {
                window.grecaptcha.ready(resolve);
                return;
            }
            var s = document.createElement('script');
            s.src = 'https://www.google.com/recaptcha/api.js?render=' + V3_SITE_KEY;
            s.async = true;
            s.onload = function () { window.grecaptcha.ready(resolve); };
            s.onerror = function () {
                loadPromise = null;
                reject(new Error('Security check failed to load. Please check your connection and try again.'));
            };
            document.head.appendChild(s);
        });
        return loadPromise;
    }

    // Load early (first scroll/tap/keypress, or after 8s) so v3 sees some page interaction
    function preloadOnInteraction() {
        var events = ['scroll', 'pointerdown', 'keydown', 'focusin'];
        var timer;
        function go() {
            clearTimeout(timer);
            events.forEach(function (e) { window.removeEventListener(e, go, true); });
            load().catch(function () {});
        }
        events.forEach(function (e) { window.addEventListener(e, go, { passive: true, capture: true }); });
        timer = setTimeout(go, 8000);
    }

    function getV3Token(action) {
        return load().then(function () {
            return window.grecaptcha.execute(V3_SITE_KEY, { action: action });
        });
    }

    function injectStyles() {
        if (document.getElementById('hp-captcha-style')) return;
        var css = [
            '#hp-captcha-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.72);font-family:inherit;}',
            '#hp-captcha-box{background:#141414;color:#f2f2f2;border:1px solid rgba(201,169,98,0.35);border-radius:10px;padding:24px;max-width:360px;width:100%;box-sizing:border-box;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.5);}',
            '#hp-captcha-box h3{margin:0 0 8px;font-size:1.1rem;color:#C9A962;font-weight:600;}',
            '#hp-captcha-box p{margin:0 0 16px;font-size:0.9rem;line-height:1.5;color:rgba(255,255,255,0.7);}',
            '#hp-captcha-widget{display:flex;justify-content:center;min-height:78px;}',
            '#hp-captcha-cancel{margin-top:16px;background:none;border:1px solid rgba(255,255,255,0.25);color:rgba(255,255,255,0.75);padding:8px 20px;border-radius:6px;cursor:pointer;font:inherit;font-size:0.85rem;}',
            '#hp-captcha-cancel:hover{border-color:rgba(255,255,255,0.5);color:#fff;}',
            '@media (max-width:360px){#hp-captcha-widget{transform:scale(0.9);transform-origin:center;}}'
        ].join('');
        var style = document.createElement('style');
        style.id = 'hp-captcha-style';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // Show the v2 checkbox (and image puzzle if Google asks for one); resolves with its token
    function getV2Token() {
        if (!V2_SITE_KEY || V2_SITE_KEY.indexOf('REPLACE_') === 0) {
            return Promise.reject(new Error('Security verification failed. Please try again later.'));
        }
        return load().then(function () {
            return new Promise(function (resolve, reject) {
                injectStyles();
                var overlay = document.createElement('div');
                overlay.id = 'hp-captcha-overlay';
                overlay.setAttribute('role', 'dialog');
                overlay.setAttribute('aria-modal', 'true');
                overlay.setAttribute('aria-labelledby', 'hp-captcha-title');
                overlay.innerHTML =
                    '<div id="hp-captcha-box">' +
                    '<h3 id="hp-captcha-title">Quick security check</h3>' +
                    '<p>Please confirm you’re not a robot to continue.</p>' +
                    '<div id="hp-captcha-widget"></div>' +
                    '<button type="button" id="hp-captcha-cancel">Cancel</button>' +
                    '</div>';
                document.body.appendChild(overlay);

                function close() {
                    document.removeEventListener('keydown', onKey);
                    overlay.remove();
                }
                function cancel() {
                    close();
                    reject(new Error('Security check was cancelled.'));
                }
                function onKey(e) { if (e.key === 'Escape') cancel(); }

                document.addEventListener('keydown', onKey);
                overlay.querySelector('#hp-captcha-cancel').addEventListener('click', cancel);

                try {
                    window.grecaptcha.render(overlay.querySelector('#hp-captcha-widget'), {
                        sitekey: V2_SITE_KEY,
                        theme: 'dark',
                        callback: function (token) {
                            close();
                            resolve(token);
                        }
                    });
                } catch (err) {
                    close();
                    reject(new Error('Security check failed to load. Please try again.'));
                }
            });
        });
    }

    function send(url, payload, extra, headers) {
        var body = Object.assign({}, payload, extra);
        return fetch(url, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
            body: JSON.stringify(body)
        });
    }

    function needsV2(res) {
        if (res.status !== 403) return Promise.resolve(false);
        return res.clone().json()
            .then(function (data) { return Boolean(data && data.requireV2); })
            .catch(function () { return false; });
    }

    /**
     * POST JSON with reCAPTCHA protection. Resolves with the final fetch Response.
     */
    function post(url, payload, action, headers) {
        return getV3Token(action)
            .catch(function (err) {
                // No v3 token: the server will ask for the v2 challenge instead
                console.warn('reCAPTCHA v3 unavailable:', err);
                return null;
            })
            .then(function (token) {
                return send(url, payload, token ? { recaptchaToken: token } : {}, headers);
            })
            .then(function (res) {
                return needsV2(res).then(function (retry) {
                    if (!retry) return res;
                    return getV2Token().then(function (v2Token) {
                        return send(url, payload, { recaptchaV2Token: v2Token }, headers);
                    });
                });
            });
    }

    window.HestonCaptcha = { post: post, load: load };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', preloadOnInteraction);
    } else {
        preloadOnInteraction();
    }
})();
