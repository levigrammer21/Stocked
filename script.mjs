
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, push, set, remove, onValue, update, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAJlfW-prbW2aZOKz9sySl4Mt6OTEMELEk",
  authDomain: "stocked-28446.firebaseapp.com",
  projectId: "stocked-28446",
  storageBucket: "stocked-28446.firebasestorage.app",
  messagingSenderId: "890037002917",
  appId: "1:890037002917:web:5e8372134365b637f2e34c"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

let currentUser = null;
let householdId = null;
let pantryItems = {};
let householdItems = {};
let animalItems = {};
let groceryItems = {};
let householdMembers = {};
let settings = {};
let unsubscribeCallbacks = [];

let currentTab = 'pantry';
let filters = { pantry: 'all', household: 'all', animals: 'all' };
let groceryFilter = 'all';
let editingItemId = null;
let editingCollection = 'pantry';
let movingGroceryId = null;
let currentRecipeLinks = [];
let currentVariants = [];
let autofillData = null;
let moveAutofillData = null;
let itemIconImageData = '';
let locationTouched = false;
let activePopover = null;

const UNITS = ['', 'oz','lb','g','kg','fl oz','cup','L','ml','item','pack','box','can','bag','bunch','dozen','roll','bottle','jug','tub'];

const DEFAULT_RETAILERS = ['Costco','Aldi','Amazon','Walmart','Target','Sam’s Club','Trader Joe’s','Kroger','Publix','Meijer','Whole Foods','Local Store'];

const CATEGORY_SETS = {
  pantry: ['Proteins','Produce','Dairy','Grains & Carbs','Snacks','Beverages','Condiments','Canned Goods','Frozen','Baking','Spices','Other'],
  household: ['Cleaning Supplies','Laundry','Paper Goods','Personal Care','Toiletries','Medicine Cabinet','Kitchen Supplies','Bathroom Supplies','Other'],
  animals: ['Dog Food','Cat Food','Chicken Feed','Livestock Feed','Treats','Litter / Bedding','Medications','Grooming','Bowls / Gear','Other']
};

const CATEGORY_EMOJI = {
  'Proteins':'🥩','Produce':'🥦','Dairy':'🧀','Grains & Carbs':'🍞','Snacks':'🍿','Beverages':'🥤','Condiments':'🫙','Canned Goods':'🥫','Frozen':'❄️','Baking':'🧁','Spices':'🌶️','Cleaning Supplies':'🧽','Laundry':'🧺','Paper Goods':'🧻','Personal Care':'🧴','Toiletries':'🪥','Medicine Cabinet':'💊','Kitchen Supplies':'🍽️','Bathroom Supplies':'🛁','Dog Food':'🐶','Cat Food':'🐱','Chicken Feed':'🐔','Livestock Feed':'🐐','Treats':'🦴','Litter / Bedding':'🐾','Medications':'💊','Grooming':'🧼','Bowls / Gear':'🥣','Other':'📦'
};

const CATEGORY_LOCATION = {
  'Dairy':'fridge','Produce':'fridge','Proteins':'fridge','Frozen':'freezer',
  'Cleaning Supplies':'household','Laundry':'household','Paper Goods':'household','Personal Care':'household','Toiletries':'household','Medicine Cabinet':'household','Kitchen Supplies':'household','Bathroom Supplies':'household',
  'Dog Food':'animals','Cat Food':'animals','Chicken Feed':'animals','Livestock Feed':'animals','Treats':'animals','Litter / Bedding':'animals','Medications':'animals','Grooming':'animals','Bowls / Gear':'animals'
};

const COLLECTION_BY_TAB = { pantry: 'pantry', household: 'householdItems', animals: 'animalItems' };
const TAB_BY_COLLECTION = { pantry: 'pantry', householdItems: 'household', animalItems: 'animals' };

function itemMapForCollection(collection) {
  if (collection === 'householdItems') return householdItems;
  if (collection === 'animalItems') return animalItems;
  return pantryItems;
}

