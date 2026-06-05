/**
 * TrackFlow: Field Service Locator & Customer Tracker
 * GitHub Pages–compatible build with fixed Supabase Auth (PKCE) handling.
 *
 * Fixes vs. previous version:
 *  - Properly exchanges ?code=... from email-confirmation and password-reset links
 *    for a real session (PKCE flow is the default in @supabase/supabase-js v2).
 *  - Sets emailRedirectTo on signUp so the verification link returns to this app.
 *  - Sets redirectTo on resetPasswordForEmail dynamically (works on any deployment).
 *  - Surfaces #error / #error_description hash responses from Supabase as toasts.
 *  - Detects password-recovery flow from BOTH the new `?code=...&type=recovery`
 *    query string AND the legacy `#type=recovery` hash.
 *  - Robust session bootstrap so reset-password never fails with
 *    "Auth session missing!" again.
 *
 * IMPORTANT — Supabase Dashboard settings required:
 *   Authentication → URL Configuration
 *     Site URL:       https://manukumarm1020-source.github.io/field-worker-map-tracker/
 *     Redirect URLs:  https://manukumarm1020-source.github.io/field-worker-map-tracker/**
 */

// Global State Variables
let supabaseClient = null;
let map = null;
let markers = [];
let tempMarker = null;
let selectedCoords = null;
let customersData = [];
let sessionUser = null;
let userWorkerName = '';
let userLocationMarker = null;
let authMode = 'login';            // 'login' | 'signup' | 'forgot-password' | 'reset-password'
let isPasswordRecoveryFlow = false; // true once we know this page load is a recovery flow

// DOM Elements
const elements = {
  tabLog: document.getElementById('tab-log'),
  tabDatabase: document.getElementById('tab-database'),
  panelForm: document.getElementById('panel-form'),
  panelDatabase: document.getElementById('panel-database'),
  customerCount: document.getElementById('customer-count'),

  btnSettings: document.getElementById('btn-settings'),
  btnLogout: document.getElementById('btn-logout'),
  settingsModal: document.getElementById('settings-modal'),
  settingsForm: document.getElementById('settings-form'),
  btnClearSettings: document.getElementById('btn-clear-settings'),
  btnCloseSettings: document.getElementById('btn-close-settings'),
  modalCloseOverlay: document.getElementById('modal-close-overlay'),
  supabaseUrlInput: document.getElementById('settings-supabase-url'),
  supabaseKeyInput: document.getElementById('settings-supabase-key'),
  mapCredentialsOverlay: document.getElementById('map-credentials-overlay'),
  btnSetupOverlay: document.getElementById('btn-setup-overlay'),

  authOverlay: document.getElementById('auth-overlay'),
  authNavTabs: document.getElementById('auth-nav-tabs'),
  authTabLogin: document.getElementById('auth-tab-login'),
  authTabSignup: document.getElementById('auth-tab-signup'),
  authForm: document.getElementById('auth-form'),
  authGroupEmail: document.getElementById('auth-group-email'),
  authGroupWorkerName: document.getElementById('auth-group-worker-name'),
  authGroupPassword: document.getElementById('auth-group-password'),
  authGroupConfirmPassword: document.getElementById('auth-group-confirm-password'),
  authPasswordLabel: document.getElementById('auth-password-label'),
  authForgotPasswordLink: document.getElementById('auth-forgot-password-link'),
  authConfirmPassword: document.getElementById('auth-confirm-password'),
  authEmail: document.getElementById('auth-email'),
  authWorkerName: document.getElementById('auth-worker-name'),
  authPassword: document.getElementById('auth-password'),
  btnAuthSubmit: document.getElementById('btn-auth-submit'),
  authFooter: document.getElementById('auth-footer'),
  authBackToLoginLink: document.getElementById('auth-back-to-login-link'),

  customerForm: document.getElementById('customer-form'),
  coordsCard: document.getElementById('coords-card'),
  valLatitude: document.getElementById('val-latitude'),
  valLongitude: document.getElementById('val-longitude'),
  inputName: document.getElementById('input-name'),
  inputWorker: document.getElementById('input-worker'),
  inputPhone: document.getElementById('input-phone'),
  inputNotes: document.getElementById('input-notes'),
  btnSave: document.getElementById('btn-save'),

  searchInput: document.getElementById('search-input'),
  btnClearSearch: document.getElementById('btn-clear-search'),
  customerList: document.getElementById('customer-list'),

  mapViewport: document.getElementById('map'),
  btnMyLocation: document.getElementById('btn-my-location'),
  toastContainer: document.getElementById('toast-container')
};

