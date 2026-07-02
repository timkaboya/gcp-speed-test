/**
 * Application constants
 */

export const APP_NAME = 'GCP Speed Test'

export const SITE_URL = 'https://www.gcpspeed.com'

export const SOCIAL_IMAGE_URL = `${SITE_URL}/og-image.png`

// Google AdSense publisher ID (used by the loader script in index.html and by
// any ad-unit components). Matches the `ca-pub-...` client the site is verified
// under; keep in sync with public/ads.txt.
export const ADSENSE_CLIENT_ID = 'ca-pub-5326404837285761'

// Paystack public key (safe to expose client-side) used by the "Buy me a coffee"
// support widget. Public keys can only initialise transactions, never read data
// or issue refunds. Secret keys are never stored in the client.
export const PAYSTACK_PUBLIC_KEY = 'pk_live_606e2c09086bf8bda71def21af4467e79b41b2ce'

// Every Paystack transaction requires a customer email. Donations are recorded
// under this single placeholder address (no email field is shown to supporters).
export const SUPPORT_EMAIL = 'supporters@gcpspeed.com'

// Currency donations are charged in. Must be enabled on the Paystack account.
export const SUPPORT_CURRENCY = 'USD'

// Preset donation amounts (in whole USD) offered in the support dialog.
export const SUPPORT_TIERS = [3, 5, 10] as const

