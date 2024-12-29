require('dotenv').config();
const express = require('express');
const session = require('express-session');
const Keycloak = require('keycloak-connect');
const path = require('path');

const app = express();

// If behind a proxy, trust the proxy headers
app.set('trust proxy', 1);

// Set up EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session setup for Keycloak
const memoryStore = new session.MemoryStore();

app.use(
  session({
    secret: process.env.SESSION,
    resave: false,
    saveUninitialized: true,
    store: memoryStore,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
      //secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
      //sameSite: 'strict'
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

const keycloak = new Keycloak({ store: memoryStore }, keycloakConfig);
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