// ----------------------------------------------------
// 1. Initialization and Auth Listeners
// ----------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadSavedSettings();
  initLeafletMap();
  initializeDatabaseConnection();
});

function setupEventListeners() {
  elements.tabLog.addEventListener('click', () => switchTab('log'));
  elements.tabDatabase.addEventListener('click', () => switchTab('database'));

  elements.btnSettings.addEventListener('click', openSettingsModal);
  elements.btnCloseSettings.addEventListener('click', closeSettingsModal);
  elements.modalCloseOverlay.addEventListener('click', closeSettingsModal);
  elements.btnSetupOverlay.addEventListener('click', openSettingsModal);
  elements.settingsForm.addEventListener('submit', handleSettingsSave);
  elements.btnClearSettings.addEventListener('click', handleSettingsClear);

  elements.authTabLogin.addEventListener('click', () => switchAuthMode('login'));
  elements.authTabSignup.addEventListener('click', () => switchAuthMode('signup'));
  elements.authForgotPasswordLink.addEventListener('click', (e) => {
    e.preventDefault();
    switchAuthMode('forgot-password');
  });
  elements.authBackToLoginLink.addEventListener('click', (e) => {
    e.preventDefault();
    switchAuthMode('login');
  });
  elements.authForm.addEventListener('submit', handleAuthSubmit);
  elements.btnLogout.addEventListener('click', handleLogOut);

  elements.customerForm.addEventListener('submit', handleCustomerSave);

  elements.searchInput.addEventListener('input', (e) => {
    const value = e.target.value;
    toggleClearSearchButton(value.length > 0);
    filterCustomers(value);
  });
  elements.btnClearSearch.addEventListener('click', clearSearch);

  elements.btnMyLocation.addEventListener('click', () => centerOnMyLocation(true));
}

const defaultSupabaseUrl = 'https://syxfohkdzmfomxifuycs.supabase.co';
const defaultSupabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN5eGZvaGtkem1mb214aWZ1eWNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzODY2MTEsImV4cCI6MjA5NTk2MjYxMX0.6H8OYYo4-kqnIkXlKwx4Lsdvk3PGcFfRplC2TSC1w44';

function loadSavedSettings() {
  let supabaseUrl = localStorage.getItem('supabase_url');
  let supabaseKey = localStorage.getItem('supabase_key');
  if (!supabaseUrl) { localStorage.setItem('supabase_url', defaultSupabaseUrl); supabaseUrl = defaultSupabaseUrl; }
  if (!supabaseKey) { localStorage.setItem('supabase_key', defaultSupabaseKey); supabaseKey = defaultSupabaseKey; }
  elements.supabaseUrlInput.value = supabaseUrl;
  elements.supabaseKeyInput.value = supabaseKey;
}

function initLeafletMap() {
  const defaultCenter = [40.7128, -74.0060];
  map = L.map(elements.mapViewport, { zoomControl: false, attributionControl: true }).setView(defaultCenter, 12);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd', maxZoom: 20
  }).addTo(map);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  map.on('click', (e) => setPickedLocation({ lat: e.latlng.lat, lng: e.latlng.lng }));
  centerOnMyLocation(false);
}

/**
 * The canonical redirect target for Supabase emails. Uses the current origin +
 * pathname so this works for any deployment (GitHub Pages subpath, custom
 * domains, localhost) without code changes. Strips trailing 'index.html'.
 */
function getAppRedirectUrl() {
  const { origin, pathname } = window.location;
  const cleanPath = pathname.replace(/index\.html$/i, '');
  return origin + cleanPath;
}

/**
 * Reads the URL for either an error response or an auth `code` / hash tokens
 * coming back from Supabase email links. Returns true if this load is a
 * password-recovery flow so the caller can route to the reset-password screen.
 */
