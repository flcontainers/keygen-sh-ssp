const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    // Get the client ID from environment variables
    const clientId = process.env.KEYCLOAK_ID;
    
    const userData = {
        email: req.kauth.grant.access_token.content.email,
        username: req.kauth.grant.access_token.content.preferred_username,
        roles: req.kauth.grant.access_token.content.resource_access?.[clientId]?.roles || []
    };
    
    res.render('admin/dashboard', { user: userData });
});

module.exports = router;