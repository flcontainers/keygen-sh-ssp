document.addEventListener('DOMContentLoaded', function() {
    // Check and clean URL parameters
    cleanURLParameters();
});

function cleanURLParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('iss')) {
        console.log('Detected iss parameter:', urlParams.get('iss'));
        // Remove the iss parameter
        urlParams.delete('iss');
        // Update URL without reloading the page
        const newURL = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
        window.history.replaceState({}, '', newURL);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    loadLicenses();

    // Close modal when clicking the X or outside the modal
    document.querySelector('.close-modal')?.addEventListener('click', closeModal);
    window.addEventListener('click', (event) => {
        const modal = document.getElementById('createLicenseModal');
        if (event.target === modal) {
            closeModal();
        }
    });

    document.getElementById('createLicenseForm')?.addEventListener('submit', createLicense);
});

async function loadLicenses() {
    try {
        const response = await fetch('/api/admin/licenses', {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch licenses');
        }

        const data = await response.json();
        const licensesTableBody = document.querySelector('#licenses-table tbody');
        licensesTableBody.innerHTML = '';

        data.licenses.forEach(license => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><code>${license.name}</code></td>
                <td><code>${license.key}</code></td>
                <td>
                    <button class="btn btn-primary" onclick="viewLicenseDetails('${license.id}')">View</button>
                    <button class="btn btn-warning" onclick="renewLicense('${license.id}')">Renew</button>
                    <button class="btn btn-danger" onclick="confirmDeleteLicense('${license.id}')">Delete</button>
                </td>
            `;
            licensesTableBody.appendChild(row);
        });
    } catch (error) {
        console.error('Error loading licenses:', error);
        alert('Failed to load licenses. Please try again later.');
    }
}

async function viewLicenseDetails(licenseId) {
    try {
        const response = await fetch(`/api/licenses/${licenseId}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch license details');
        }

        const data = await response.json();
        displayLicenseDetails(data.license);

        // Ensure the machine block is displayed
        document.getElementById('machines-list-block').style.display = 'block';

        // Fetch and display machines associated with the license
        await fetchMachines(licenseId);

        // Scroll to the license details block
        const licenseDetailsBlock = document.getElementById('license-details-block');
        licenseDetailsBlock.setAttribute('data-license-id', licenseId); // Set the data-license-id attribute
        licenseDetailsBlock.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        console.error('Error loading license details:', error);
        alert('Failed to load license details. Please try again later.');
    }
}

function confirmDeleteLicense(licenseId) {
    if (confirm('Are you sure you want to delete this license?')) {
        deleteLicense(licenseId);
    }
}

async function deleteLicense(licenseId) {
    try {
        const response = await fetch(`/api/admin/licenses/${licenseId}`, {
            method: 'DELETE',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to delete license');
        }

        const data = await response.json();
        if (data.success) {
            alert('License deleted successfully');
            loadLicenses(); // Refresh the licenses list
        } else {
            alert('Failed to delete license');
        }
    } catch (error) {
        console.error('Error deleting license:', error);
        alert('Failed to delete license. Please try again later.');
    }
}

function filterLicenses() {
    const searchInput = document.getElementById('license-search').value.toLowerCase();
    const licensesTableBody = document.querySelector('#licenses-table tbody');
    const rows = licensesTableBody.getElementsByTagName('tr');

    for (let i = 0; i < rows.length; i++) {
        const cells = rows[i].getElementsByTagName('td');
        const name = cells[0].textContent.toLowerCase();
        const key = cells[1].textContent.toLowerCase();

        if (name.includes(searchInput) || key.includes(searchInput)) {
            rows[i].style.display = '';
        } else {
            rows[i].style.display = 'none';
        }
    }
}

// Function to handle different modals
function openCreateLicenseModal() {
    document.getElementById('createLicenseModal').style.display = 'block';
    loadGroups('associatedGroup'); // Specify element ID for license modal
    loadPolicies();
    loadUsers();
}

function closeModal() {
    document.getElementById('createLicenseModal').style.display = 'none';
}

// Modified loadGroups function that maintains compatibility
async function loadGroups(elementId = 'associatedGroup') {
    try {
        const response = await fetch('/api/admin/groups', {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch groups');
        }

        const data = await response.json();
        const groupSelect = document.getElementById(elementId);
        
        if (!groupSelect) {
            console.error(`Element with ID ${elementId} not found`);
            return;
        }

        groupSelect.innerHTML = '<option value="">Select a group</option>';
        data.groups.forEach(group => {
            const option = document.createElement('option');
            option.value = group.id;
            option.textContent = group.name;
            groupSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading groups:', error);
    }
}

async function loadPolicies() {
    try {
        const response = await fetch('/api/admin/policies', {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch policies');
        }

        const data = await response.json();
        const policySelect = document.getElementById('associatedPolicy');
        policySelect.innerHTML = '<option value="">Select a policy</option>';
        data.policies.forEach(policy => {
            const option = document.createElement('option');
            option.value = policy.id;
            option.textContent = policy.name;
            policySelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading policies:', error);
    }
}

// Add debug logging to loadUsers function
async function loadUsers(elementId = 'associatedUser') {
    try {
        const response = await fetch('/api/admin/users', {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch users');
        }

        const data = await response.json();        
        const userSelect = document.getElementById(elementId);
        if (!userSelect) {
            console.error('Select element not found:', elementId);
            return;
        }

        // Clear existing options
        userSelect.innerHTML = '<option value="">Select a user</option>';

        const usersWithCallsigns = data.users.map(user => {
            const match = user.firstName.match(/\((.*?)\)/);
            const displayName = match ? match[1] : user.firstName;
            return { id: user.id, displayName };
        });

        usersWithCallsigns.sort((a, b) => a.displayName.localeCompare(b.displayName));

        usersWithCallsigns.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = user.displayName;
            userSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

async function createLicense(event) {
    event.preventDefault();

    const licenseName = document.getElementById('licenseName').value;
    const associatedUserId = document.getElementById('associatedUser').value;
    const associatedGroupId = document.getElementById('associatedGroup').value;
    const associatedPolicyId = document.getElementById('associatedPolicy').value;

    const licenseData = {
        name: licenseName,
        policyId: associatedPolicyId,
        groupId: associatedGroupId,
        userId: associatedUserId
    };

    try {
        const response = await fetch('/api/admin/licenses', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(licenseData)
        });

        if (!response.ok) {
            throw new Error('Failed to create license');
        }

        const data = await response.json();
        if (data.success) {
            alert('License created successfully');
            closeModal();
            loadLicenses(); // Refresh the licenses list
        } else {
            alert('Failed to create license');
        }
    } catch (error) {
        console.error('Error creating license:', error);
        alert('Failed to create license. Please try again later.');
    }
}

// User creation modal functions
// User modal functions with explicit element ID
function openCreateUserModal() {
    document.getElementById('createUserModal').style.display = 'block';
    loadGroups('userGroup'); // Specify element ID for user modal
}

function closeUserModal() {
    document.getElementById('createUserModal').style.display = 'none';
}

// Add event listener for user creation form
document.getElementById('createUserForm')?.addEventListener('submit', validateUserForm);

function validateUserForm(event) {
    event.preventDefault();
    const form = event.target;
    const email = document.getElementById('userEmail');
    
    if (!email.value.includes('@') || !email.value.includes('.')) {
        email.setCustomValidity('Please enter a valid email address');
        email.reportValidity();
        return false;
    }
    
    email.setCustomValidity('');
    if (form.checkValidity()) {
        createUser(event); // Pass form instead of event
    }
    
    return false;
}

// Add password generation function
function generatePassword(length = 18) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*?';
    return Array.from(crypto.getRandomValues(new Uint32Array(length)))
        .map((x) => chars[x % chars.length])
        .join('');
}

// Modify createUser function
let isSubmitting = false;

async function createUser(event) {
    event.preventDefault();
    
    if (isSubmitting) return;
    isSubmitting = true;
    
    const userData = {
        firstName: document.getElementById('firstName').value,
        userName: document.getElementById('userName').value,
        userEmail: document.getElementById('userEmail').value,
        userpassword: generatePassword(),
        userGroup: document.getElementById('userGroup').value
    };

    try {
        const response = await fetch('/api/admin/createuser', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userData)
        });

        if (!response.ok) throw new Error('Failed to create user');

        const data = await response.json();
        if (data.success) {
            //alert(`User created successfully\nGenerated password: ${userData.userpassword}\nPlease save this password!`);
            alert(`User created successfully`);
            closeUserModal();
            event.target.reset();
        }
    } catch (error) {
        console.error('Error creating user:', error);
        alert('Failed to create user. Please try again later.');
    } finally {
        isSubmitting = false;
    }
}

async function fetchMachines(licenseId) {
    try {
        const response = await fetch('/api/fetchMachines', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ licenseId })
        });

        if (!response.ok) {
            throw new Error('Failed to fetch machines');
        }

        const data = await response.json();
        displayMachines(data.machines);
    } catch (error) {
        console.error('Error fetching machines:', error);
        document.getElementById('machines-container').innerHTML = `
            <p class="error-message">Failed to load machines. Please try again later.</p>
        `;
    }
}

function displayMachines(machines) {
    const machinesTableBody = document.querySelector('#machines-table tbody');

    if (!machines || machines.length === 0) {
        machinesTableBody.innerHTML = `
            <tr>
                <td colspan="5" class="no-machines">No machines activated</td>
            </tr>
        `;
        return;
    }

    machinesTableBody.innerHTML = machines.map(machine => {
        const ip = machine.ip ? machine.ip.slice(7, -2) : '';
        return `
            <tr>
                <td><code>${escapeHtml(machine.id.substring(0, 5))}</code></td>
                <td><code>${escapeHtml(machine.name || '')}</code></td>
                <td><code>${escapeHtml(ip || '')}</code></td>
                <td><code>${escapeHtml(machine.fingerprint || '')}</code></td>
                <td><button onclick="deactivateMachine('${machine.id}')" class="btn btn-danger">Deactivate</button></td>
            </tr>
        `;
    }).join('');
}

function displayLicenseDetails(license) {
    const detailsContainer = document.getElementById('license-details-content');
    const licenseDetailsBlock = document.getElementById('license-details-block');

    // Parse the expiry date
    const expiryDate = license.expiry ? new Date(license.expiry) : null;
    const formattedExpiryDate = expiryDate ? expiryDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'Never';

    detailsContainer.innerHTML = `
        <div class="license-details">
            <p><strong>Name:</strong> <code>${escapeHtml(license.name)}</code></p>
            <p><strong>Key:</strong> <code>${escapeHtml(license.key)}</code></p>
            <p><strong>Status:</strong> <span class="status-badge ${license.status.toLowerCase()}">${escapeHtml(license.status)}</span></p>
            <p><strong>Expiry:</strong> ${formattedExpiryDate}</p>
        </div>
    `;

    licenseDetailsBlock.classList.remove('active', 'inactive', 'other');
    if (license.status.toLowerCase() === 'active') {
        licenseDetailsBlock.classList.add('active');
    } else if (license.status.toLowerCase() === 'inactive') {
        licenseDetailsBlock.classList.add('inactive');
    } else {
        licenseDetailsBlock.classList.add('other');
    }

    licenseDetailsBlock.style.display = 'block';
}

async function deactivateMachine(machineId) {
    try {
        const response = await fetch(`/api/deactivateMachine/${machineId}`, {
            method: 'DELETE',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to deactivate machine');
        }

        const data = await response.json();
        if (data.success) {
            alert('Machine deactivated successfully');
            // Refresh the machines list
            const licenseId = document.querySelector('#license-details-block').getAttribute('data-license-id');
            await fetchMachines(licenseId);
        } else {
            alert('Failed to deactivate machine');
        }
    } catch (error) {
        console.error('Error deactivating machine:', error);
        alert('Failed to deactivate machine. Please try again later.');
    }
}

// Security: Escape HTML to prevent XSS
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function openDeleteUserModal() {
    console.log('Opening delete user modal');
    const modal = document.getElementById('deleteUserModal');
    modal.style.display = 'block';
    loadUsers('userToDelete'); // Debug - verify this call
}

function closeDeleteUserModal() {
    document.getElementById('deleteUserModal').style.display = 'none';
}

async function deleteSelectedUser() {
    const userSelect = document.getElementById('userToDelete');
    const userId = userSelect.value;
    
    if (!userId) {
        alert('Please select a user to delete');
        return;
    }

    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/users/${userId}`, {
            method: 'DELETE',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to delete user');
        }

        const data = await response.json();
        if (data.success) {
            alert('User deleted successfully');
            closeDeleteUserModal();
            // Reload the users list
            loadUsers('userToDelete');
        } else {
            alert('Failed to delete user');
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        alert('Failed to delete user. Please try again later.');
    }
}

async function renewLicense(licenseId) {
    try {
        const response = await fetch(`/api/admin/renewlicense/${licenseId}`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to renew license');
        }

        const data = await response.json();
        if (data.success) {
            alert('License renewed successfully');
            loadLicenses(); // Refresh the licenses list

            // Check if the license details block is visible and matches the renewed license ID
            const licenseDetailsBlock = document.getElementById('license-details-block');
            if (licenseDetailsBlock.style.display !== 'none' && licenseDetailsBlock.getAttribute('data-license-id') === licenseId) {
                viewLicenseDetails(licenseId); // Reload the license details
            }
        } else {
            alert('Failed to renew license');
        }
    } catch (error) {
        console.error('Error renewing license:', error);
        alert('Failed to renew license. Please try again later.');
    }
}

document.addEventListener('DOMContentLoaded', loadLicenses);
