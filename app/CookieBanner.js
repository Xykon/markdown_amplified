'use client'

import { useEffect, useState } from 'react'

const CONSENT_KEY = 'ma_cookie_consent'

export default function CookieBanner({ privacyUrl, privacyLabel }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem(CONSENT_KEY)) setVisible(true)
  }, [])

  function accept() {
    localStorage.setItem(CONSENT_KEY, 'granted')
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', { analytics_storage: 'granted' })
    }
    setVisible(false)
  }

  function decline() {
    localStorage.setItem(CONSENT_KEY, 'denied')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="cookie-banner" role="dialog" aria-label="Cookie consent">
      <p className="cookie-banner-text">
        We use analytics cookies to understand how visitors use this site.
        {privacyUrl && (
          <> See our <a href={privacyUrl} target="_blank" rel="noopener noreferrer">{privacyLabel}</a>.</>
        )}
      </p>
      <div className="cookie-banner-actions">
        <button className="cookie-btn cookie-btn-secondary" onClick={decline}>Decline</button>
        <button className="cookie-btn cookie-btn-primary" onClick={accept}>Accept</button>
      </div>
    </div>
  )
}
