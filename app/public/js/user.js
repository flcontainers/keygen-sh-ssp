document.addEventListener('DOMContentLoaded', () => {
    console.log('User dashboard loaded');

    const userRoles = JSON.parse(document.getElementById('user-roles').textContent);
    if (userRoles.includes('admin')) {
        const adminButtonContainer = document.getElementById('admin-button-container');
        adminButtonContainer.className = 'btn btn-danger switch-view-btn';
        adminButtonContainer.textContent = 'Switch to Admin View';
        adminButtonContainer.href = '/admin';
    }
});