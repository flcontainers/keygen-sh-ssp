const express = require('express');
const router = express.Router();
const { getRoles } = require('../utils/auth');

router.get('/', (req, res) => {
    const userData = {
        email: req.oidc.user.email,
        username: req.oidc.user.preferred_username || req.oidc.user.name,
        roles: getRoles(req)
    };
    res.render('admin/dashboard', { user: userData });
});

module.exports = router;