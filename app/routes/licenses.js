const express = require('express');
const axios = require('axios');
const router = express.Router();
const { logAdminAction } = require('../utils/logger');

// Middleware to attach user information to the request
function attachUser(req, res, next) {
    const token = req.kauth.grant.access_token.content;
    const clientId = process.env.KEYCLOAK_ID;
    const roles = token.resource_access?.[clientId]?.roles || [];

    req.user = {
        email: token.email,
        roles: roles
    };
    console.log('User attached to request:', req.user);
    logAdminAction(token.email, 'USER_LOGIN_INFO', {
        info: 'User logged in'
    });
    next();
}

// Middleware to check admin permissions
function checkAdmin(req, res, next) {
    const token = req.kauth.grant.access_token.content;
    const clientId = process.env.KEYCLOAK_ID;
    const roles = token.resource_access?.[clientId]?.roles || [];

    console.log('Checking admin permissions...');

    if (roles.includes('admin')) {
        console.log('User is admin');
        logAdminAction(token.email, 'USER_ADMIN_CHECK', {
            valid: true
        });
        next();
    } else {
        console.log('User is not admin');
        logAdminAction(token.email, 'USER_ADMIN_CHECK', {
            valid: false
        });
        res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
}

// Fetch licenses for a specific user
router.get('/user/licenses', attachUser, async (req, res) => {
    try {
        const userEmail = req.user.email; // Assuming the user object is attached to the request
        let allLicenses = [];
        let pageNumber = 1;
        let hasMoreLicenses = true;

        while (hasMoreLicenses) {
            const response = await axios.get(
                `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses?page%5Bsize%5D=100&page%5Bnumber%5D=${pageNumber}&user=${userEmail}`,
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                        'Accept': 'application/vnd.api+json',
                    },
                }
            );

            if (response.status !== 200) {
                console.error('[License Service] Error fetching licenses:', response.status);
                return res.status(response.status).json({
                    error: 'Failed to fetch licenses'
                });
            }

            const data = response.data;

            if (!data || !data.data || data.data.length === 0) {
                hasMoreLicenses = false;
            } else {
                allLicenses = allLicenses.concat(data.data.map(license => ({
                    id: license.id,
                    name: license.attributes.name,
                    key: license.attributes.key,
                })));
                pageNumber++;
            }
        }

        res.json({ licenses: allLicenses });

    } catch (error) {
        console.error('[License Service] Error:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Fetch all licenses (admin only)
router.get('/admin/licenses', checkAdmin, attachUser, async (req, res) => {
    try {
        let allLicenses = [];
        let pageNumber = 1;
        let hasMoreLicenses = true;

        while (hasMoreLicenses) {
            const response = await axios.get(
                `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses?page%5Bsize%5D=100&page%5Bnumber%5D=${pageNumber}`,
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                        'Accept': 'application/vnd.api+json',
                    },
                }
            );

            if (response.status !== 200) {
                console.error('[License Service] Error fetching licenses:', response.status);
                return res.status(response.status).json({
                    error: 'Failed to fetch licenses'
                });
            }

            const data = response.data;

            if (!data || !data.data || data.data.length === 0) {
                hasMoreLicenses = false;
            } else {
                allLicenses = allLicenses.concat(data.data.map(license => ({
                    id: license.id,
                    name: license.attributes.name,
                    key: license.attributes.key,
                    ownerId: license.relationships?.owner?.data?.id || 'unknown'
                })));
                pageNumber++;
            }
        }

        res.json({ licenses: allLicenses });

    } catch (error) {
        console.error('[License Service] Error:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Get specific license details
router.get('/licenses/:licenseId', attachUser, async (req, res) => {
    try {
        const { licenseId } = req.params;

        // Fetch specific license details
        const response = await axios.get(
            `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses/${licenseId}`,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                    'Accept': 'application/vnd.api+json',
                },
            }
        );

        if (response.status !== 200) {
            console.error('[License Service] Error fetching license details:', response.status);
            return res.status(response.status).json({
                error: 'Failed to fetch license details'
            });
        }

        const data = response.data;

        // Send filtered license details
        res.json({
            license: {
                id: data.data.id,
                name: data.data.attributes.name,
                key: data.data.attributes.key,
                expiry: data.data.attributes.expiry,
                status: data.data.attributes.status,
                // Add any other relevant fields you want to expose
            }
        });

    } catch (error) {
        console.error('[License Service] Error:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Fetch machines for a specific license
router.get('/licenses/:licenseId/machines', attachUser, async (req, res) => {
    try {
        const { licenseId } = req.params;

        const response = await axios.get(
            `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses/${licenseId}/machines`,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                    'Accept': 'application/vnd.api+json',
                },
            }
        );

        if (response.status !== 200) {
            console.error('[License Service] Error fetching machines:', response.status);
            return res.status(response.status).json({
                error: 'Failed to fetch machines'
            });
        }

        const machines = response.data.data.map(machine => ({
            id: machine.id,
            name: machine.attributes.name,
            ip: machine.attributes.ip,
            fingerprint: machine.attributes.fingerprint,
            status: machine.attributes.status
        }));

        res.json({ machines });

    } catch (error) {
        console.error('[License Service] Error:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Delete a license (admin only)
router.delete('/admin/licenses/:licenseId', checkAdmin, attachUser, async (req, res) => {
    const { licenseId } = req.params;
    const adminEmail = req.user.email;

    try {
        // Delete the license
        const response = await axios.delete(
            `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses/${licenseId}`,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                    'Accept': 'application/vnd.api+json',
                },
            }
        );

        if (response.status !== 204) {
            console.error('[Backend] Error deleting license:', response.status);
            logAdminAction(adminEmail, 'DELETE_LICENSE_FAILED', {
                licenseId,
                statusCode: response.status
            });
            return res.status(response.status).json({
                error: 'Failed to delete license'
            });
        }

        logAdminAction(adminEmail, 'DELETE_LICENSE_SUCCESS', {
            licenseId,
            statusCode: response.status
        });
        res.json({ success: true });

    } catch (error) {
        console.error('[Backend] Server Error:', error);
        logAdminAction(adminEmail, 'DELETE_LICENSE_ERROR', {
            licenseId,
            error: error.message
        });
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Fetch groups (admin only)
router.get('/admin/groups', checkAdmin, attachUser, async (req, res) => {
    try {
        let allGroups = [];
        let pageNumber = 1;
        let hasMoreGroups = true;

        while (hasMoreGroups) {
            const response = await axios.get(
                `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/groups?page%5Bsize%5D=100&page%5Bnumber%5D=${pageNumber}`,
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                        'Accept': 'application/vnd.api+json',
                    },
                }
            );

            if (response.status !== 200) {
                console.error('[License Service] Error fetching groups:', response.status);
                return res.status(response.status).json({
                    error: 'Failed to fetch groups'
                });
            }

            const data = response.data;

            if (!data || !data.data || data.data.length === 0) {
                hasMoreGroups = false;
            } else {
                allGroups = allGroups.concat(data.data.map(group => ({
                    id: group.id,
                    name: group.attributes.name,
                })));
                pageNumber++;
            }
        }

        res.json({ groups: allGroups });

    } catch (error) {
        console.error('[License Service] Error:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Fetch policies (admin only)
router.get('/admin/policies', checkAdmin, attachUser, async (req, res) => {
    try {
        let allPolicies = [];
        let pageNumber = 1;
        let hasMorePolicies = true;

        while (hasMorePolicies) {
            const response = await axios.get(
                `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/policies?page%5Bsize%5D=100&page%5Bnumber%5D=${pageNumber}`,
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                        'Accept': 'application/vnd.api+json',
                    },
                }
            );

            if (response.status !== 200) {
                console.error('[License Service] Error fetching policies:', response.status);
                return res.status(response.status).json({
                    error: 'Failed to fetch policies'
                });
            }

            const data = response.data;

            if (!data || !data.data || data.data.length === 0) {
                hasMorePolicies = false;
            } else {
                allPolicies = allPolicies.concat(data.data.map(policy => ({
                    id: policy.id,
                    name: policy.attributes.name,
                })));
                pageNumber++;
            }
        }

        res.json({ policies: allPolicies });

    } catch (error) {
        console.error('[License Service] Error:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Fetch users (admin only)
router.get('/admin/users', checkAdmin, attachUser, async (req, res) => {
    try {
        let allUsers = [];
        let pageNumber = 1;
        let hasMoreUsers = true;

        while (hasMoreUsers) {
            const response = await axios.get(
                `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/users?page%5Bsize%5D=100&page%5Bnumber%5D=${pageNumber}`,
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                        'Accept': 'application/vnd.api+json',
                    },
                }
            );

            if (response.status !== 200) {
                console.error('[License Service] Error fetching users:', response.status);
                return res.status(response.status).json({
                    error: 'Failed to fetch users'
                });
            }

            const data = response.data;

            if (!data || !data.data || data.data.length === 0) {
                hasMoreUsers = false;
            } else {
                allUsers = allUsers.concat(data.data.map(user => ({
                    id: user.id,
                    firstName: user.attributes.firstName,
                })));
                pageNumber++;
            }
        }

        res.json({ users: allUsers });

    } catch (error) {
        console.error('[License Service] Error:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Create a new license (admin only)
router.post('/admin/licenses', checkAdmin, attachUser, async (req, res) => {
    const { name, policyId, groupId, userId } = req.body;
    const adminEmail = req.user.email;

    if (!name || !policyId || !groupId || !userId) {
        return res.status(400).json({
            error: 'Invalid request body'
        });
    }

    console.log('Received license data:', name, policyId, groupId, userId); // Add this line for debugging

    const licenseData = {
        data: {
            type: 'licenses',
            attributes: {
                name: name
            },
            relationships: {
                policy: {
                    data: {
                        type: 'policies',
                        id: policyId
                    }
                },
                group: {
                    data: {
                        type: 'groups',
                        id: groupId
                    }
                },
                owner: {
                    data: {
                        type: 'users',
                        id: userId
                    }
                }
            }
        }
    };

    //console.log('Sending license data to Keygen:', licenseData); // Add this line for debugging

    try {
        const response = await axios.post(
            `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses`,
            licenseData,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                    'Accept': 'application/vnd.api+json',
                    'Content-Type': 'application/vnd.api+json',
                },
            }
        );

        if (response.status !== 201) {
            console.error('[License Service] Error creating license:', response.status);
            logAdminAction(adminEmail, 'CREATE_LICENSE_FAILED', 
                { name, policyId, groupId, userId }
            );
            return res.status(response.status).json({
                error: 'Failed to create license'
            });
        }

        const createdLicense = response.data;
        logAdminAction(adminEmail, 'CREATE_LICENSE_SUCCESS', 
            { name, policyId, groupId, userId }
        );
        //console.log('Created license:', createdLicense); // Add this line for debugging

        res.json({ success: true, license: createdLicense });

    } catch (error) {
        console.error('[License Service] Error:', error);
        logAdminAction(adminEmail, 'CREATE_LICENSE_ERROR', 
            { name, policyId, groupId, userId, error: error.message }
        );
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Create a new user (admin only)
let requestCount = 0;

router.post('/admin/createuser', checkAdmin, attachUser, async (req, res) => {
    const requestId = ++requestCount;
 
    const { firstName, userName, userEmail, userpassword, userGroup } = req.body;
    const adminEmail = req.user.email;
 
    if (!firstName || !userName || !userEmail || !userpassword || !userGroup) {
        return res.status(400).json({
            error: 'Missing required fields'
        });
    }
 
    const userData = {
        data: {
            type: 'users',
            attributes: {
                firstName: firstName,
                lastName: userName,
                email: userEmail,
                password: userpassword,
                role: 'user'
            },
            relationships: {
                group: {
                    data: {
                        type: 'groups',
                        id: userGroup
                    }
                }
            }
        }
    };
 
    console.log('[Pre-Request] Attempting user creation with data:', userData);
 
    try {
        const response = await axios.post(
            `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/users`,
            userData,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                    'Accept': 'application/vnd.api+json',
                    'Content-Type': 'application/vnd.api+json'
                },
                maxRedirects: 0,
                validateStatus: null
            }
        );
        
        console.log('[Response] Status:', response.status);
        logAdminAction(adminEmail, 'CREATE_USER_SUCCESS', 
            { firstName, userName, userEmail, userGroup }
        );
        //console.log(`[Request ${requestId}] Completed with status:`, response.status);
 
        res.json({ success: true, user: response.data });
 
    } catch (error) {
        console.log(`[Request ${requestId}] Failed with error:`, error.response?.status);
        logAdminAction(adminEmail, 'CREATE_USER_ERROR', 
            { firstName, userName, userEmail, userGroup, error: error.message }
        );
        console.error('[Error Details]', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            headers: error.response?.headers
        });
        res.status(error.response?.status || 500).json({
            error: error.response?.data?.errors || 'Internal server error'
        });
    }
 });

// Fetch machines associated with a license key
router.post('/fetchMachines', attachUser, async (req, res) => {
    const { licenseId } = req.body;
    console.log('[Backend] Path: /fetchMachines, Checked License ID:', licenseId);

    try {
        // Fetch machines associated with the license key
        const machinesResponse = await axios.get(
            `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/machines?limit=100&license=${licenseId}`,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                    'Accept': 'application/vnd.api+json',
                },
            }
        );

        if (machinesResponse.status !== 200) {
            console.error('[Backend] Error fetching machines:', machinesResponse.status);
            return res.status(404).json({
                errors: [{ title: 'License check error', detail: 'There was an issue checking the machine id.' }],
            });
        }

        const machinesData = machinesResponse.data;

        if (machinesData.errors) {
            return res.json({ errors: machinesData.errors });
        }

        if (machinesData.data.length === 0) {
            return res.json({
                errors: [{ title: 'Machine not found', detail: 'No machines found associated with the provided license key.' }],
            });
        }

        // Extract the necessary attributes from the machines
        const machines = machinesData.data.map(machine => ({
            id: machine.id,
            name: machine.attributes.name,
            ip: machine.attributes.ip,
            fingerprint: machine.attributes.fingerprint,
        }));

        console.log('[Backend] Return OK');
        res.json({ machines });

    } catch (error) {
        // Handle any unexpected errors in the entire chain
        console.error('[Backend] Server Error:', error);
        res.status(500).json({
            errors: [{ title: 'Server Error', detail: error.message }],
        });
    }
});

// Deactivate a machine
router.delete('/deactivateMachine/:machineId', attachUser, async (req, res) => {
    const { machineId } = req.params;

    try {
        // Deactivate the machine
        const response = await axios.delete(
            `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/machines/${machineId}`,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                    'Accept': 'application/vnd.api+json',
                },
            }
        );

        if (response.status !== 204) {
            console.error('[Backend] Error deactivating machine:', response.status);
            return res.status(response.status).json({
                error: 'Failed to deactivate machine'
            });
        }

        res.json({ success: true });

    } catch (error) {
        console.error('[Backend] Server Error:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Delete a user (admin only)
router.delete('/admin/users/:userId', checkAdmin, attachUser, async (req, res) => {
    const { userId } = req.params;
    const adminEmail = req.user.email;

    try {
        const response = await axios.delete(
            `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/users/${userId}`,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                    'Accept': 'application/vnd.api+json',
                },
            }
        );

        if (response.status !== 204) {
            console.error('[Backend] Error deleting user:', response.status);
            logAdminAction(adminEmail, 'DELETE_USER_FAILED', userId);
            return res.status(response.status).json({
                error: 'Failed to delete user'
            });
        }

        res.json({ success: true });
        logAdminAction(adminEmail, 'DELETE_USER_SUCCESS', userId);

    } catch (error) {
        console.error('[Backend] Server Error:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

module.exports = router;
