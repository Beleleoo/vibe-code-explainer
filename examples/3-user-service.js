/**
 * User service — handles user data and profile operations.
 */
const db = require("./db");

async function getUserById(userId) {
  const user = await db.query("SELECT * FROM users WHERE id = ?", [userId]);
  return user[0] || null;
}

async function updateUserProfile(userId, updates) {
  const allowed = ["name", "email", "avatar_url"];
  const filtered = Object.fromEntries(
    Object.entries(updates).filter(([k]) => allowed.includes(k))
  );
  await db.query("UPDATE users SET ? WHERE id = ?", [filtered, userId]);
  return getUserById(userId);
}

async function deleteUser(userId) {
  await db.query("DELETE FROM users WHERE id = ?", [userId]);
}

module.exports = { getUserById, updateUserProfile, deleteUser };
