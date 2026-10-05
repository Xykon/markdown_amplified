// Google Analytics, loaded in the browser and only when allowed. Nothing here runs on the server,
// and nothing is fetched from Google until loadGtag() is called: after the visitor accepts
// analytics, or at once on a site that turns the consent banner off.

export function loadGtag(gaId, cookieDomain) {
  if (window.__maGtagLoaded) return
  window.__maGtagLoaded = true
  window.dataLayer = window.dataLayer || []
  // gtag.js reads the arguments object itself, not an array copy of it.
  window.gtag = function gtag() { window.dataLayer.push(arguments) }
  // Consent mode v2: analytics was chosen; advertising never is.
  window.gtag('consent', 'default', {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  })
  window.gtag('js', new Date())
  window.gtag('config', gaId, {
    cookie_domain: cookieDomain || 'none',
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  })
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`
  document.head.appendChild(script)
}

const GA_COOKIE = /^_(ga|gid|gat)(_|$)/

// Removes GA's cookies from this host and from every parent domain, which also clears the ones an
// older version set for the whole parent domain (gtag's 'auto' cookie_domain). With parentsOnly the
// host's own cookies stay: a deletion that names a Domain never touches a host-only cookie.
export function clearGaCookies({ parentsOnly = false } = {}) {
  const names = document.cookie
    .split(';')
    .map((c) => c.trim().split('=')[0])
    .filter((name) => GA_COOKIE.test(name))
  const labels = window.location.hostname.split('.')
  const domains = parentsOnly ? [] : [null]
  for (let i = parentsOnly ? 1 : 0; i < labels.length - 1; i++) domains.push(labels.slice(i).join('.'))
  for (const name of names) {
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; Path=/${domain ? `; Domain=${domain}` : ''}`
    }
  }
}
