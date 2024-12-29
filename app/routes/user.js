const express = require('express');
const router = express.Router();

router.get('/dashboard', (req, res) => {
    const clientId = process.env.KEYCLOAK_ID;
    
    const userData = {
        email: req.kauth.grant.access_token.content.email,
        username: req.kauth.grant.access_token.content.preferred_username,
        roles: req.kauth.grant.access_token.content.resource_access?.[clientId]?.roles || []
    };
    
    res.render('user/dashboard', { user: userData });
});

module.exports = router;