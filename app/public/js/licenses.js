document.addEventListener('DOMContentLoaded', function() {
    // Check and clean URL parameters
    cleanURLParameters();
    // Existing initialization code
    loadLicenses();

    // Close modal when clicking the X or outside the modal
    document.querySelector('.close-modal')?.addEventListener('click', closeModal);
    window.addEventListener('click', (event) => {
        const modal = document.getElementById('licenseModal');
        if (event.target === modal) {
            closeModal();
        }
    });
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

async function loadLicenses() {
    try {
        const response = await fetch('/api/user/licenses', {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch licenses');
        }

        const data = await response.json();
        displayLicenses(data.licenses);
    } catch (error) {
        console.error('Error loading licenses:', error);
        document.querySelector('#licenses-table tbody').innerHTML = `
            <tr>
                <td colspan="3" class="error-message">
                    Failed to load licenses. Please try again later.
                </td>
            </tr>
        `;
    }
}

function displayLicenses(licenses) {
    const licensesTableBody = document.querySelector('#licenses-table tbody');

    if (!licenses || licenses.length === 0) {
        licensesTableBody.innerHTML = `
            <tr>
                <td colspan="3" class="no-licenses">No licenses found</td>
            </tr>
        `;
        return;
    }

    licensesTableBody.innerHTML = licenses.map(license => `
        <tr>
            <td><code>${escapeHtml(license.name)}</code></td>
            <td><code>${escapeHtml(license.key)}</code></td>
            <td><button onclick="viewLicenseDetails('${license.id}', '${license.key}')" class="btn btn-primary">View</button></td>
        </tr>
    `).join('');
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
        document.getElementById('license-details-block').scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        console.error('Error loading license details:', error);
        alert('Failed to load license details. Please try again later.');
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

document.addEventListener('DOMContentLoaded', loadLicenses);