async function processAuthCallbackFromUrl() {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));

  // 1) Surface any error from Supabase (e.g. expired link).
  const errorDesc = search.get('error_description') || hash.get('error_description');
  const errorCode = search.get('error') || hash.get('error');
  if (errorCode || errorDesc) {
    showToast(`Auth link error: ${errorDesc || errorCode}`, 'danger');
    cleanUrl();
    return false;
  }

  // 2) PKCE flow (current default): `?code=...&type=...`
  const code = search.get('code');
  const typeParam = search.get('type') || hash.get('type');
  if (code) {
    try {
      const { error } = await supabaseClient.auth.exchangeCodeForSession(window.location.href);
      if (error) throw error;
    } catch (err) {
      console.error('exchangeCodeForSession failed:', err);
      showToast(`Could not complete sign-in from email link: ${err.message || err}`, 'danger');
      cleanUrl();
      return false;
    }
    cleanUrl();
    return typeParam === 'recovery';
  }

  // 3) Legacy implicit/hash flow: `#access_token=...&type=recovery` or `#type=recovery`
  if (hash.get('access_token') || hash.get('type')) {
    // supabase-js auto-handles hash tokens (detectSessionInUrl). Just clean the URL.
    cleanUrl();
    return typeParam === 'recovery' || hash.get('type') === 'recovery';
  }

  return false;
}

function cleanUrl() {
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search.replace(/[?&]?(code|type|error|error_code|error_description)=[^&]*/g, '').replace(/^&/, '?') || window.location.pathname);
  } catch (_) {
    window.history.replaceState(null, '', window.location.pathname);
  }
}

async function initializeDatabaseConnection() {
  const supabaseUrl = localStorage.getItem('supabase_url');
  const supabaseKey = localStorage.getItem('supabase_key');

  if (!supabaseUrl || !supabaseKey) {
    elements.mapCredentialsOverlay.classList.remove('hidden');
    elements.authOverlay.classList.add('hidden');
    return;
  }
  elements.mapCredentialsOverlay.classList.add('hidden');

  try {
    if (!window.supabase) {
      await loadExternalScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
    }

    supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
        storage: window.localStorage
      }
    });

    // Subscribe BEFORE doing the URL exchange so we receive PASSWORD_RECOVERY.
    supabaseClient.auth.onAuthStateChange((event, session) => {
      handleAuthStateChange(event, session);
    });

    // Process verification / recovery / OAuth links in the URL.
    const isRecovery = await processAuthCallbackFromUrl();
    if (isRecovery) {
      isPasswordRecoveryFlow = true;
      switchAuthMode('reset-password');
      showToast('Enter and confirm your new password to finish the reset.', 'info');
    }

    // Bootstrap UI from current session (handles refreshes after exchange too).
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!isRecovery) {
      handleAuthStateChange(session ? 'INITIAL_SESSION' : 'SIGNED_OUT', session);
    }
  } catch (err) {
    console.error('Database connection error:', err);
    showToast('Failed to load database client SDK. Check connectivity.', 'danger');
  }
}