function getCategoryEmoji(cat) { return CATEGORY_EMOJI[cat] || '🏷️'; }
function normalizeEmail(email) { return String(email || '').trim().toLowerCase().replace(/[.#$\[\]]/g, '_'); }
function escHtml(str) { return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function escAttr(str) { return escHtml(str); }
function safeUrl(url) { const u = String(url || '').trim(); return /^https?:\/\//i.test(u) ? u : ''; }
function numOrBlank(v) { return v === '' || v === null || v === undefined ? '' : Number(v); }
function parseNonNegativeNumber(value, blankValue = '') { if (value === '' || value === null || value === undefined) return blankValue; const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : blankValue; }
function parseNonNegativeInt(value, blankValue = 1) { if (value === '' || value === null || value === undefined) return blankValue; const n = parseInt(value, 10); return Number.isFinite(n) && n >= 0 ? n : blankValue; }
function hasValue(value) { return value !== '' && value !== null && value !== undefined; }
function todayISO() { return new Date().toISOString().split('T')[0]; }

function getStoredCategories(type) {
  const saved = settings?.categories?.[type] ? Object.values(settings.categories[type]) : [];
  return [...new Set([...(CATEGORY_SETS[type] || []), ...saved].filter(Boolean))];
}

function getStoredRetailers() {
  const saved = settings?.retailers ? Object.values(settings.retailers) : [];
  const fromItems = [...Object.values(pantryItems), ...Object.values(householdItems), ...Object.values(animalItems), ...Object.values(groceryItems)].map(i => i.retailer || i.store).filter(Boolean);
  return [...new Set([...DEFAULT_RETAILERS, ...saved, ...fromItems].filter(Boolean))].sort((a,b) => a.localeCompare(b));
}

async function saveSettingValue(path, value) {
  if (!householdId || !value) return;
  const existing = Object.values(settings?.[path] || {}).map(v => String(v).toLowerCase());
  if (existing.includes(String(value).toLowerCase())) return;
  await set(push(ref(db, `households/${householdId}/settings/${path}`)), value);
}

async function rememberCategory(type, category) {
  if (!category) return;
  const all = getStoredCategories(type).map(c => c.toLowerCase());
  if (!all.includes(category.toLowerCase())) await set(push(ref(db, `households/${householdId}/settings/categories/${type}`)), category);
}

async function rememberRetailer(retailer) {
  const value = String(retailer || '').trim();
  if (!value) return;
  const all = getStoredRetailers().map(r => r.toLowerCase());
  if (!all.includes(value.toLowerCase())) await set(push(ref(db, `households/${householdId}/settings/retailers`)), value);
}

window.rememberRetailerFromInput = (id) => rememberRetailer(document.getElementById(id)?.value);

function fillUnitSelect(id, selected = '') {
  const sel = document.getElementById(id);
  if (!sel) return;
  sel.innerHTML = UNITS.map(u => `<option value="${escAttr(u)}" ${u === selected ? 'selected' : ''}>${u || '—'}</option>`).join('');
}

function populateCategorySelects() {
  const typeForCurrent = currentTab === 'animals' ? 'animals' : currentTab === 'household' ? 'household' : 'pantry';
  const controls = [
    { id: 'f-category', type: typeForCurrent },
    { id: 'g-category', type: 'pantry' }
  ];
  controls.forEach(({id, type}) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    const cats = getStoredCategories(type);
    sel.innerHTML = '<option value="">Select…</option>' + cats.map(c => `<option value="${escAttr(c)}">${escHtml(c)}</option>`).join('') + '<option value="__custom__">+ Add Category…</option>';
    if (cur && cats.includes(cur)) sel.value = cur;
  });
}

function populateRetailerDatalist() {
  const dl = document.getElementById('retailer-options');
  if (!dl) return;
  dl.innerHTML = getStoredRetailers().map(r => `<option value="${escAttr(r)}"></option>`).join('');
}

window.signInWithGoogle = async () => {
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); }
  catch(e) { console.error(e); showToast('Sign in failed. Try again.'); }
};

window.signOut = async () => {
  if (confirm('Sign out?')) await fbSignOut(auth);
};

onAuthStateChanged(auth, async user => {
  cleanupSubscriptions();
  if (user) {
    currentUser = user;
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app').classList.add('visible');
    const av = document.getElementById('user-avatar');
    if (user.photoURL) av.innerHTML = `<img src="${escAttr(user.photoURL)}" alt="" />`;
    else av.textContent = user.displayName?.[0] || user.email?.[0] || '?';
    await ensureHousehold();
    subscribeToData();
  } else {
    currentUser = null;
    householdId = null;
    pantryItems = {}; householdItems = {}; animalItems = {}; groceryItems = {}; householdMembers = {}; settings = {};
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app').classList.remove('visible');
  }
});

async function checkInvite(user) {
  if (!user?.email) return false;
  const emailKey = normalizeEmail(user.email);
  const inviteRef = ref(db, `invites/${emailKey}`);
  const inviteSnap = await get(inviteRef);
  if (!inviteSnap.exists()) return false;
  const invite = inviteSnap.val();
  if (!invite?.householdId) return false;
  const memberData = { uid: user.uid, email: user.email, displayName: user.displayName || user.email, photoURL: user.photoURL || '', joinedAt: Date.now(), invitedBy: invite.invitedBy || '' };
  await set(ref(db, `households/${invite.householdId}/members/${user.uid}`), memberData);
  await set(ref(db, `userHouseholds/${user.uid}`), invite.householdId);
  await remove(inviteRef);
  householdId = invite.householdId;
  return true;
}

async function ensureHousehold() {
  await checkInvite(currentUser);
  const userHouseholdRef = ref(db, `userHouseholds/${currentUser.uid}`);
  const snap = await get(userHouseholdRef);
  if (snap.exists()) {
    householdId = snap.val();
    const memberSnap = await get(ref(db, `households/${householdId}/members/${currentUser.uid}`));
    if (!memberSnap.exists()) {
      await set(ref(db, `households/${householdId}/members/${currentUser.uid}`), { uid: currentUser.uid, email: currentUser.email, displayName: currentUser.displayName || currentUser.email, photoURL: currentUser.photoURL || '', joinedAt: Date.now() });
    }
    return;
  }
  const hhRef = push(ref(db, 'households'));
  householdId = hhRef.key;
  await set(ref(db, `households/${householdId}/members/${currentUser.uid}`), { uid: currentUser.uid, email: currentUser.email, displayName: currentUser.displayName || currentUser.email, photoURL: currentUser.photoURL || '', owner: true, joinedAt: Date.now() });
  await set(ref(db, `userHouseholds/${currentUser.uid}`), householdId);
}

function cleanupSubscriptions() { unsubscribeCallbacks.forEach(fn => { try { fn(); } catch(e) {} }); unsubscribeCallbacks = []; }

function subscribe(path, callback) { const off = onValue(ref(db, path), callback); unsubscribeCallbacks.push(off); }

function subscribeToData() {
  subscribe(`households/${householdId}/pantry`, snap => { pantryItems = snap.val() || {}; renderCurrentView(); updateGroceryBadge(); });
  subscribe(`households/${householdId}/householdItems`, snap => { householdItems = snap.val() || {}; renderCurrentView(); });
  subscribe(`households/${householdId}/animalItems`, snap => { animalItems = snap.val() || {}; renderCurrentView(); });
  subscribe(`households/${householdId}/grocery`, snap => { groceryItems = snap.val() || {}; renderGrocery(); updateGroceryBadge(); });
  subscribe(`households/${householdId}/members`, snap => { householdMembers = snap.val() || {}; if (document.getElementById('modal-household')?.classList.contains('open')) renderHouseholdMembers(); });
  subscribe(`households/${householdId}/settings`, snap => { settings = snap.val() || {}; populateCategorySelects(); populateRetailerDatalist(); });
}

window.switchTab = (tab) => {
  currentTab = tab;
  document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`view-${tab}`)?.classList.add('active');
  document.getElementById(`tab-${tab}`)?.classList.add('active');
  renderCurrentView();
};

window.setFilter = (el, view) => {
  document.querySelectorAll(`#${view}-filter-chips .chip`).forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  filters[view] = el.dataset.filter;
  renderCurrentView();
};

window.setGroceryFilter = (filter) => {
  groceryFilter = filter;
  document.getElementById('grocery-filter-all')?.classList.toggle('active', filter === 'all');
  document.getElementById('grocery-filter-noprice')?.classList.toggle('active', filter === 'no-price');
  renderGrocery();
};

window.renderCurrentView = () => {
  if (currentTab === 'grocery') renderGrocery();
  else renderItemCollection(currentTab);
};

function getItemsForTab(tab) {
  if (tab === 'household') return Object.entries(householdItems).map(([id,item]) => ({ id, collection: 'householdItems', ...item }));
  if (tab === 'animals') return Object.entries(animalItems).map(([id,item]) => ({ id, collection: 'animalItems', ...item }));
  return Object.entries(pantryItems).map(([id,item]) => ({ id, collection: 'pantry', ...item }));
}

function renderItemCollection(tab) {
  const search = document.getElementById(`${tab}-search`)?.value.toLowerCase().trim() || '';
  const sort = document.getElementById(`${tab}-sort`)?.value || 'name';
  let items = getItemsForTab(tab);
  const filter = filters[tab] || 'all';
  if (filter !== 'all') {
    if (filter === 'expiring') items = items.filter(i => getExpStatus(i.expiration) !== 'ok' || variantsArray(i).some(v => getExpStatus(v.expiration) !== 'ok'));
    else if (filter === 'needs-use') items = items.filter(i => i.needsUse || variantsArray(i).some(v => v.needsUse));
    else if (filter === 'running-low') items = items.filter(i => i.runningLow || variantsArray(i).some(v => v.runningLow));
    else items = items.filter(i => (i.location || 'pantry') === filter);
  }
  if (search) {
    items = items.filter(i => [i.name, i.category, i.notes, i.retailer, ...variantsArray(i).map(v => v.name)].some(v => String(v || '').toLowerCase().includes(search)));
  }
  items.sort((a,b) => {
    if (sort === 'expiration') return (a.expiration || '9999').localeCompare(b.expiration || '9999');
    if (sort === 'category') return (a.category || '').localeCompare(b.category || '') || (a.name || '').localeCompare(b.name || '');
    if (sort === 'added') return (b.addedAt || 0) - (a.addedAt || 0);
    return (a.name || '').localeCompare(b.name || '');
  });
  const container = document.getElementById(`${tab}-list`);
  if (!container) return;
  if (!items.length) {
    const empty = tab === 'animals' ? ['🐾','No animal supplies yet','Tap + to add feed, treats, bedding, or animal care items.'] : tab === 'household' ? ['🧺','No household supplies yet','Tap + to add cleaning supplies, laundry, toiletries, or paper goods.'] : ['🥫','Nothing here yet','Tap + to add your first pantry item.'];
    container.innerHTML = `<div class="empty-state"><div class="emoji">${empty[0]}</div><h3>${empty[1]}</h3><p>${empty[2]}</p></div>`;
    return;
  }
  const groups = {};
  items.forEach(item => { const cat = item.category || 'Other'; if (!groups[cat]) groups[cat] = []; groups[cat].push(item); });
  container.innerHTML = Object.entries(groups).map(([cat, catItems]) => `<div class="category-group"><div class="category-label">${getCategoryEmoji(cat)} ${escHtml(cat)}</div><div class="items-grid">${catItems.map(renderItemCard).join('')}</div></div>`).join('');
}

function variantsArray(item) {
  if (!item?.variants) return [];
  if (Array.isArray(item.variants)) return item.variants.filter(Boolean);
  return Object.entries(item.variants).map(([id,v]) => ({ variantId: id, ...v }));
}

function totalContainers(item) {
  const vars = variantsArray(item);
  if (vars.length) return vars.reduce((sum, v) => sum + (Number(v.containers) || 0), 0);
  return Number(item.containers ?? 0);
}

function getExpStatus(expDate) {
  if (!expDate) return 'ok';
  const now = new Date(); now.setHours(0,0,0,0);
  const exp = new Date(expDate + 'T00:00:00');
  if (Number.isNaN(exp.getTime())) return 'ok';
  const diff = (exp - now) / 86400000;
  if (diff < 0) return 'expired';
  if (diff <= 3) return 'expiring';
  return 'ok';
}

function formatExpLabel(expDate) {
  if (!expDate) return '';
  const status = getExpStatus(expDate);
  const now = new Date(); now.setHours(0,0,0,0);
  const exp = new Date(expDate + 'T00:00:00');
  const diff = Math.round((exp - now) / 86400000);
  if (status === 'expired') return `<span class="exp-tag expired-txt">Expired</span>`;
  if (status === 'expiring') return `<span class="exp-tag soon">Exp. ${diff === 0 ? 'today' : `in ${diff}d`}</span>`;
  return `<span class="exp-tag">Exp. ${escHtml(expDate)}</span>`;
}

function itemIcon(item) {
  if (item.iconImage) return `<img src="${escAttr(item.iconImage)}" alt="" />`;
  return escHtml(item.icon || getCategoryEmoji(item.category || 'Other'));
}

function itemStatusClass(item) {
  const expStatus = getExpStatus(item.expiration);
  const vars = variantsArray(item);
  if (item.needsUse || vars.some(v => v.needsUse)) return 'needs-use';
  if (item.runningLow || vars.some(v => v.runningLow)) return 'running-low';
  if (expStatus === 'expired' || vars.some(v => getExpStatus(v.expiration) === 'expired')) return 'expired';
  if (expStatus === 'expiring' || vars.some(v => getExpStatus(v.expiration) === 'expiring')) return 'expiring';
  return '';
}

function itemQtyText(item) {
  const vars = variantsArray(item);
  if (vars.length) return `${vars.length} type${vars.length === 1 ? '' : 's'}`;
  if (!hasValue(item.quantity)) return '';
  return `${item.quantity}${item.unit ? ' ' + item.unit : ''}`;
}

function renderItemCard(item) {
  const containers = totalContainers(item);
  const vars = variantsArray(item);
  const loc = item.location || (item.collection === 'householdItems' ? 'household' : item.collection === 'animalItems' ? 'animals' : 'pantry');
  const qty = itemQtyText(item);
  const priceHistory = (item.priceHistory || []).slice(-3).reverse().map(p => `<div class="price-row"><span>${escHtml(p.retailer || '—')}</span><span>$${Number(p.price || 0).toFixed(2)} / ${escHtml(p.pricePer || 'item')}</span><span style="color:var(--stone-light)">${escHtml(p.date || '')}</span></div>`).join('');
  const recipes = (item.recipeLinks || []).map(r => { const url = safeUrl(r.url); return url ? `<a class="recipe-link" href="${escAttr(url)}" target="_blank" rel="noopener">🍳 ${escHtml(r.label || r.url)}</a>` : ''; }).join('');
  const statusPills = `${item.runningLow ? '<span class="pill status-low">Running Low</span>' : ''}${item.needsUse ? '<span class="pill status-needs">Needs Use</span>' : ''}`;
  const variantHtml = vars.length ? `<div class="variant-list">${vars.map(v => renderVariantRow(item, v)).join('')}</div>` : '';
  return `<div class="item-card ${itemStatusClass(item)}" id="card-${item.collection}-${item.id}">
    <div class="item-main">
      <div class="container-badge"><div class="container-icon">${itemIcon(item)}</div><div class="count-bubble ${containers === 0 ? 'zero' : ''}" onclick="openCountPopover(event,'${item.collection}','${item.id}',null,${containers})">${containers}</div></div>
      <div class="item-info" onclick="toggleDetail('${item.collection}','${item.id}')"><div class="item-name">${escHtml(item.name || '')}</div><div class="item-meta">${qty ? `<span class="item-qty">${escHtml(qty)}</span>` : ''}<span class="pill location-tag ${escAttr(loc)}">${escHtml(loc)}</span>${formatExpLabel(item.expiration)}${statusPills}</div></div>
      <div class="item-actions"><button class="toggle-btn ${item.runningLow ? 'active-low' : ''}" title="Running Low" onclick="toggleItemFlag('${item.collection}','${item.id}','runningLow',${!!item.runningLow})" type="button">📉</button>${item.needsUse ? `<button class="toggle-btn active-needs" title="Needs Use" onclick="toggleItemFlag('${item.collection}','${item.id}','needsUse',true)" type="button">🔥</button>` : ''}<button class="toggle-btn grocery-active" title="Add to Grocery" onclick="addToGroceryFromStock('${item.collection}','${item.id}')" type="button">🛒</button></div>
    </div>
    ${variantHtml}
    <div class="item-detail" id="detail-${item.collection}-${item.id}"><div class="detail-grid">${item.retailer ? `<div class="detail-field"><label>Retailer</label><span>${escHtml(item.retailer)}</span></div>` : ''}${item.price ? `<div class="detail-field"><label>Price</label><span>$${Number(item.price).toFixed(2)} / ${escHtml(item.pricePer || 'item')}</span></div>` : ''}${item.category ? `<div class="detail-field"><label>Category</label><span>${escHtml(item.category)}</span></div>` : ''}${hasValue(item.containers) ? `<div class="detail-field"><label>Containers</label><span>${escHtml(item.containers)}</span></div>` : ''}</div>${item.notes ? `<div class="detail-notes">📝 ${escHtml(item.notes)}</div>` : ''}${recipes ? `<div class="recipe-links">${recipes}</div>` : ''}${priceHistory ? `<div class="price-history">${priceHistory}</div>` : ''}<div class="detail-actions"><button class="btn-sm btn-edit" onclick="editItem('${item.collection}','${item.id}')" type="button">✏️ Edit</button><button class="btn-sm btn-grocery" onclick="addToGroceryFromStock('${item.collection}','${item.id}')" type="button">🛒 Restock</button><button class="btn-sm btn-low" onclick="toggleItemFlag('${item.collection}','${item.id}','runningLow',${!!item.runningLow})" type="button">📉 Low</button><button class="btn-sm btn-delete" onclick="deleteStockItem('${item.collection}','${item.id}')" type="button">🗑️ Delete</button></div></div>
  </div>`;
}

function renderVariantRow(parent, variant) {
  const count = Number(variant.containers ?? 0);
  const qty = hasValue(variant.quantity) ? `${variant.quantity}${variant.unit ? ' ' + variant.unit : ''}` : '';
  const status = `${variant.runningLow ? '<span class="pill status-low">Low</span>' : ''}${variant.needsUse ? '<span class="pill status-needs">Use</span>' : ''}${formatExpLabel(variant.expiration)}`;
  const vkey = escAttr(variant.variantId || variant.name || '');
  return `<div class="variant-row"><span class="variant-name">${escHtml(variant.name || 'Type')}</span>${qty ? `<span class="variant-meta">${escHtml(qty)}</span>` : ''}${status}<span class="variant-count ${count === 0 ? 'zero' : ''}" onclick="openCountPopover(event,'${parent.collection}','${parent.id}','${vkey}',${count})">${count}</span><div class="variant-actions"><button class="tiny-btn" onclick="addToGroceryFromStock('${parent.collection}','${parent.id}','${vkey}')" type="button">🛒</button></div></div>`;
}

window.toggleDetail = (collection, id) => document.getElementById(`detail-${collection}-${id}`)?.classList.toggle('open');

window.openCountPopover = (e, collection, id, variantKey, count) => {
  e.stopPropagation();
  if (activePopover) { activePopover.remove(); activePopover = null; }
  const host = e.currentTarget.parentElement || e.currentTarget;
  const popover = document.createElement('div');
  popover.className = 'count-popover';
  popover.innerHTML = `<button onclick="adjustCount('${collection}','${id}','${variantKey || ''}',-1,this)" type="button">−</button><span>${count}</span><button onclick="adjustCount('${collection}','${id}','${variantKey || ''}',1,this)" type="button">+</button>`;
  host.appendChild(popover);
  activePopover = popover;
  setTimeout(() => document.addEventListener('click', dismissPopover, { once: true }), 0);
};

function dismissPopover() { if (activePopover) { activePopover.remove(); activePopover = null; } }

window.adjustCount = async (collection, id, variantKey, delta, btn) => {
  btn.disabled = true;
  const items = itemMapForCollection(collection);
  const item = items[id];
  if (!item) return;
  if (variantKey) {
    const variants = variantsArray(item);
    const idx = variants.findIndex(v => String(v.variantId || v.name) === String(variantKey));
    if (idx >= 0) {
      const current = Number(variants[idx].containers ?? 0);
      variants[idx].containers = Math.max(0, current + delta);
      await update(ref(db, `households/${householdId}/${collection}/${id}`), { variants });
    }
  } else {
    const current = Number(item.containers ?? 0);
    await update(ref(db, `households/${householdId}/${collection}/${id}`), { containers: Math.max(0, current + delta) });
  }
  btn.disabled = false;
};

window.toggleItemFlag = (collection, id, field, current) => update(ref(db, `households/${householdId}/${collection}/${id}`), { [field]: !current });

window.deleteStockItem = (collection, id) => {
  if (!confirm('Remove this item?')) return;
  remove(ref(db, `households/${householdId}/${collection}/${id}`));
  showToast('Item removed');
};

function groceryGroupKey(item) { return [String(item.name || '').toLowerCase(), String(item.variantName || '').toLowerCase(), String(item.unit || '').toLowerCase(), String(item.store || '').toLowerCase(), String(item.category || '').toLowerCase()].join('|'); }

function getGroupedGroceryItems() {
  const raw = Object.entries(groceryItems).map(([id,item]) => ({ id, ...item }));
  const groups = new Map();
  raw.forEach(item => {
    const key = groceryGroupKey(item);
    const qty = Number(item.quantity || 0);
    if (!groups.has(key)) groups.set(key, { ...item, ids: [item.id], quantity: Number.isFinite(qty) ? qty : 0, rawItems: [item] });
    else {
      const group = groups.get(key);
      group.ids.push(item.id);
      group.rawItems.push(item);
      group.quantity += Number.isFinite(qty) ? qty : 0;
      group.checked = group.checked && item.checked;
      group.price = group.price || item.price || '';
      group.addedAt = Math.min(group.addedAt || item.addedAt || Date.now(), item.addedAt || Date.now());
    }
  });
  return Array.from(groups.values());
}

function findPriceInfoForGrocery(item) {
  const directPrice = parseFloat(item.price);
  if (Number.isFinite(directPrice) && directPrice > 0) return { price: directPrice, pricePer: item.pricePer || 'item' };
  const allStock = [...Object.values(pantryItems), ...Object.values(householdItems), ...Object.values(animalItems)];
  const name = String(item.name || '').toLowerCase();
  const variant = String(item.variantName || '').toLowerCase();
  for (const stock of allStock) {
    if (String(stock.name || '').toLowerCase() !== name) continue;
    const variants = variantsArray(stock);
    const matchingVariant = variants.find(v => (!variant || String(v.name || '').toLowerCase() === variant) && parseFloat(v.price) > 0);
    if (matchingVariant) return { price: parseFloat(matchingVariant.price), pricePer: matchingVariant.pricePer || stock.pricePer || 'item' };
    const stockPrice = parseFloat(stock.price);
    if (Number.isFinite(stockPrice) && stockPrice > 0) return { price: stockPrice, pricePer: stock.pricePer || 'item' };
  }
  return null;
}

function hasPriceForGrocery(item) { return !!findPriceInfoForGrocery(item); }

function groceryItemEstimate(item) {
  const priceInfo = findPriceInfoForGrocery(item);
  if (!priceInfo) return null;
  const qty = parseFloat(item.quantity);
  const multiplier = Number.isFinite(qty) && qty > 0 ? qty : 1;
  return priceInfo.price * multiplier;
}

function groceryGroupEstimate(item) {
  if (Array.isArray(item.rawItems) && item.rawItems.length) {
    let total = 0;
    let pricedCount = 0;
    item.rawItems.forEach(raw => {
      const est = groceryItemEstimate(raw);
      if (est !== null) { total += est; pricedCount++; }
    });
    return pricedCount ? total : null;
  }
  return groceryItemEstimate(item);
}

function groceryTotals(items) {
  return items.reduce((acc, item) => {
    const est = groceryGroupEstimate(item);
    if (est === null) acc.missing += Array.isArray(item.rawItems) ? item.rawItems.length : 1;
    else acc.total += est;
    return acc;
  }, { total: 0, missing: 0 });
}

function formatMoney(value) { return `$${Number(value || 0).toFixed(2)}`; }

window.renderGrocery = () => {
  const container = document.getElementById('grocery-list');
  if (!container) return;
  const search = document.getElementById('grocery-search')?.value.toLowerCase().trim() || '';
  const sort = document.getElementById('grocery-sort')?.value || 'store-category';
  let items = getGroupedGroceryItems();
  if (search) items = items.filter(i => [i.name, i.variantName, i.store, i.category].some(v => String(v || '').toLowerCase().includes(search)));
  if (groceryFilter === 'no-price') items = items.filter(i => !hasPriceForGrocery(i));
  if (!items.length) { container.innerHTML = `<div class="empty-state"><div class="emoji">🛒</div><h3>List is empty</h3><p>Add items manually, restock from your pantry, or mark running-low items to remember later.</p></div>`; return; }
  items.sort((a,b) => {
    if (sort === 'category') return (a.category || '').localeCompare(b.category || '') || (a.name || '').localeCompare(b.name || '');
    if (sort === 'name') return (a.name || '').localeCompare(b.name || '');
    if (sort === 'added') return (b.addedAt || 0) - (a.addedAt || 0);
    return (a.store || 'No Store').localeCompare(b.store || 'No Store') || (a.category || '').localeCompare(b.category || '') || (a.name || '').localeCompare(b.name || '');
  });
  const totals = groceryTotals(items);
  const summaryHtml = `<div class="grocery-summary"><div class="grocery-summary-main"><span>Estimated grocery total</span><span>${formatMoney(totals.total)}</span></div><div class="grocery-summary-sub">${totals.missing ? `${totals.missing} item${totals.missing === 1 ? '' : 's'} missing price, so the real total may be higher.` : 'All visible grocery items have prices included.'}</div></div>`;
  if (sort === 'store-category') {
    const storeGroups = {};
    items.forEach(i => { const store = i.store || 'No Store'; if (!storeGroups[store]) storeGroups[store] = []; storeGroups[store].push(i); });
    container.innerHTML = summaryHtml + Object.entries(storeGroups).map(([store, storeItems]) => {
      const cats = {};
      const storeTotals = groceryTotals(storeItems);
      storeItems.forEach(i => { const cat = i.category || 'Other'; if (!cats[cat]) cats[cat] = []; cats[cat].push(i); });
      return `<div class="store-group"><div class="store-label"><span>🏬 ${escHtml(store)}</span><span class="store-total"><span>${storeItems.length} item${storeItems.length === 1 ? '' : 's'}</span><span>${formatMoney(storeTotals.total)}</span>${storeTotals.missing ? `<span>$? ${storeTotals.missing}</span>` : ''}</span></div>${Object.entries(cats).map(([cat, catItems]) => `<div class="category-label">${getCategoryEmoji(cat)} ${escHtml(cat)}</div>${catItems.map(renderGroceryItem).join('')}`).join('')}</div>`;
    }).join('');
  } else {
    const unchecked = items.filter(i => !i.checked);
    const checked = items.filter(i => i.checked);
    container.innerHTML = summaryHtml + `${unchecked.length ? `<div class="category-group"><div class="category-label">To Get (${unchecked.length})</div>${unchecked.map(renderGroceryItem).join('')}</div>` : ''}${checked.length ? `<div class="category-group"><div class="category-label">✓ In Cart (${checked.length})</div>${checked.map(renderGroceryItem).join('')}</div>` : ''}`;
  }
};

function renderGroceryItem(item) {
  const noPrice = !hasPriceForGrocery(item);
  const estimate = groceryGroupEstimate(item);
  const qty = hasValue(item.quantity) ? `${Number(item.quantity)}${item.unit ? ' ' + item.unit : ''}` : '';
  const ids = item.ids || [item.id];
  const title = item.variantName ? `${item.name} — ${item.variantName}` : item.name;
  return `<div class="grocery-item ${item.checked ? 'checked' : ''} ${noPrice ? 'no-price' : ''}"><div class="check-circle ${item.checked ? 'checked' : ''}" onclick="toggleGroceryCheck(${escAttr(JSON.stringify(ids))},${!!item.checked})">${item.checked ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}</div><div class="grocery-info"><div class="grocery-name">${escHtml(title || '')}</div><div class="grocery-sub">${qty}${item.store ? ` · ${escHtml(item.store)}` : ''}${item.category ? ` · ${escHtml(item.category)}` : ''}${noPrice ? ' · $? Needs price' : ''}</div></div>${estimate !== null ? `<span class="price-chip">${formatMoney(estimate)}</span>` : ''}<div class="grocery-actions">${item.checked ? `<button class="btn-pantry-move" onclick="openMoveToPantry('${ids[0]}')" type="button">→ Stock</button>` : ''}<button class="btn-del-grocery" onclick="deleteGroceryItems(${escAttr(JSON.stringify(ids))})" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div></div>`;
}


window.toggleGroceryCheck = (ids, current) => { if (!Array.isArray(ids)) ids = [ids]; ids.forEach(id => update(ref(db, `households/${householdId}/grocery/${id}`), { checked: !current })); };
window.deleteGroceryItems = (ids) => { if (!Array.isArray(ids)) ids = [ids]; ids.forEach(id => remove(ref(db, `households/${householdId}/grocery/${id}`))); };
window.deleteGroceryItem = (id) => remove(ref(db, `households/${householdId}/grocery/${id}`));

function updateGroceryBadge() {
  const count = Object.values(groceryItems).filter(i => !i.checked).length;
  const badge = document.getElementById('grocery-badge');
  if (count > 0) { badge.style.display = ''; badge.textContent = count; } else badge.style.display = 'none';
}

window.addToGroceryFromStock = async (collection, id, variantKey = '') => {
  const item = itemMapForCollection(collection)[id];
  if (!item) return;
  let variant = null;
  if (variantKey) variant = variantsArray(item).find(v => String(v.variantId || v.name) === String(variantKey));
  const gRef = push(ref(db, `households/${householdId}/grocery`));
  await set(gRef, { name: item.name, variantName: variant?.name || '', category: item.category || '', quantity: variant?.quantity ?? item.quantity ?? 1, unit: variant?.unit || item.unit || '', store: variant?.retailer || item.retailer || '', price: variant?.price || item.price || '', pricePer: variant?.pricePer || item.pricePer || 'item', checked: false, addedAt: Date.now(), fromCollection: collection, fromStockId: id });
  showToast(`${item.name}${variant ? ' — ' + variant.name : ''} added to grocery`);
};

window.openMoveToPantry = (groceryId) => {
  movingGroceryId = groceryId;
  const gItem = groceryItems[groceryId];
  document.getElementById('move-pantry-title').textContent = `Move "${gItem?.name || ''}" to Stock`;
  const existing = [...Object.values(pantryItems), ...Object.values(householdItems), ...Object.values(animalItems)].find(p => String(p.name || '').toLowerCase() === String(gItem?.name || '').toLowerCase());
  moveAutofillData = existing || null;
  document.getElementById('autofill-move-banner').style.display = existing ? 'flex' : 'none';
  document.getElementById('mp-qty').value = gItem?.quantity ?? '';
  fillUnitSelect('mp-unit', gItem?.unit || '');
  document.getElementById('mp-containers').value = hasValue(gItem?.quantity) ? gItem.quantity : 1;
  document.getElementById('mp-expiration').value = '';
  document.getElementById('mp-retailer').value = gItem?.store || '';
  document.getElementById('mp-price').value = gItem?.price || '';
  resetToggleGroup('mp-location-group', CATEGORY_LOCATION[gItem?.category] || 'pantry');
  openModal('modal-move-pantry');
};

window.applyMoveAutofill = () => {
  if (!moveAutofillData) return;
  const d = moveAutofillData;
  document.getElementById('mp-qty').value = d.quantity ?? '';
  fillUnitSelect('mp-unit', d.unit || '');
  document.getElementById('mp-containers').value = d.containers ?? 1;
  document.getElementById('mp-retailer').value = d.retailer || '';
  document.getElementById('mp-price').value = d.price || '';
  if (d.location) resetToggleGroup('mp-location-group', d.location);
  showToast('Autofilled from previous entry');
};

function collectionFromLocation(location) {
  if (location === 'household') return 'householdItems';
  if (location === 'animals') return 'animalItems';
  return 'pantry';
}

window.confirmMoveToPantry = async () => {
  const gItem = groceryItems[movingGroceryId];
  if (!gItem) return;
  const location = getToggleVal('mp-location-group') || 'pantry';
  const collection = collectionFromLocation(location);
  const price = parseNonNegativeNumber(document.getElementById('mp-price').value, '');
  const newItem = { name: gItem.name, category: gItem.category || '', location, quantity: parseNonNegativeNumber(document.getElementById('mp-qty').value, ''), unit: document.getElementById('mp-unit').value || '', containers: parseNonNegativeInt(document.getElementById('mp-containers').value, 1), expiration: document.getElementById('mp-expiration').value || '', retailer: document.getElementById('mp-retailer').value.trim(), price: price, pricePer: 'item', runningLow: false, needsUse: false, addedAt: Date.now(), updatedAt: Date.now(), priceHistory: [] };
  if (price !== '') newItem.priceHistory = [{ price, retailer: newItem.retailer, pricePer: 'item', date: todayISO() }];
  if (gItem.variantName) newItem.variants = [{ name: gItem.variantName, quantity: newItem.quantity, unit: newItem.unit, containers: newItem.containers, price, retailer: newItem.retailer }];
  await rememberRetailer(newItem.retailer);
  await set(push(ref(db, `households/${householdId}/${collection}`)), newItem);
  await remove(ref(db, `households/${householdId}/grocery/${movingGroceryId}`));
  showToast(`${gItem.name} moved to stock`);
  closeModal('modal-move-pantry');
  switchTab(TAB_BY_COLLECTION[collection]);
};

window.quickMoveToPantry = async () => {
  const gItem = groceryItems[movingGroceryId];
  if (!gItem) return;
  const location = CATEGORY_LOCATION[gItem.category] || 'pantry';
  const collection = collectionFromLocation(location);
  const item = { name: gItem.name, category: gItem.category || '', location, quantity: gItem.quantity ?? '', unit: gItem.unit || '', containers: parseNonNegativeInt(gItem.quantity, 1), retailer: gItem.store || '', price: gItem.price || '', runningLow: false, needsUse: false, addedAt: Date.now(), updatedAt: Date.now(), priceHistory: [] };
  if (gItem.variantName) item.variants = [{ name: gItem.variantName, quantity: item.quantity, unit: item.unit, containers: item.containers, price: item.price, retailer: item.retailer }];
  await set(push(ref(db, `households/${householdId}/${collection}`)), item);
  await remove(ref(db, `households/${householdId}/grocery/${movingGroceryId}`));
  showToast(`${gItem.name} added to stock`);
  closeModal('modal-move-pantry');
  switchTab(TAB_BY_COLLECTION[collection]);
};

window.openAddModal = () => {
  editingItemId = null;
  editingCollection = COLLECTION_BY_TAB[currentTab] || 'pantry';
  currentRecipeLinks = [];
  currentVariants = [];
  autofillData = null;
  locationTouched = false;
  itemIconImageData = '';
  populateCategorySelects(); populateRetailerDatalist();
  fillUnitSelect('f-unit'); fillUnitSelect('g-unit'); fillUnitSelect('mp-unit');
  if (currentTab === 'grocery') { resetGroceryForm(); openModal('modal-grocery'); return; }
  resetItemForm();
  document.getElementById('modal-title').textContent = currentTab === 'animals' ? 'Add Animal Supply' : currentTab === 'household' ? 'Add Household Supply' : 'Add Pantry Item';
  if (currentTab === 'household') resetToggleGroup('f-location-group', 'household');
  if (currentTab === 'animals') resetToggleGroup('f-location-group', 'animals');
  openModal('modal-item');
};

function resetGroceryForm() {
  document.getElementById('g-name').value = '';
  document.getElementById('g-variant').value = '';
  document.getElementById('g-qty').value = 1;
  fillUnitSelect('g-unit');
  document.getElementById('g-store').value = '';
  document.getElementById('g-price').value = '';
  document.getElementById('g-category').value = '';
}

function resetItemForm() {
  ['f-name','f-category','f-qty','f-expiration','f-notes','f-retailer','f-price','f-icon'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('f-containers').value = 1;
  fillUnitSelect('f-unit');
  document.getElementById('f-image').value = '';
  document.getElementById('icon-preview').innerHTML = '📦';
  document.getElementById('autofill-banner').style.display = 'none';
  resetToggleGroup('f-location-group', 'pantry');
  resetToggleGroup('f-priceper-group', 'item');
  setBooleanButton('f-running-low-btn', false);
  setBooleanButton('f-needs-use-btn', false);
  currentRecipeLinks = [];
  currentVariants = [];
  renderRecipeLinks(); renderVariantEditor();
  closeSection('price-section','price-toggle-icon');
  closeSection('recipe-section','recipe-toggle-icon');
  closeSection('variants-section','variants-toggle-icon');
}

window.editItem = (collection, id) => {
  editingCollection = collection;
  editingItemId = id;
  const item = itemMapForCollection(collection)[id];
  if (!item) return;
  switchTab(TAB_BY_COLLECTION[collection] || 'pantry');
  populateCategorySelects(); populateRetailerDatalist(); resetItemForm();
  document.getElementById('modal-title').textContent = 'Edit Item';
  document.getElementById('f-name').value = item.name || '';
  document.getElementById('f-category').value = item.category || '';
  document.getElementById('f-qty').value = item.quantity ?? '';
  fillUnitSelect('f-unit', item.unit || '');
  document.getElementById('f-containers').value = item.containers ?? 1;
  document.getElementById('f-expiration').value = item.expiration || '';
  document.getElementById('f-notes').value = item.notes || '';
  document.getElementById('f-retailer').value = item.retailer || '';
  document.getElementById('f-price').value = item.price ?? '';
  document.getElementById('f-icon').value = item.icon || '';
  itemIconImageData = item.iconImage || '';
  updateIconPreview();
  resetToggleGroup('f-location-group', item.location || 'pantry');
  resetToggleGroup('f-priceper-group', item.pricePer || 'item');
  setBooleanButton('f-running-low-btn', !!item.runningLow);
  setBooleanButton('f-needs-use-btn', !!item.needsUse);
  currentRecipeLinks = item.recipeLinks ? [...item.recipeLinks] : [];
  currentVariants = variantsArray(item).map(v => ({ ...v }));
  renderRecipeLinks(); renderVariantEditor();
  if (currentVariants.length) openSection('variants-section','variants-toggle-icon');
  if (item.price || item.retailer) openSection('price-section','price-toggle-icon');
  if (currentRecipeLinks.length) openSection('recipe-section','recipe-toggle-icon');
  openModal('modal-item');
};

window.checkAutofill = () => {
  const name = document.getElementById('f-name').value.trim().toLowerCase();
  if (!name || editingItemId) { document.getElementById('autofill-banner').style.display = 'none'; return; }
  const all = [...Object.values(pantryItems), ...Object.values(householdItems), ...Object.values(animalItems)];
  const match = all.find(i => String(i.name || '').toLowerCase() === name);
  autofillData = match || null;
  document.getElementById('autofill-banner').style.display = match ? 'flex' : 'none';
};

window.applyAutofill = () => {
  if (!autofillData) return;
  const d = autofillData;
  document.getElementById('f-category').value = d.category || '';
  document.getElementById('f-qty').value = d.quantity ?? '';
  fillUnitSelect('f-unit', d.unit || '');
  document.getElementById('f-containers').value = d.containers ?? 1;
  document.getElementById('f-notes').value = d.notes || '';
  document.getElementById('f-retailer').value = d.retailer || '';
  document.getElementById('f-price').value = d.price ?? '';
  document.getElementById('f-icon').value = d.icon || '';
  itemIconImageData = d.iconImage || '';
  updateIconPreview();
  if (d.location) resetToggleGroup('f-location-group', d.location);
  if (d.pricePer) resetToggleGroup('f-priceper-group', d.pricePer);
  currentRecipeLinks = d.recipeLinks ? [...d.recipeLinks] : [];
  currentVariants = variantsArray(d).map(v => ({ ...v, containers: 0, quantity: '' }));
  renderRecipeLinks(); renderVariantEditor();
  showToast('Autofilled from previous entry');
};

window.handleCategoryChange = async (prefix) => {
  const sel = document.getElementById(`${prefix}-category`);
  if (!sel) return;
  let val = sel.value;
  const type = currentTab === 'animals' ? 'animals' : currentTab === 'household' ? 'household' : 'pantry';
  if (val === '__custom__') {
    val = prompt('Enter new category name:')?.trim() || '';
    if (!val) { sel.value = ''; return; }
    await rememberCategory(prefix === 'g' ? 'pantry' : type, val);
    populateCategorySelects();
    sel.value = val;
  }
  if (prefix === 'f' && val && !locationTouched && CATEGORY_LOCATION[val]) resetToggleGroup('f-location-group', CATEGORY_LOCATION[val]);
};

window.selectToggle = (el, group) => {
  const parent = el.closest('.toggle-group');
  parent.querySelectorAll('.toggle-option').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  if (group === 'location') locationTouched = true;
};

function getToggleVal(groupId) { return document.querySelector(`#${groupId} .toggle-option.selected`)?.dataset.val || null; }
function resetToggleGroup(groupId, val) { document.querySelectorAll(`#${groupId} .toggle-option`).forEach(b => b.classList.toggle('selected', b.dataset.val === val)); }
function setBooleanButton(id, val) { document.getElementById(id)?.classList.toggle('selected', !!val); }
window.toggleBooleanButton = (id) => document.getElementById(id)?.classList.toggle('selected');
function getBooleanButton(id) { return document.getElementById(id)?.classList.contains('selected') || false; }

window.updateIconPreview = () => {
  const preview = document.getElementById('icon-preview');
  if (!preview) return;
  if (itemIconImageData) preview.innerHTML = `<img src="${escAttr(itemIconImageData)}" alt="" />`;
  else preview.textContent = document.getElementById('f-icon')?.value || getCategoryEmoji(document.getElementById('f-category')?.value || 'Other');
};

window.handleIconImage = (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { itemIconImageData = String(reader.result || ''); updateIconPreview(); };
  reader.readAsDataURL(file);
};

function collectVariants() {
  return Array.from(document.querySelectorAll('.variant-editor-row')).map(row => ({
    name: row.querySelector('.v-name')?.value.trim() || '',
    quantity: parseNonNegativeNumber(row.querySelector('.v-qty')?.value, ''),
    unit: row.querySelector('.v-unit')?.value || '',
    containers: parseNonNegativeInt(row.querySelector('.v-containers')?.value, 0),
    price: parseNonNegativeNumber(row.querySelector('.v-price')?.value, ''),
    retailer: row.querySelector('.v-retailer')?.value.trim() || '',
    runningLow: row.querySelector('.v-running-low')?.checked || false,
    needsUse: row.querySelector('.v-needs-use')?.checked || false
  })).filter(v => v.name);
}

function renderVariantEditor() {
  const box = document.getElementById('variant-editor-list');
  if (!box) return;
  box.innerHTML = currentVariants.map((v, i) => variantEditorRowHtml(v, i)).join('');
  currentVariants.forEach((v,i) => fillUnitSelect(`v-unit-${i}`, v.unit || ''));
}

function variantEditorRowHtml(v, i) {
  return `<div class="variant-editor-row"><input class="form-input v-name" value="${escAttr(v.name || '')}" placeholder="Type name" /><input class="form-input v-qty" type="number" min="0" step="0.1" value="${escAttr(v.quantity ?? '')}" placeholder="Qty" /><select class="form-select v-unit" id="v-unit-${i}"></select><input class="form-input v-containers" type="number" min="0" step="1" value="${escAttr(v.containers ?? 0)}" placeholder="Bags" /><button class="remove-row-btn" onclick="removeVariantEditorRow(${i})" type="button">×</button><input class="form-input v-retailer" list="retailer-options" value="${escAttr(v.retailer || '')}" placeholder="Retailer" /><input class="form-input v-price" type="number" min="0" step="0.01" value="${escAttr(v.price ?? '')}" placeholder="Price" /><label style="font-size:11px;text-transform:none;letter-spacing:0"><input class="v-running-low" type="checkbox" ${v.runningLow ? 'checked' : ''}/> Low</label><label style="font-size:11px;text-transform:none;letter-spacing:0"><input class="v-needs-use" type="checkbox" ${v.needsUse ? 'checked' : ''}/> Needs Use</label></div>`;
}

window.addVariantEditorRow = () => { currentVariants = collectVariants(); currentVariants.push({ name: '', quantity: '', unit: 'bag', containers: 1, price: '', retailer: '', runningLow: false, needsUse: false }); renderVariantEditor(); };
window.removeVariantEditorRow = (i) => { currentVariants = collectVariants(); currentVariants.splice(i,1); renderVariantEditor(); };

window.saveItem = async () => {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { showToast('Item name is required'); return; }
  let category = document.getElementById('f-category').value;
  if (category === '__custom__') { await handleCategoryChange('f'); category = document.getElementById('f-category').value; }
  const location = getToggleVal('f-location-group') || 'pantry';
  const collection = collectionFromLocation(location);
  const type = collection === 'animalItems' ? 'animals' : collection === 'householdItems' ? 'household' : 'pantry';
  await rememberCategory(type, category);
  await rememberRetailer(document.getElementById('f-retailer').value.trim());
  const variants = collectVariants();
  for (const v of variants) await rememberRetailer(v.retailer);
  const price = parseNonNegativeNumber(document.getElementById('f-price').value, '');
  const item = {
    name,
    category,
    location,
    quantity: parseNonNegativeNumber(document.getElementById('f-qty').value, ''),
    unit: document.getElementById('f-unit').value || '',
    containers: parseNonNegativeInt(document.getElementById('f-containers').value, 1),
    expiration: document.getElementById('f-expiration').value || '',
    runningLow: getBooleanButton('f-running-low-btn'),
    needsUse: getBooleanButton('f-needs-use-btn'),
    notes: document.getElementById('f-notes').value.trim(),
    retailer: document.getElementById('f-retailer').value.trim(),
    price,
    pricePer: getToggleVal('f-priceper-group') || 'item',
    icon: document.getElementById('f-icon').value.trim(),
    iconImage: itemIconImageData,
    recipeLinks: currentRecipeLinks,
    variants,
    updatedAt: Date.now()
  };
  const existing = editingItemId ? itemMapForCollection(editingCollection)[editingItemId] : null;
  item.addedAt = existing?.addedAt || Date.now();
  item.priceHistory = existing?.priceHistory || [];
  if (price !== '' && (item.retailer || price !== Number(existing?.price))) item.priceHistory = [...item.priceHistory, { price, retailer: item.retailer, pricePer: item.pricePer, date: todayISO() }].slice(-10);
  if (editingItemId) {
    if (editingCollection !== collection) { await set(ref(db, `households/${householdId}/${collection}/${editingItemId}`), item); await remove(ref(db, `households/${householdId}/${editingCollection}/${editingItemId}`)); }
    else await update(ref(db, `households/${householdId}/${collection}/${editingItemId}`), item);
    showToast('Item updated');
  } else {
    await set(push(ref(db, `households/${householdId}/${collection}`)), item);
    showToast(`${name} added`);
  }
  closeModal('modal-item');
  switchTab(TAB_BY_COLLECTION[collection]);
};

window.saveGroceryItem = async () => {
  const name = document.getElementById('g-name').value.trim();
  if (!name) { showToast('Item name is required'); return; }
  let category = document.getElementById('g-category').value;
  if (category === '__custom__') { await handleCategoryChange('g'); category = document.getElementById('g-category').value; }
  const store = document.getElementById('g-store').value.trim();
  await rememberRetailer(store);
  const gRef = push(ref(db, `households/${householdId}/grocery`));
  await set(gRef, { name, variantName: document.getElementById('g-variant').value.trim(), category, quantity: parseNonNegativeNumber(document.getElementById('g-qty').value, 1), unit: document.getElementById('g-unit').value || '', store, price: parseNonNegativeNumber(document.getElementById('g-price').value, ''), pricePer: 'item', checked: false, addedAt: Date.now() });
  showToast(`${name} added to grocery list`);
  closeModal('modal-grocery');
};

window.addRecipeLink = () => {
  const label = document.getElementById('f-recipe-label').value.trim();
  const url = safeUrl(document.getElementById('f-recipe-url').value.trim());
  if (!url) { showToast('Enter a valid http or https URL'); return; }
  currentRecipeLinks.push({ label: label || url, url });
  document.getElementById('f-recipe-label').value = '';
  document.getElementById('f-recipe-url').value = '';
  renderRecipeLinks();
};

function renderRecipeLinks() {
  const box = document.getElementById('recipe-links-list');
  if (!box) return;
  box.innerHTML = currentRecipeLinks.map((r, i) => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--cream-darker)"><span style="flex:1;font-size:13px;color:var(--sky-deep)">🍳 ${escHtml(r.label)}</span><button onclick="removeRecipeLink(${i})" style="background:none;border:none;cursor:pointer;color:var(--rose);font-size:16px;" type="button">×</button></div>`).join('');
}
window.removeRecipeLink = (i) => { currentRecipeLinks.splice(i, 1); renderRecipeLinks(); };

window.toggleSection = (id, iconId) => { const section = document.getElementById(id); const open = !section.classList.contains('open'); section.classList.toggle('open', open); document.getElementById(iconId).textContent = open ? '▲' : '▼'; };
function openSection(id, iconId) { document.getElementById(id)?.classList.add('open'); const icon = document.getElementById(iconId); if (icon) icon.textContent = '▲'; }
function closeSection(id, iconId) { document.getElementById(id)?.classList.remove('open'); const icon = document.getElementById(iconId); if (icon) icon.textContent = '▼'; }

window.openHousehold = () => { renderHouseholdMembers(); openModal('modal-household'); };
function renderHouseholdMembers() {
  const container = document.getElementById('household-members');
  container.innerHTML = Object.values(householdMembers).map(m => `<div class="household-member"><div class="member-avatar">${m.photoURL ? `<img src="${escAttr(m.photoURL)}" alt="" />` : escHtml((m.displayName || m.email || '?')[0].toUpperCase())}</div><div><div class="member-name">${escHtml(m.displayName || m.email || '')}</div><div class="member-email">${escHtml(m.email || '')}</div></div>${m.uid === currentUser?.uid ? '<span class="member-you">You</span>' : ''}</div>`).join('') || '<p style="color:var(--stone);font-size:13px;">No members yet.</p>';
}

window.inviteMember = async () => {
  const email = document.getElementById('invite-email').value.trim().toLowerCase();
  if (!email || !email.includes('@')) { showToast('Enter a valid email'); return; }
  await set(ref(db, `invites/${normalizeEmail(email)}`), { householdId, invitedBy: currentUser.email, invitedAt: Date.now(), email });
  showToast(`Invite saved for ${email}`);
  document.getElementById('invite-email').value = '';
};

window.openModal = (id) => {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Always start modals at the top. Without this, mobile browsers can keep
  // the previous scroll position inside the modal after editing a long item.
  const modal = overlay.querySelector('.modal');
  overlay.scrollTop = 0;
  if (modal) modal.scrollTop = 0;
  requestAnimationFrame(() => {
    overlay.scrollTop = 0;
    if (modal) modal.scrollTop = 0;
  });
};
window.closeModal = (id) => { document.getElementById(id)?.classList.remove('open'); document.body.style.overflow = ''; };
document.querySelectorAll('.modal-overlay').forEach(overlay => overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay.id); }));

window.showToast = (msg) => { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500); };

// Expose helpers used by inline handlers.
window.escHtml = escHtml;
window.renderGrocery = renderGrocery;
window.renderCurrentView = renderCurrentView;

fillUnitSelect('f-unit'); fillUnitSelect('g-unit'); fillUnitSelect('mp-unit');
