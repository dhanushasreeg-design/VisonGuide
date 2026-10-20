const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../data");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getFilePath(collection) {
  return path.join(DATA_DIR, `${collection}.json`);
}

function readAll(collection) {
  const filePath = getFilePath(collection);
  try {
    if (!fs.existsSync(filePath)) return [];
    const text = fs.readFileSync(filePath, "utf8");
    return JSON.parse(text) || [];
  } catch (err) {
    console.warn(`[localStore] Failed to read ${collection}:`, err.message);
    return [];
  }
}

function writeAll(collection, items) {
  const filePath = getFilePath(collection);
  try {
    fs.writeFileSync(filePath, JSON.stringify(items, null, 2), "utf8");
    return true;
  } catch (err) {
    console.error(`[localStore] Failed to write ${collection}:`, err.message);
    return false;
  }
}

function find(collection, filterFn) {
  const items = readAll(collection);
  return filterFn ? items.filter(filterFn) : items;
}

function insert(collection, item) {
  const items = readAll(collection);
  const newItem = {
    id: item.id || Date.now().toString(),
    created_at: item.created_at || new Date().toISOString(),
    ...item,
  };
  items.unshift(newItem);
  writeAll(collection, items);
  return newItem;
}

function remove(collection, filterFn) {
  const items = readAll(collection);
  const remaining = items.filter((item) => !filterFn(item));
  writeAll(collection, remaining);
  return items.length - remaining.length;
}

function syncFromRemote(collection, remoteItems, userId) {
  if (!Array.isArray(remoteItems) || remoteItems.length === 0) return;
  const localItems = readAll(collection);
  const map = new Map();
  // Keep other users' items
  localItems.forEach((item) => {
    if (userId && item.user_id !== userId) {
      map.set(item.id, item);
    }
  });
  // Add fresh remote items
  remoteItems.forEach((item) => {
    map.set(item.id, item);
  });
  writeAll(collection, Array.from(map.values()));
}

module.exports = {
  readAll,
  writeAll,
  find,
  insert,
  remove,
  syncFromRemote,
};