async function handleAuthStateChange(event, session) {
  if (event === 'PASSWORD_RECOVERY') {
    isPasswordRecoveryFlow = true;
    switchAuthMode('reset-password');
    showToast('Please type in your new password below.', 'info');
    return;
  }

  // During the recovery flow, Supabase WILL hand us a session for the
  // recovery user. Do NOT treat that as a normal login or it will hide the
  // reset-password form. Keep the user on the reset screen until they update.
  if (isPasswordRecoveryFlow && event !== 'SIGNED_OUT' && event !== 'USER_UPDATED') {
    elements.authOverlay.classList.remove('hidden');
    switchAuthMode('reset-password');
    return;
  }

  if (session) {
    const user = session.user;
    if (!user.email_confirmed_at && !user.confirmed_at) {
      await supabaseClient.auth.signOut();
      showToast('Your email address is not verified yet. Please click the verification link in your inbox.', 'danger');
      return;
    }

    sessionUser = user;
    userWorkerName = sessionUser.user_metadata?.worker_name || sessionUser.email.split('@')[0];
    elements.inputWorker.value = userWorkerName;

    elements.authOverlay.classList.add('hidden');
    elements.btnLogout.classList.remove('hidden');
    showToast(`Logged in as ${userWorkerName}`, 'success');

    await fetchCustomers();
  } else {
    sessionUser = null;
    userWorkerName = '';
    elements.inputWorker.value = '';

    if (authMode !== 'reset-password') {
      elements.authOverlay.classList.remove('hidden');
      elements.btnLogout.classList.add('hidden');
    }

    customersData = [];
    elements.customerCount.innerText = '0';
    elements.customerList.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
        <p>Please log in to view and save customer logs.</p>
      </div>`;

    markers.forEach(m => m.marker.remove());
    markers = [];
    if (userLocationMarker) { userLocationMarker.remove(); userLocationMarker = null; }
  }
}

function loadExternalScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src^="${src}"]`);
    if (existing) { resolve(); return; }
    const script = document.createElement('script');
    script.src = src; script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

// ----------------------------------------------------
// 2. Leaflet Geolocation & Mapping Logic
// ----------------------------------------------------

function centerOnMyLocation(triggerToast = true) {
  if (!map) return;
  if (triggerToast) showToast('Requesting high-accuracy GPS coordinates...', 'info');

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const accuracy = position.coords.accuracy;
      map.setView([lat, lng], 18);

      if (userLocationMarker) {
        userLocationMarker.setLatLng([lat, lng]);
      } else {
        const userIcon = L.divIcon({
          className: 'custom-user-location-pin-container',
          html: `<div class="custom-user-location-pin" title="Your current location"></div>`,
          iconSize: [16, 16], iconAnchor: [8, 8]
        });
        userLocationMarker = L.marker([lat, lng], { icon: userIcon }).addTo(map);
      }
      setPickedLocation({ lat, lng }, false);
      if (triggerToast) showToast(`GPS position locked (accuracy: ${accuracy.toFixed(0)}m). Coords captured!`, 'success');
    },
    (error) => {
      console.error('Geolocation API error:', error);
      let errMsg = 'Failed to fetch GPS coordinates.';
      if (error.code === error.PERMISSION_DENIED) errMsg = 'GPS Permission Denied. Please enable location access in your browser settings.';
      else if (error.code === error.POSITION_UNAVAILABLE) errMsg = 'GPS coordinates are currently unavailable. Check location settings.';
      else if (error.code === error.TIMEOUT) errMsg = 'GPS locator timed out. Check your device GPS signal and try again.';
      showToast(errMsg, 'danger');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

function setPickedLocation(coords, panToCoords = true) {
  selectedCoords = coords;
  const latStr = coords.lat.toFixed(6);
  const lngStr = coords.lng.toFixed(6);
  elements.valLatitude.innerText = latStr;
  elements.valLongitude.innerText = lngStr;
  elements.valLatitude.classList.remove('val-placeholder');
  elements.valLongitude.classList.remove('val-placeholder');
  elements.coordsCard.classList.add('active');

  if (tempMarker) {
    tempMarker.setLatLng([coords.lat, coords.lng]);
  } else {
    const tempIcon = L.divIcon({
      className: 'custom-temp-marker-container',
      html: `<div style="background-color: var(--color-secondary); width: 16px; height: 16px; border: 2.5px solid #ffffff; border-radius: 50%; box-shadow: 0 0 12px var(--color-secondary); animation: spin 2s linear infinite;"></div>`,
      iconSize: [16, 16], iconAnchor: [8, 8]
    });
    tempMarker = L.marker([coords.lat, coords.lng], { icon: tempIcon }).addTo(map);
  }
  if (panToCoords) {
    map.panTo([coords.lat, coords.lng]);
    showToast(`Captured coordinates: ${latStr}, ${lngStr}`, 'info');
  }
}

function clearTempMarker() {
  if (tempMarker && map) { tempMarker.remove(); tempMarker = null; }
  selectedCoords = null;
  elements.valLatitude.innerText = 'Not Selected';
  elements.valLongitude.innerText = 'Not Selected';
  elements.valLatitude.classList.add('val-placeholder');
  elements.valLongitude.classList.add('val-placeholder');
  elements.coordsCard.classList.remove('active');
}

function refreshMapMarkers() {
  if (!map) return;
  markers.forEach(m => m.marker.remove());
  markers = [];

  customersData.forEach(customer => {
    const position = [customer.latitude, customer.longitude];
    const customerIcon = L.divIcon({
      className: 'custom-customer-marker-container',
      html: `<div class="customer-pin" data-id="${customer.id}" style="background-color: var(--color-primary); width: 14px; height: 14px; border: 2px solid white; border-radius: 50%; box-shadow: var(--shadow-glow); cursor: pointer;"></div>`,
      iconSize: [14, 14], iconAnchor: [7, 7]
    });
    const marker = L.marker(position, { icon: customerIcon }).addTo(map);

    const popupHTML = `
      <div class="map-popup-body" style="color: var(--text-primary); font-family: 'Outfit', sans-serif;">
        <h4 style="margin: 0 0 4px 0; font-size: 13px; font-weight: 700; color: #ffffff;">${escapeHtml(customer.name)}</h4>
        <p style="margin: 0 0 4px 0; font-size: 11px; color: var(--text-secondary);"><strong>Phone:</strong> ${escapeHtml(customer.phone)}</p>
        <p style="margin: 0 0 8px 0; font-size: 11px; color: var(--color-secondary);"><strong>Worker:</strong> ${escapeHtml(customer.worker_name)}</p>
        ${customer.notes ? `<p style="margin: 0 0 10px 0; font-size: 11px; background: rgba(255,255,255,0.04); border: 1.5px solid var(--border-color); padding: 6px; border-radius: var(--radius-sm); color: var(--text-secondary); max-height: 80px; overflow-y: auto;">${escapeHtml(customer.notes)}</p>` : ''}
        <div style="display: flex; width: 100%;">
          <a href="https://www.google.com/maps/dir/?api=1&destination=${customer.latitude},${customer.longitude}" target="_blank" style="background: var(--color-success); color: white; border: none; padding: 6px 10px; font-size: 11px; border-radius: var(--radius-sm); text-decoration: none; font-weight: bold; text-align: center; display: block; flex: 1;">Navigate</a>
        </div>
      </div>`;
    marker.bindPopup(popupHTML, { closeButton: true, minWidth: 180 });
    marker.on('click', () => { map.panTo(position); switchTab('database'); highlightCustomerCard(customer.id); });
    markers.push({ id: customer.id, marker });
  });
}

function locateCustomerOnMap(customer) {
  if (!map) return;
  const position = [customer.latitude, customer.longitude];
  map.panTo(position);
  const markerObj = markers.find(m => m.id === customer.id);
  if (markerObj) {
    markerObj.marker.openPopup();
    const el = markerObj.marker.getElement();
    if (el) { el.classList.add('highlighted-marker'); setTimeout(() => el.classList.remove('highlighted-marker'), 3000); }
  }
}

// ----------------------------------------------------
// 3. Database Integrations (Supabase Scoped CRUD)
// ----------------------------------------------------

async function fetchCustomers() {
  if (!supabaseClient || !sessionUser) return;
  try {
    const { data, error } = await supabaseClient
      .from('customer').select('*')
      .eq('worker_id', sessionUser.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    customersData = data || [];
    elements.customerCount.innerText = customersData.length;
    renderCustomerList(customersData);
    refreshMapMarkers();
  } catch (err) {
    console.error('Database fetch error:', err);
    showToast('Failed to sync customer list with Supabase.', 'danger');
  }
}

async function handleCustomerSave(e) {
  e.preventDefault();
  if (!supabaseClient || !sessionUser) { showToast('You must be logged in to save customer records.', 'warning'); return; }
  if (!selectedCoords) {
    showToast('Please select coordinates by tapping the map or clicking My Location.', 'warning');
    elements.coordsCard.style.borderColor = 'var(--color-danger)';
    setTimeout(() => { elements.coordsCard.style.borderColor = ''; }, 1000);
    return;
  }
  const name = elements.inputName.value.trim();
  const workerName = elements.inputWorker.value.trim();
  const phone = elements.inputPhone.value.trim();
  const notes = elements.inputNotes.value.trim();
  if (!name || !workerName || !phone) { showToast('Customer Name, Worker Name, and Phone Number are required.', 'warning'); return; }

  setSaveButtonLoading(true);
  try {
    const { error } = await supabaseClient.from('customer').insert([{
      name, worker_name: workerName, phone,
      latitude: selectedCoords.lat, longitude: selectedCoords.lng,
      notes: notes || null, worker_id: sessionUser.id
    }]);
    if (error) throw error;
    showToast('Customer record saved successfully!', 'success');
    elements.customerForm.reset();
    elements.inputWorker.value = userWorkerName;
    clearTempMarker();
    await fetchCustomers();
    switchTab('database');
  } catch (err) {
    console.error('Insert query error:', err);
    showToast(`Failed to save: ${err.message || err}`, 'danger');
  } finally {
    setSaveButtonLoading(false);
  }
}

async function deleteCustomer(id, name) {
  if (!supabaseClient || !sessionUser) return;
  if (!confirm(`Are you sure you want to delete the record for "${name}"?`)) return;
  showToast('Deleting record...', 'info');
  try {
    const { error } = await supabaseClient.from('customer').delete().eq('id', id).eq('worker_id', sessionUser.id);
    if (error) throw error;
    showToast(`Record for "${name}" deleted.`, 'success');
    await fetchCustomers();
  } catch (err) {
    console.error('Delete query error:', err);
    showToast('Could not delete customer record.', 'danger');
  }
}

// ----------------------------------------------------
// 4. Supabase Authentication Handlers
// ----------------------------------------------------

function switchAuthMode(mode) {
  authMode = mode;
  elements.authEmail.value = '';
  elements.authPassword.value = '';
  elements.authWorkerName.value = '';
  if (elements.authConfirmPassword) elements.authConfirmPassword.value = '';

  elements.authEmail.required = false;
  elements.authPassword.required = false;
  elements.authWorkerName.required = false;
  elements.authConfirmPassword.required = false;

  if (mode === 'login') {
    elements.authNavTabs.classList.remove('hidden');
    elements.authTabLogin.classList.add('active');
    elements.authTabSignup.classList.remove('active');
    elements.authGroupEmail.classList.remove('hidden');
    elements.authGroupPassword.classList.remove('hidden');
    elements.authGroupWorkerName.classList.add('hidden');
    elements.authGroupConfirmPassword.classList.add('hidden');
    elements.authForgotPasswordLink.classList.remove('hidden');
    elements.authFooter.classList.add('hidden');
    elements.authPasswordLabel.innerText = 'Password';
    elements.authEmail.required = true;
    elements.authPassword.required = true;
    elements.btnAuthSubmit.querySelector('.btn-text').innerText = 'Sign In';
  } else if (mode === 'signup') {
    elements.authNavTabs.classList.remove('hidden');
    elements.authTabSignup.classList.add('active');
    elements.authTabLogin.classList.remove('active');
    elements.authGroupEmail.classList.remove('hidden');
    elements.authGroupPassword.classList.remove('hidden');
    elements.authGroupWorkerName.classList.remove('hidden');
    elements.authGroupConfirmPassword.classList.add('hidden');
    elements.authForgotPasswordLink.classList.add('hidden');
    elements.authFooter.classList.add('hidden');
    elements.authPasswordLabel.innerText = 'Password';
    elements.authEmail.required = true;
    elements.authPassword.required = true;
    elements.authWorkerName.required = true;
    elements.btnAuthSubmit.querySelector('.btn-text').innerText = 'Create Account';
  } else if (mode === 'forgot-password') {
    elements.authNavTabs.classList.add('hidden');
    elements.authGroupEmail.classList.remove('hidden');
    elements.authGroupPassword.classList.add('hidden');
    elements.authGroupWorkerName.classList.add('hidden');
    elements.authGroupConfirmPassword.classList.add('hidden');
    elements.authFooter.classList.remove('hidden');
    elements.authEmail.required = true;
    elements.btnAuthSubmit.querySelector('.btn-text').innerText = 'Send Reset Link';
  } else if (mode === 'reset-password') {
    elements.authOverlay.classList.remove('hidden');
    elements.authNavTabs.classList.add('hidden');
    elements.authGroupEmail.classList.add('hidden');
    elements.authGroupPassword.classList.remove('hidden');
    elements.authGroupWorkerName.classList.add('hidden');
    elements.authGroupConfirmPassword.classList.remove('hidden');
    elements.authForgotPasswordLink.classList.add('hidden');
    elements.authFooter.classList.add('hidden');
    elements.authPasswordLabel.innerText = 'New Password';
    elements.authPassword.required = true;
    elements.authConfirmPassword.required = true;
    elements.btnAuthSubmit.querySelector('.btn-text').innerText = 'Update Password';
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  if (!supabaseClient) { showToast('Database not configured. Please open settings.', 'warning'); return; }

  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;
  const workerName = elements.authWorkerName.value.trim();
  const confirmPassword = elements.authConfirmPassword ? elements.authConfirmPassword.value : '';

  setAuthButtonLoading(true);
  try {
    if (authMode === 'login') {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;

    } else if (authMode === 'signup') {
      const { error } = await supabaseClient.auth.signUp({
        email, password,
        options: {
          data: { worker_name: workerName },
          emailRedirectTo: getAppRedirectUrl()
        }
      });
      if (error) throw error;
      showToast('Registration successful! A verification email has been sent. Click the link in the email to verify, then sign in.', 'success');
      switchAuthMode('login');

    } else if (authMode === 'forgot-password') {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: getAppRedirectUrl()
      });
      if (error) throw error;
      showToast('Password reset link sent! Check your inbox.', 'success');
      switchAuthMode('login');

    } else if (authMode === 'reset-password') {
      if (password !== confirmPassword) { showToast('Passwords do not match.', 'warning'); setAuthButtonLoading(false); return; }
      if (password.length < 6) { showToast('Password should be at least 6 characters.', 'warning'); setAuthButtonLoading(false); return; }

      // Sanity check: we MUST have a recovery session at this point.
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) {
        showToast('Your reset link has expired or was already used. Please request a new password reset email.', 'danger');
        isPasswordRecoveryFlow = false;
        switchAuthMode('forgot-password');
        setAuthButtonLoading(false);
        return;
      }

      const { error } = await supabaseClient.auth.updateUser({ password });
      if (error) throw error;

      showToast('Password updated successfully. Please sign in with your new password.', 'success');
      isPasswordRecoveryFlow = false;
      await supabaseClient.auth.signOut();
      switchAuthMode('login');
    }
  } catch (err) {
    console.error('Authentication API error:', err);
    showToast(`Authentication Failed: ${err.message || err}`, 'danger');
  } finally {
    setAuthButtonLoading(false);
  }
}

async function handleLogOut() {
  if (!supabaseClient) return;
  if (!confirm('Are you sure you want to log out of your account?')) return;
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    showToast('Logged out successfully.', 'info');
    switchAuthMode('login');
  } catch (err) {
    console.error('Logout error:', err);
    showToast('Failed to log out correctly.', 'danger');
  }
}

