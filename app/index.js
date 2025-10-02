require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { auth, requiresAuth } = require('express-openid-connect');
const path = require('path');
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();

// Set trust proxy for production environment 
if (process.env.NODE_ENV === 'production') {
  // Enable trust proxy in production
  app.set('trust proxy', true);
  
  // Force HTTPS in production
  app.use((req, res, next) => {
    if (!req.secure) {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
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

// Create store based on environment
let store;
if (process.env.NODE_ENV === 'production') {
  store = new SQLiteStore({
    dir: './sessions', // Directory where SQLite db will be saved
    db: 'sessions.db', // Database filename
    table: 'sessions', // Table name to use
  });
  console.log('Using SQLite session store for production');
} else {
  store = new session.MemoryStore();
  console.log('Using Memory session store for development');
}

// Session setup
app.use(
  session({
    store: store,
    secret: process.env.SESSION,
    resave: false,
    saveUninitialized: true,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
      secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
      sameSite: 'lax'
    },
    rolling: true // Resets the cookie expiration on every response
  })
);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

/**
 * OIDC_ROLES_PROPERTY: Name of the property in the OIDC user payload that contains user roles.
 * Example: 'roles', 'groups', etc. Set this in your .env file to match your OIDC provider's payload.
 */

// OIDC config - derive baseURL and callback path using BASE_APP_URL and OIDC_REDIRECT_URI
const baseAppUrl = process.env.BASE_APP_URL;
const redirectUri = process.env.OIDC_REDIRECT_URI;
const callbackFallback = process.env.OIDC_CALLBACK_PATH || '/auth/callback';

if (!baseAppUrl && !redirectUri) {
  console.error('Missing BASE_APP_URL and OIDC_REDIRECT_URI. Set at least BASE_APP_URL in .env');
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
    scope: 'openid profile email'
  },
  // ensure the library uses the exact callback path derived from env
  routes: {
    callback: callbackPath
  }
};

// Initialize OIDC middleware
app.use(auth(oidcConfig));

// Middleware to check client role
function checkClientRole(role) {
  return (req, res, next) => {
    const rolesProperty = process.env.OIDC_ROLES_PROPERTY || 'roles';
    const clientRoles = req.oidc.user?.[rolesProperty] || [];
    if (clientRoles.includes(role)) {
      return next();
    }
    res.status(403).send('Forbidden: You do not have access to this resource.');
  };
}

// Route handlers
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const licenseRoutes = require('./routes/licenses');

// Basic authentication for user routes
app.use('/', requiresAuth(), userRoutes);

// Admin routes require both authentication and admin role
app.use('/admin', requiresAuth(), checkClientRole('Administrator'), adminRoutes);

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