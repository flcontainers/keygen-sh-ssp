const express = require('express');
const router = express.Router();

router.get('/dashboard', (req, res) => {
    const userData = {
        email: req.oidc.user.email,
        username: req.oidc.user.preferred_username || req.oidc.user.name,
        roles: req.oidc.user.roles || []
    };
    res.render('user/dashboard', { user: userData });
});

module.exports = router;