// ----------------------------------------------------
// 5. Settings Modal Controls
// ----------------------------------------------------

function openSettingsModal() { elements.settingsModal.classList.add('active'); }
function closeSettingsModal() { elements.settingsModal.classList.remove('active'); }

function handleSettingsSave(e) {
  e.preventDefault();
  const supabaseUrl = elements.supabaseUrlInput.value.trim();
  const supabaseKey = elements.supabaseKeyInput.value.trim();
  localStorage.setItem('supabase_url', supabaseUrl);
  localStorage.setItem('supabase_key', supabaseKey);
  showToast('Settings saved. Refreshing database sync...', 'success');
  closeSettingsModal();
  setTimeout(() => window.location.reload(), 1000);
}

function handleSettingsClear() {
  if (!confirm('Are you sure you want to clear your credentials? This will disconnect the app from the database.')) return;
  localStorage.removeItem('supabase_url');
  localStorage.removeItem('supabase_key');
  elements.supabaseUrlInput.value = '';
  elements.supabaseKeyInput.value = '';
  showToast('Database credentials cleared.', 'warning');
  closeSettingsModal();
  setTimeout(() => window.location.reload(), 1000);
}

// ----------------------------------------------------
// 6. UI Actions, Filters & Toast Helpers
// ----------------------------------------------------

