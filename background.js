// Minimal background service worker for Manifest V3
// This extension works primarily through content scripts and doesn't require
// a persistent background script. The service worker can go inactive without issues.

// No message forwarding needed - content scripts communicate directly with popup
// The extension will work even if this service worker is inactive

console.log('Read Aloud extension service worker loaded');
