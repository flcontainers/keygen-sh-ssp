require('dotenv').config();
const express = require('express');
const { auth, requiresAuth } = require('express-openid-connect');
const path = require('path');
const { afterCallback, revalidateRoles, requireAdmin } = require('./utils/auth');

const app = express();

// Set trust proxy for production environment 
if (process.env.NODE_ENV === 'production') {
  // Enable trust proxy in production
  app.set('trust proxy', true);
  
  // Force HTTPS in production. Redirects to the configured origin rather than the request's
  // Host header, which the client controls and would otherwise make this an open redirect.
  app.use((req, res, next) => {
    if (!req.secure) {
      return res.redirect(301, `${baseURL}${req.originalUrl}`);
    }
    next();
  });
} else {
  // Default trust proxy setting for development
  app.set('trust proxy', false);
}

// Set up EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Security headers. All scripts and styles are same-origin files, so the CSP needs no
// 'unsafe-inline'; frame-ancestors/X-Frame-Options stop the admin UI being framed (clickjacking).
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  if (process.env.NODE_ENV === 'production') {
    res.set('Strict-Transport-Security', 'max-age=31536000');
  }
  next();
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Sessions are handled entirely by express-openid-connect (encrypted cookie, see auth() below).

/**
 * OIDC_ROLES_PROPERTY: Name of the property in the OIDC user payload that contains user roles.
 * Example: 'roles', 'groups', etc. Set this in your .env file to match your OIDC provider's payload.
 */

// OIDC config - derive baseURL and callback path using BASE_APP_URL and OIDC_REDIRECT_URI
const baseAppUrl = process.env.BASE_APP_URL;
const redirectUri = process.env.OIDC_REDIRECT_URI;
const callbackFallback = process.env.OIDC_CALLBACK_PATH || '/auth/callback';

if (!baseAppUrl && !redirectUri) {
  console.error('Missing BASE_APP_URL. Set at least BASE_APP_URL in .env');
  process.exit(1);
}

let baseURL;
let callbackPath;
let parsedRedirect;

if (baseAppUrl) {
  try {
    const parsedBase = new URL(baseAppUrl);
    baseURL = `${parsedBase.protocol}//${parsedBase.host}`; // origin
  } catch (err) {
    console.error('BASE_APP_URL is not a valid URL:', baseAppUrl);
    process.exit(1);
  }

  if (redirectUri) {
    try {
      parsedRedirect = new URL(redirectUri);
    } catch (err) {
      console.error('OIDC_REDIRECT_URI is not a valid URL:', redirectUri);
      process.exit(1);
    }
    // if redirectUri includes a non-root path use it, otherwise use callbackFallback
    callbackPath = parsedRedirect.pathname && parsedRedirect.pathname !== '/' ? parsedRedirect.pathname : callbackFallback;
  } else {
    // no explicit redirectUri, use callbackFallback with provided base app url
    callbackPath = callbackFallback;
  }
} else {
  // no BASE_APP_URL provided: derive origin and callback from redirectUri
  try {
    parsedRedirect = new URL(redirectUri);
  } catch (err) {
    console.error('OIDC_REDIRECT_URI is not a valid URL:', redirectUri);
    process.exit(1);
  }
  baseURL = `${parsedRedirect.protocol}//${parsedRedirect.host}`;
  callbackPath = parsedRedirect.pathname && parsedRedirect.pathname !== '/' ? parsedRedirect.pathname : callbackFallback;
}

// normalize baseURL and callbackPath
if (baseURL.endsWith('/')) baseURL = baseURL.slice(0, -1);
if (!callbackPath.startsWith('/')) callbackPath = `/${callbackPath}`;
if (callbackPath.length > 1 && callbackPath.endsWith('/')) callbackPath = callbackPath.slice(0, -1);

console.log('OIDC baseURL:', baseURL, 'callbackPath:', callbackPath);

const oidcConfig = {
  issuerBaseURL: process.env.OIDC_ISSUER,
  baseURL,
  clientID: process.env.OIDC_CLIENT_ID,
  clientSecret: process.env.OIDC_CLIENT_SECRET,
  secret: process.env.SESSION,
  idpLogout: true,
  authRequired: false,
  authorizationParams: {
    response_type: 'code',
    // offline_access asks the IdP for a refresh token, which is how admin roles get
    // re-verified mid-session (see utils/auth.js).
    scope: 'openid profile email offline_access'
  },
  afterCallback,
  // ensure the library uses the exact callback path derived from env
  routes: {
    callback: callbackPath
  }
};

// Initialize OIDC middleware
app.use(auth(oidcConfig));

// Re-verify admin roles with the IdP so a revoked admin loses access mid-session
app.use(revalidateRoles);

// CSRF defence for the cookie-authenticated API: browsers always send Origin on cross-origin
// and same-origin non-GET fetches, so a state-changing request must come from this app's own
// origin. SameSite=Lax alone doesn't stop same-site (sibling subdomain) pages.
function requireSameOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (req.get('Origin') === baseURL) return next();
  res.status(403).json({ error: 'Forbidden: cross-origin request' });
}

// Route handlers
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const licenseRoutes = require('./routes/licenses');

// Checked before any auth so cross-origin writes are refused outright
app.use('/api', requireSameOrigin);

// Basic authentication for user routes
app.use('/', requiresAuth(), userRoutes);

// Admin routes require both authentication and admin role
app.use('/admin', requiresAuth(), requireAdmin, adminRoutes);

// Redirect root to user dashboard
app.get('/', requiresAuth(), (req, res) => {
  res.redirect('/dashboard');
});

// Middleware to parse JSON bodies
app.use(express.json());

// Protected license routes
app.use('/api', requiresAuth(), licenseRoutes);

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});