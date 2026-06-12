'use client'

import { useEffect, useState } from 'react'

const CONSENT_KEY = 'ma_cookie_consent'
const CONSENT_DATA_KEY = 'ma_cookie_consent_data'

export default function CookieBanner({ privacyUrl, privacyLabel }) {
  const [decided, setDecided] = useState(true)
  const [bannerVisible, setBannerVisible] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [analyticsChecked, setAnalyticsChecked] = useState(false)

  useEffect(() => {
    let hasDecided = false
    try {
      hasDecided = localStorage.getItem(CONSENT_KEY) !== null
    } catch (e) {}
    if (hasDecided) return

    setDecided(false)

    let fired = false
    let timer
    let ro

    function fire() {
      if (fired) return
      fired = true
      clearTimeout(timer)
      ro.disconnect()
      setBannerVisible(true)
    }

    // Once the page becomes scrollable (content renders in), switch to scroll-trigger
    // and cancel the fallback timer so we don't interrupt mid-read.
    function switchToScroll() {
      clearTimeout(timer)
      window.addEventListener('scroll', fire, { passive: true, once: true })
    }

    function checkScrollable() {
      if (document.documentElement.scrollHeight > window.innerHeight) {
        ro.disconnect()
        switchToScroll()
      }
    }

    ro = new ResizeObserver(checkScrollable)
    ro.observe(document.body)
    checkScrollable() // catches pages that are already scrollable at mount

    // Fallback: show after a pause for pages that are genuinely too short to scroll
    timer = setTimeout(fire, 1200)

    return () => {
      fired = true
      clearTimeout(timer)
      ro.disconnect()
      window.removeEventListener('scroll', fire)
    }
  }, [])

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(CONSENT_DATA_KEY)) } catch (e) { return null }
  }

  function saveAndApply(analytics) {
    try {
      localStorage.setItem(CONSENT_DATA_KEY, JSON.stringify({ necessary: true, analytics }))
      localStorage.setItem(CONSENT_KEY, analytics ? 'granted' : 'denied')
    } catch (e) {}
    window.sgwCookieConsent = analytics ? 'granted' : 'denied'
    if (typeof window.gtag === 'function') {
      if (analytics) {
        window.gtag('consent', 'update', { analytics_storage: 'granted' })
        window.gtag('event', 'page_view')
      } else {
        window.gtag('consent', 'update', { analytics_storage: 'denied' })
      }
    }
  }

  function hideBanner() {
    setBannerVisible(false)
    setTimeout(() => setDecided(true), 500)
  }

  function accept() {
    saveAndApply(true)
    hideBanner()
  }

  function decline() {
    saveAndApply(false)
    hideBanner()
  }

  function openModal() {
    const prefs = loadPrefs()
    setAnalyticsChecked(prefs ? prefs.analytics : false)
    setShowModal(true)
  }

  function saveModal() {
    saveAndApply(analyticsChecked)
    setShowModal(false)
    hideBanner()
  }

  if (decided) return null

  return (
    <>
      <div className={`sgw-cookie-backdrop${bannerVisible ? ' visible' : ''}`} />

      <div
        className={`sgw-cookie-banner${bannerVisible ? ' sgw-cookie-banner--visible' : ''}`}
        role="region"
        aria-label="Cookie consent"
      >
        <div className="sgw-cookie-inner">
          <div className="sgw-cookie-content">
            <div className="sgw-cookie-text-wrap">
              <h2 className="sgw-cookie-heading">This website uses cookies</h2>
              <p className="sgw-cookie-text">We use cookies to improve your experience and to provide us with insight into how people use our website</p>
              {privacyUrl && (
                <p className="sgw-cookie-text">
                  To find out more, read our <a href={privacyUrl} target="_blank" rel="noopener noreferrer">{privacyLabel || 'cookies policy'}</a>
                </p>
              )}
            </div>
            <div className="sgw-cookie-btns">
              <button className="sgw-cookie-btn sgw-cookie-accept" onClick={accept}>Accept</button>
              <button className="sgw-cookie-btn sgw-cookie-outline" onClick={decline}>Reject</button>
              <button className="sgw-cookie-btn sgw-cookie-outline" onClick={openModal}>Manage cookie preferences</button>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div
          className="sgw-cookie-modal-bg visible"
          role="dialog"
          aria-label="Cookie preferences"
          aria-modal="true"
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}
        >
          <div className="sgw-cookie-modal">
            <button className="sgw-modal-close-btn" aria-label="Close" onClick={() => setShowModal(false)} />
            <h2 className="sgw-modal-title">Cookie preferences</h2>
            <p className="sgw-modal-intro">
              Cookies are tiny pieces of data stored on your device which can enable certain website
              functionality and collect information about how you use websites.
              {privacyUrl && (
                <> To find out more, read our{' '}
                  <a href={privacyUrl} target="_blank" rel="noopener noreferrer">{privacyLabel || 'cookies policy'}</a>.
                </>
              )}{' '}
              You can manage which types of cookies to accept below.
            </p>

            <div className="sgw-toggle-wrap">
              <label className="sgw-toggle-label">
                <input type="checkbox" defaultChecked disabled />
                <span className="sgw-toggle-track" />
              </label>
              <div className="sgw-toggle-info">
                <p className="sgw-toggle-title">Strictly necessary cookies</p>
                <p className="sgw-toggle-desc">These cookies are essential to the operation of this website and help provide basic functionality such as navigation and language support.</p>
              </div>
            </div>

            <div className="sgw-toggle-wrap">
              <label className="sgw-toggle-label">
                <input
                  type="checkbox"
                  checked={analyticsChecked}
                  onChange={e => setAnalyticsChecked(e.target.checked)}
                />
                <span className="sgw-toggle-track" />
              </label>
              <div className="sgw-toggle-info">
                <p className="sgw-toggle-title">Analytical cookies</p>
                <p className="sgw-toggle-desc">These cookies help us improve the performance of this website by giving us anonymised information about how you interact with it.</p>
              </div>
            </div>

            <button className="sgw-modal-save-btn" onClick={saveModal}>Save preferences</button>
          </div>
        </div>
      )}
    </>
  )
}
