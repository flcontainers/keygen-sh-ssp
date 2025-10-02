const express = require('express');
const router = express.Router();

router.get('/dashboard', (req, res) => {
    const userData = {
        email: req.oidc.user.email,
        username: req.oidc.user.preferred_username || req.oidc.user.name,
        roles: req.oidc.user?.[process.env.OIDC_ROLES_PROPERTY || 'roles'] || []
    };
    res.render('user/dashboard', { user: userData });
});

// Only enable debug route in development environment
if (process.env.NODE_ENV === 'development') {
    router.get('/debug-user', (req, res) => {
        res.json({
            user: req.oidc.user,
            rolesProperty: process.env.OIDC_ROLES_PROPERTY,
            roles: req.oidc.user?.[process.env.OIDC_ROLES_PROPERTY || 'roles'] || []
        });
    });
}

module.exports = router;