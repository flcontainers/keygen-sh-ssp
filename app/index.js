require('dotenv').config();
const express = require('express');
const session = require('express-session');
const Keycloak = require('keycloak-connect');
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

// Session setup for Keycloak
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

// Keycloak config
const keycloakConfig = {
  'realm': process.env.KEYCLOAK_REALM,
  'auth-server-url': process.env.KEYCLOAK_URL,
  'ssl-required': 'external',
  'resource': process.env.KEYCLOAK_ID,
  "credentials": {
    "secret": process.env.KEYCLOAK_SECRET
  },
  "confidential-port": 0
};

// Initialize Keycloak with store
const keycloak = new Keycloak({ 
  store: store,
  clearExpired: true,      // Add this option
  checkInterval: 300       // Check every 5 minutes
}, keycloakConfig);
app.use(keycloak.middleware());

// Middleware to check client role
function checkClientRole(role) {
  return (req, res, next) => {
    const clientId = process.env.KEYCLOAK_ID;
    const clientRoles = req.kauth.grant.access_token.content.resource_access?.[clientId]?.roles || [];
    
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

// Basic authentication for user routes - just needs to be logged in
app.use('/', keycloak.protect(), userRoutes);

// Admin routes require both authentication and admin role
app.use('/admin', keycloak.protect(), checkClientRole('admin'), adminRoutes);

// Redirect root to user dashboard
app.get('/', keycloak.protect(), (req, res) => {
  res.redirect('/dashboard');
});

// Middleware to parse JSON bodies
app.use(express.json());

// Protected license routes
app.use('/api', keycloak.protect(), licenseRoutes);

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});