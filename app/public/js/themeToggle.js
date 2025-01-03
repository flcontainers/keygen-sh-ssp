// Check for saved theme preference or default to 'light'
let currentTheme = localStorage.getItem('theme') || 'light';

// Apply theme on page load
document.documentElement.setAttribute('data-theme', currentTheme);

function toggleTheme() {
    // Toggle theme
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    
    // Save preference
    localStorage.setItem('theme', currentTheme);
    
    // Apply theme
    document.documentElement.setAttribute('data-theme', currentTheme);
    
    // Update toggle button text
    const toggleBtn = document.getElementById('theme-toggle');
    toggleBtn.innerHTML = `${currentTheme === 'light' ? '🌙' : '☀️'} ${currentTheme === 'light' ? 'Dark' : 'Light'} Mode`;
}

// Initialize button text on page load
window.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('theme-toggle');
    toggleBtn.innerHTML = `${currentTheme === 'light' ? '🌙' : '☀️'} ${currentTheme === 'light' ? 'Dark' : 'Light'} Mode`;
});