function toggleClearSearchButton(show) {
  if (show) elements.btnClearSearch.classList.remove('hidden');
  else elements.btnClearSearch.classList.add('hidden');
}
function clearSearch() { elements.searchInput.value = ''; toggleClearSearchButton(false); filterCustomers(''); }

function setSaveButtonLoading(isLoading) {
  const btnText = elements.btnSave.querySelector('.btn-text');
  const spinner = elements.btnSave.querySelector('.spinner');
  if (isLoading) { elements.btnSave.disabled = true; btnText.style.opacity = '0.3'; spinner.classList.remove('hidden'); }
  else { elements.btnSave.disabled = false; btnText.style.opacity = '1'; spinner.classList.add('hidden'); }
}
function setAuthButtonLoading(isLoading) {
  const btnText = elements.btnAuthSubmit.querySelector('.btn-text');
  const spinner = elements.btnAuthSubmit.querySelector('.spinner');
  if (isLoading) { elements.btnAuthSubmit.disabled = true; btnText.style.opacity = '0.3'; spinner.classList.remove('hidden'); }
  else { elements.btnAuthSubmit.disabled = false; btnText.style.opacity = '1'; spinner.classList.add('hidden'); }
}

function renderCustomerList(list) {
  elements.customerList.innerHTML = '';
  if (list.length === 0) {
    elements.customerList.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <p>No customer records found matching search filters.</p>
      </div>`;
    return;
  }

  list.forEach(customer => {
    const card = document.createElement('div');
    card.className = 'customer-card';
    card.id = `customer-card-${customer.id}`;
    const navigateUrl = `https://www.google.com/maps/dir/?api=1&destination=${customer.latitude},${customer.longitude}`;

    card.innerHTML = `
      <div class="card-header">
        <div class="card-title">
          <h3>${escapeHtml(customer.name)}</h3>
          <p>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
            <span>${escapeHtml(customer.phone)}</span>
          </p>
        </div>
      </div>
      <div class="card-body">
        <p style="margin-bottom: 6px; font-size: 0.8rem; color: var(--color-secondary);"><strong>Worker:</strong> ${escapeHtml(customer.worker_name)}</p>
        ${customer.notes ? `<p style="margin-bottom: 8px;">${escapeHtml(customer.notes)}</p>` : '<p style="font-style: italic; color: var(--text-muted); margin-bottom: 8px;">No notes.</p>'}
        <div class="card-coords">
          <span>Lat: ${customer.latitude.toFixed(5)}</span>
          <span>Lng: ${customer.longitude.toFixed(5)}</span>
        </div>
      </div>
      <div class="card-actions">
        <a href="${navigateUrl}" target="_blank" class="btn btn-navigate" title="Launch navigation overlay">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px; height:16px;"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>
          <span>Navigate</span>
        </a>
        <button class="btn btn-delete" data-id="${customer.id}" data-name="${customer.name}">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px; height:16px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
          <span>Delete</span>
        </button>
      </div>`;

    card.querySelector('.btn-delete').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      deleteCustomer(Number(btn.dataset.id), btn.dataset.name);
    });
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete') || e.target.closest('.btn-navigate')) return;
      locateCustomerOnMap(customer);
    });
    elements.customerList.appendChild(card);
  });
}

function filterCustomers(query) {
  const cleanQuery = query.toLowerCase().trim();
  const filtered = customersData.filter(customer => {
    return customer.name.toLowerCase().includes(cleanQuery) ||
           customer.phone.toLowerCase().includes(cleanQuery) ||
           (customer.worker_name && customer.worker_name.toLowerCase().includes(cleanQuery)) ||
           (customer.notes && customer.notes.toLowerCase().includes(cleanQuery));
  });
  renderCustomerList(filtered);
  markers.forEach(markerObj => {
    const isMatched = filtered.some(f => f.id === markerObj.id);
    if (isMatched) markerObj.marker.addTo(map); else markerObj.marker.remove();
  });
}

function highlightCustomerCard(id) {
  document.querySelectorAll('.customer-card').forEach(el => el.classList.remove('highlighted'));
  const card = document.getElementById(`customer-card-${id}`);
  if (card) {
    card.classList.add('highlighted');
    card.style.borderColor = 'var(--color-primary)';
    card.style.boxShadow = 'var(--shadow-glow)';
    setTimeout(() => { card.style.borderColor = ''; card.style.boxShadow = ''; }, 2500);
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function switchTab(tab) {
  if (tab === 'log') {
    elements.tabLog.classList.add('active');
    elements.tabDatabase.classList.remove('active');
    elements.panelForm.classList.add('active');
    elements.panelDatabase.classList.remove('active');
  } else {
    elements.tabDatabase.classList.add('active');
    elements.tabLog.classList.remove('active');
    elements.panelDatabase.classList.add('active');
    elements.panelForm.classList.remove('active');
  }
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span><button class="toast-close">&times;</button>`;
  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.style.opacity = '0'; toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  });
  elements.toastContainer.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.opacity = '0'; toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 250);
    }
  }, 5000);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
